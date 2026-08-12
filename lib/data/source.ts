import { GoogleAuth } from "google-auth-library";
import ExcelJS from "exceljs";
import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import { parseOperationalSheets, type RawCell, type RawSheet } from "@/lib/data/parser";
import type { OperationalDataset } from "@/lib/types";

const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? "1NzjHFVvdaEKAO4eKrj2e1jUmrwHGLQ3FQM4tWkV53Ik";
const SHEET_NAMES = ["Frozen - PGS", "Frozen - SRG", "Frozen - BIT", "Frozen - STR", "Highlight"];
const RANGE_BY_SHEET: Record<string, string> = {
  "Frozen - PGS": "A1:QZ400",
  "Frozen - SRG": "A1:QZ400",
  "Frozen - BIT": "A1:QZ400",
  "Frozen - STR": "A1:QZ400",
  Highlight: "A1:D500",
};

let cache: { expiresAt: number; value: OperationalDataset } | null = null;
let pendingLoad: Promise<OperationalDataset> | null = null;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

function compactDataset(value: OperationalDataset): OperationalDataset {
  return { ...value, points: value.points.filter((point) => point.quality === "valid" || point.quality === "future") };
}

function toRawCell(value: ExcelJS.CellValue): RawCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "object" && "error" in value) return String(value.error);
  if (typeof value === "object" && "result" in value) return toRawCell(value.result as ExcelJS.CellValue);
  if (typeof value === "object" && "text" in value) return String(value.text);
  if (typeof value === "object" && "richText" in value) return value.richText.map((part) => part.text).join("");
  return String(value);
}

async function loadWorkbook(filePath: string): Promise<OperationalDataset> {
  const workbook = new ExcelJS.Workbook();
  const bytes = await readFile(filePath);
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheets: Record<string, RawSheet> = {};

  for (const name of SHEET_NAMES) {
    const worksheet = workbook.getWorksheet(name);
    if (!worksheet) continue;
    const rows: RawSheet = [];
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values: RawCell[] = [];
      const maxColumn = name === "Highlight" ? 4 : Math.min(Math.max(worksheet.columnCount, 64), 500);
      for (let column = 1; column <= maxColumn; column += 1) values[column - 1] = toRawCell(row.getCell(column).value);
      rows[rowNumber - 1] = values;
    });
    sheets[name] = rows;
  }
  return compactDataset(parseOperationalSheets(sheets, "workbook", path.basename(filePath)));
}

async function loadGoogleSheets(): Promise<OperationalDataset> {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replaceAll("\\n", "\n");
  if (!clientEmail || !privateKey) throw new Error("Google service account belum dikonfigurasi.");

  const auth = new GoogleAuth({ credentials: { client_email: clientEmail, private_key: privateKey }, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("Tidak dapat memperoleh access token Google Sheets.");

  const query = new URLSearchParams({
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  for (const name of SHEET_NAMES) query.append("ranges", `'${name}'!${RANGE_BY_SHEET[name]}`);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token.token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Google Sheets batch sync gagal: HTTP ${response.status}`);
  const payload = (await response.json()) as { valueRanges?: Array<{ values?: RawSheet }> };
  const sheets: Record<string, RawSheet> = {};
  SHEET_NAMES.forEach((name, index) => { sheets[name] = payload.valueRanges?.[index]?.values ?? []; });
  return compactDataset(parseOperationalSheets(sheets, "google", "[FIT] Daily Ops Visibility Report 2026"));
}

async function loadSnapshot(snapshotPath: string): Promise<OperationalDataset> {
  const compressed = await readFile(snapshotPath);
  const decoded = await gunzipAsync(compressed);
  const value = JSON.parse(decoded.toString("utf8")) as OperationalDataset;
  return compactDataset({ ...value, sourceMode: "snapshot", sourceName: `${value.sourceName} · optimized snapshot` });
}

async function saveSnapshot(snapshotPath: string, value: OperationalDataset): Promise<void> {
  await mkdir(path.dirname(snapshotPath), { recursive: true });
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(value)), { level: 6 });
  await writeFile(snapshotPath, compressed);
}

async function snapshotIsCurrent(snapshotPath: string, sourcePath?: string): Promise<boolean> {
  try {
    const snapshotStats = await stat(snapshotPath);
    if (!sourcePath) return true;
    const sourceStats = await stat(sourcePath);
    return snapshotStats.mtimeMs >= sourceStats.mtimeMs;
  } catch {
    return false;
  }
}

async function loadSource(): Promise<OperationalDataset> {
  const workbookPath = process.env.FIT_WORKBOOK_PATH;
  const snapshotPath = process.env.FIT_SNAPSHOT_PATH ?? path.join(process.cwd(), ".cache", "operational-dataset.json.gz");
  if (workbookPath && await snapshotIsCurrent(snapshotPath, workbookPath)) return loadSnapshot(snapshotPath);

  try {
    const value = workbookPath ? await loadWorkbook(workbookPath) : await loadGoogleSheets();
    await saveSnapshot(snapshotPath, value).catch(() => undefined);
    return value;
  } catch (error) {
    if (await snapshotIsCurrent(snapshotPath)) return loadSnapshot(snapshotPath);
    throw error;
  }
}

export async function getOperationalDataset(options: { force?: boolean } = {}): Promise<OperationalDataset> {
  const now = Date.now();
  if (!options.force && cache && cache.expiresAt > now) return cache.value;
  if (pendingLoad) return pendingLoad;
  const workbookPath = process.env.FIT_WORKBOOK_PATH;
  pendingLoad = loadSource();
  try {
    const value = await pendingLoad;
    const defaultTtl = workbookPath ? 3600 : 60;
    const ttl = Math.max(15, Number(process.env.DATA_CACHE_SECONDS ?? defaultTtl)) * 1_000;
    cache = { value, expiresAt: Date.now() + ttl };
    return value;
  } finally {
    pendingLoad = null;
  }
}
