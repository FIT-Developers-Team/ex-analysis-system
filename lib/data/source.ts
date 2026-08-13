import { GoogleAuth } from "google-auth-library";
import ExcelJS from "exceljs";
import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import { parseOperationalSheets, type RawCell, type RawSheet } from "@/lib/data/parser";
import type { DataSyncMetadata, OperationalDataset } from "@/lib/types";

const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? "1NzjHFVvdaEKAO4eKrj2e1jUmrwHGLQ3FQM4tWkV53Ik";
const SHEET_NAMES = ["Frozen - PGS", "Frozen - SRG", "Frozen - BIT", "Frozen - STR", "Highlight"] as const;
const RANGE_BY_SHEET: Record<(typeof SHEET_NAMES)[number], string> = {
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

function positiveInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
}

function ageSeconds(isoDate: string, now = Date.now()): number {
  const parsed = Date.parse(isoDate);
  return Number.isFinite(parsed) ? Math.max(0, Math.round((now - parsed) / 1_000)) : Number.POSITIVE_INFINITY;
}

function withSync(
  value: OperationalDataset,
  input: Omit<DataSyncMetadata, "lastSuccessAt" | "staleAfterSeconds" | "isStale"> & { lastSuccessAt?: string },
): OperationalDataset {
  const staleAfterSeconds = positiveInteger(process.env.DATA_STALE_AFTER_SECONDS, input.provider === "google" ? 180 : 86_400, 30, 604_800);
  const lastSuccessAt = input.lastSuccessAt ?? value.fetchedAt;
  return {
    ...value,
    sync: {
      ...input,
      lastSuccessAt,
      staleAfterSeconds,
      isStale: ageSeconds(lastSuccessAt) > staleAfterSeconds,
    },
  };
}

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
  const startedAt = Date.now();
  const attemptedAt = new Date(startedAt).toISOString();
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
  const value = compactDataset(parseOperationalSheets(sheets, "workbook", path.basename(filePath)));
  return withSync(value, {
    provider: "workbook",
    state: "live",
    lastAttemptAt: attemptedAt,
    latencyMs: Date.now() - startedAt,
    attempts: 1,
    rangesLoaded: Object.keys(sheets).length,
    cacheExpiresAt: null,
    message: "Workbook lokal berhasil dibaca.",
  });
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds)) return Math.min(5_000, Math.max(250, seconds * 1_000));
  return Math.min(2_500, 300 * 2 ** (attempt - 1));
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchGoogleBatch(url: string, token: string): Promise<{ payload: { valueRanges?: Array<{ range?: string; values?: RawSheet }> }; attempts: number }> {
  const timeoutMs = positiveInteger(process.env.GOOGLE_SYNC_TIMEOUT_MS, 12_000, 2_000, 60_000);
  const maximumAttempts = positiveInteger(process.env.GOOGLE_SYNC_RETRIES, 3, 1, 5);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return { payload: await response.json() as { valueRanges?: Array<{ range?: string; values?: RawSheet }> }, attempts: attempt };
      const detail = (await response.text()).slice(0, 240);
      lastError = new Error(`Google Sheets batch sync gagal: HTTP ${response.status}${detail ? ` (${detail})` : ""}`);
      if (!retryableStatus(response.status) || attempt === maximumAttempts) throw lastError;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Google Sheets request gagal.");
      if (response && !retryableStatus(response.status)) throw lastError;
      if (attempt === maximumAttempts) throw lastError;
    }
    await wait(retryDelayMs(response, attempt));
  }
  throw lastError ?? new Error("Google Sheets request gagal.");
}

function sheetNameFromRange(range: string | undefined): string | null {
  const matched = range?.match(/^'?([^']+)'?!/);
  return matched?.[1] ?? null;
}

