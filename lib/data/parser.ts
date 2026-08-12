import type { HighlightRecord, MetricPoint, OperationalDataset } from "@/lib/types";

export type RawCell = string | number | boolean | Date | null | undefined;
export type RawSheet = RawCell[][];

const SHEET_TO_WH: Record<string, string> = {
  "Frozen - PGS": "PGS",
  "Frozen - SRG": "SRG",
  "Frozen - BIT": "BIT",
  "Frozen - STR": "STR",
};

function isoDate(value: RawCell): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && value > 30000 && value < 70000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 86_400_000).toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const direct = /^\d{4}-\d{2}-\d{2}/.exec(normalized)?.[0];
  if (direct) return direct;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

function numberValue(value: RawCell): { value: number | null; quality: MetricPoint["quality"] } {
  if (typeof value === "number" && Number.isFinite(value)) return { value, quality: "valid" };
  if (typeof value === "string" && value.trim().startsWith("#")) return { value: null, quality: "formula_error" };
  if (value === null || value === undefined || value === "") return { value: null, quality: "blank" };
  const parsed = Number(String(value).replaceAll(",", "").replace("%", ""));
  if (!Number.isFinite(parsed)) return { value: null, quality: "blank" };
  return { value: String(value).includes("%") ? parsed / 100 : parsed, quality: "valid" };
}

function normalizeMatrixSheet(name: string, rows: RawSheet, fetchedAt: string): MetricPoint[] {
  const warehouse = SHEET_TO_WH[name];
  if (!warehouse || rows.length < 2) return [];

  const headerRowIndex = rows.findIndex((row) => row.slice(7).filter((cell) => isoDate(cell)).length >= 3);
  if (headerRowIndex < 0) return [];
  const header = rows[headerRowIndex];
  const today = fetchedAt.slice(0, 10);

  return rows.slice(headerRowIndex + 1).flatMap((row) => {
    const metric = String(row[3] ?? "").trim();
    if (!metric) return [];
    const division = String(row[0] ?? "Other").trim() || "Other";
    const role = String(row[1] ?? "All").trim() || "All";
    const remarks = String(row[2] ?? "").trim();
    const detail = String(row[4] ?? "").trim();
    const source = String(row[5] ?? row[6] ?? name).trim();

    return header.flatMap((cell, columnIndex) => {
      const date = isoDate(cell);
      if (!date || columnIndex < 7) return [];
      const parsed = numberValue(row[columnIndex]);
      const quality = date > today && parsed.quality === "valid" ? "future" : parsed.quality;
      return [{ warehouse, date, division, role, remarks, metric, detail, source, value: parsed.value, quality } satisfies MetricPoint];
    });
  });
}

function normalizeHighlights(rows: RawSheet): HighlightRecord[] {
  let contextDate: string | null = null;
  const records: HighlightRecord[] = [];

  for (const row of rows) {
    const maybeDate = isoDate(row[0]);
    if (maybeDate && !String(row[1] ?? "").trim()) {
      contextDate = maybeDate;
      continue;
    }
    const warehouse = String(row[0] ?? "").trim();
    const issue = String(row[2] ?? "").trim();
    if (!warehouse || !issue || warehouse.toLowerCase() === "wh") continue;
    records.push({
      date: contextDate,
      warehouse,
      metric: String(row[1] ?? "").trim(),
      issue,
      actionPlan: String(row[3] ?? "").trim(),
    });
  }
  return records;
}

export function parseOperationalSheets(
  sheets: Record<string, RawSheet>,
  sourceMode: OperationalDataset["sourceMode"],
  sourceName: string,
  fetchedAt = new Date().toISOString(),
): OperationalDataset {
  const points = Object.entries(sheets).flatMap(([name, rows]) => normalizeMatrixSheet(name, rows, fetchedAt));
  const highlights = normalizeHighlights(sheets.Highlight ?? []);
  const latestCompleteDate = points
    .filter((point) => point.quality === "valid")
    .map((point) => point.date)
    .sort()
    .at(-1) ?? null;

  return {
    sourceMode,
    sourceName,
    fetchedAt,
    points,
    highlights,
    diagnostics: {
      totalCells: points.length,
      validCells: points.filter((point) => point.quality === "valid").length,
      blankCells: points.filter((point) => point.quality === "blank").length,
      formulaErrors: points.filter((point) => point.quality === "formula_error").length,
      futureCells: points.filter((point) => point.quality === "future").length,
      latestCompleteDate,
    },
  };
}
