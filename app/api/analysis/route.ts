import { NextRequest, NextResponse } from "next/server";
import { buildAnalysis } from "@/lib/analysis/engine";
import { getOperationalDataset } from "@/lib/data/source";
import type { Period } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const warehouses = new Set(["PGS", "SRG", "BIT", "STR"]);
const periods = new Set<Period>(["daily", "weekly", "monthly", "custom"]);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(value: string | null): value is string {
  if (!value || !isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function invalidParameters(detail: string) {
  return NextResponse.json({ error: "Filter tanggal tidak valid", detail }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const warehouseParam = request.nextUrl.searchParams.get("warehouse") ?? "PGS";
  const periodParam = (request.nextUrl.searchParams.get("period") ?? "weekly") as Period;
  const division = (request.nextUrl.searchParams.get("division") ?? "All").slice(0, 80);
  const role = (request.nextUrl.searchParams.get("role") ?? "All").slice(0, 120);
  const asOfParam = request.nextUrl.searchParams.get("asOf");
  const startDateParam = request.nextUrl.searchParams.get("startDate");
  const endDateParam = request.nextUrl.searchParams.get("endDate");
  if (asOfParam && !validIsoDate(asOfParam)) return invalidParameters("Format data cut-off harus YYYY-MM-DD.");
  if (Boolean(startDateParam) !== Boolean(endDateParam)) return invalidParameters("Tanggal mulai dan tanggal akhir harus diisi bersama.");
  if ((startDateParam && !validIsoDate(startDateParam)) || (endDateParam && !validIsoDate(endDateParam))) return invalidParameters("Format rentang tanggal harus YYYY-MM-DD.");
  if (startDateParam && endDateParam && startDateParam > endDateParam) return invalidParameters("Tanggal mulai tidak boleh melewati tanggal akhir.");
  if (periodParam === "custom" && (!startDateParam || !endDateParam)) return invalidParameters("Periode kustom membutuhkan tanggal mulai dan tanggal akhir.");
  const rangeDays = startDateParam && endDateParam ? Math.floor((Date.parse(`${endDateParam}T00:00:00Z`) - Date.parse(`${startDateParam}T00:00:00Z`)) / 86_400_000) + 1 : 0;
  if (rangeDays > 180) return invalidParameters("Rentang maksimum adalah 180 hari.");
  const asOf = asOfParam ?? undefined;
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  const warehouse = warehouses.has(warehouseParam) ? warehouseParam : "PGS";
  const period = startDateParam && endDateParam ? "custom" : periods.has(periodParam) ? periodParam : "weekly";

  try {
    const dataset = await getOperationalDataset({ force });
    let payload;
    try {
      payload = buildAnalysis(dataset, warehouse, period, { division, role, asOf, startDate: startDateParam ?? undefined, endDate: endDateParam ?? undefined });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Filter analisis tidak dapat diterapkan.";
      return invalidParameters(detail);
    }
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Server-Timing": `source;dur=${dataset.sync?.latencyMs ?? 0};desc=\"${dataset.sync?.state ?? dataset.sourceMode}\"`,
        "X-Data-State": dataset.sync?.state ?? dataset.sourceMode,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown source error";
    return NextResponse.json(
      {
        error: "Data source belum siap",
        detail: message,
        remediation: "Set GOOGLE_SERVICE_ACCOUNT_EMAIL dan GOOGLE_PRIVATE_KEY, lalu share Sheet sebagai Viewer ke service account tersebut. Untuk lokal, FIT_WORKBOOK_PATH dapat menunjuk ke file ekspor .xlsx.",
      },
      { status: 503 },
    );
  }
}