async function loadGoogleSheets(): Promise<OperationalDataset> {
  const startedAt = Date.now();
  const attemptedAt = new Date(startedAt).toISOString();
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
    fields: "valueRanges(range,values)",
  });
  for (const name of SHEET_NAMES) query.append("ranges", `'${name}'!${RANGE_BY_SHEET[name]}`);
  const { payload, attempts } = await fetchGoogleBatch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${query.toString()}`, token.token);
  const sheets: Record<string, RawSheet> = {};
  for (const [index, valueRange] of (payload.valueRanges ?? []).entries()) {
    const name = sheetNameFromRange(valueRange.range) ?? SHEET_NAMES[index];
    if (name) sheets[name] = valueRange.values ?? [];
  }
  const missing = SHEET_NAMES.filter((name) => !sheets[name]?.length);
  if (missing.some((name) => name !== "Highlight")) throw new Error(`Google Sheets tidak mengembalikan tab wajib: ${missing.join(", ")}.`);

  const value = compactDataset(parseOperationalSheets(sheets, "google", "[FIT] Daily Ops Visibility Report 2026"));
  return withSync(value, {
    provider: "google",
    state: "live",
    lastAttemptAt: attemptedAt,
    latencyMs: Date.now() - startedAt,
    attempts,
    rangesLoaded: Object.keys(sheets).length,
    cacheExpiresAt: null,
    message: `Google Sheets tersinkron dalam ${attempts} percobaan.`,
  });
}

async function loadSnapshot(snapshotPath: string, reason: string): Promise<OperationalDataset> {
  const startedAt = Date.now();
  const compressed = await readFile(snapshotPath);
  const decoded = await gunzipAsync(compressed);
  const value = JSON.parse(decoded.toString("utf8")) as OperationalDataset;
  const compacted = compactDataset({ ...value, sourceMode: "snapshot", sourceName: `${value.sourceName} · snapshot terakhir` });
  return withSync(compacted, {
    provider: "snapshot",
    state: "fallback",
    lastAttemptAt: new Date(startedAt).toISOString(),
    lastSuccessAt: value.sync?.lastSuccessAt ?? value.fetchedAt,
    latencyMs: Date.now() - startedAt,
    attempts: 1,
    rangesLoaded: value.sync?.rangesLoaded ?? 0,
    cacheExpiresAt: null,
    message: reason,
  });
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
  if (workbookPath && await snapshotIsCurrent(snapshotPath, workbookPath)) {
    return loadSnapshot(snapshotPath, "Snapshot lokal dipakai karena belum ada perubahan pada workbook.");
  }

  try {
    const value = workbookPath ? await loadWorkbook(workbookPath) : await loadGoogleSheets();
    await saveSnapshot(snapshotPath, value).catch(() => undefined);
    return value;
  } catch (error) {
    if (await snapshotIsCurrent(snapshotPath)) {
      const reason = error instanceof Error ? error.message : "Sumber utama tidak tersedia.";
      return loadSnapshot(snapshotPath, `Fallback aktif: ${reason}`);
    }
    throw error;
  }
}

function cacheTtlMs(value: OperationalDataset): number {
  const fallback = value.sync?.provider === "google" ? 30 : value.sync?.provider === "workbook" ? 3_600 : 300;
  return positiveInteger(process.env.DATA_CACHE_SECONDS, fallback, 15, 86_400) * 1_000;
}

function asCached(value: OperationalDataset, expiresAt: number): OperationalDataset {
  if (!value.sync) return value;
  return {
    ...value,
    sync: {
      ...value.sync,
      state: value.sync.state === "fallback" ? "fallback" : "cached",
      cacheExpiresAt: new Date(expiresAt).toISOString(),
      isStale: ageSeconds(value.sync.lastSuccessAt) > value.sync.staleAfterSeconds,
      message: value.sync.state === "fallback" ? value.sync.message : "Cache cepat aktif; sinkron otomatis berjalan saat cache kedaluwarsa.",
    },
  };
}

export async function getOperationalDataset(options: { force?: boolean } = {}): Promise<OperationalDataset> {
  const now = Date.now();
  if (!options.force && cache && cache.expiresAt > now) return asCached(cache.value, cache.expiresAt);
  if (pendingLoad) return pendingLoad;
  pendingLoad = loadSource();
  try {
    const value = await pendingLoad;
    const expiresAt = Date.now() + cacheTtlMs(value);
    const cachedValue = value.sync ? { ...value, sync: { ...value.sync, cacheExpiresAt: new Date(expiresAt).toISOString() } } : value;
    cache = { value: cachedValue, expiresAt };
    return cachedValue;
  } finally {
    pendingLoad = null;
  }
}

export const __sourceTest = { ageSeconds, retryableStatus, retryDelayMs, sheetNameFromRange, positiveInteger };
