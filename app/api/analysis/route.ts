import { NextRequest, NextResponse } from "next/server";
import { buildAnalysis } from "@/lib/analysis/engine";
import { getOperationalDataset } from "@/lib/data/source";
import type { Period } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const warehouses = new Set(["PGS", "SRG", "BIT", "STR"]);
const periods = new Set<Period>(["daily", "weekly", "monthly"]);

export async function GET(request: NextRequest) {
  const warehouseParam = request.nextUrl.searchParams.get("warehouse") ?? "PGS";
  const periodParam = (request.nextUrl.searchParams.get("period") ?? "weekly") as Period;
  const division = (request.nextUrl.searchParams.get("division") ?? "All").slice(0, 80);
  const role = (request.nextUrl.searchParams.get("role") ?? "All").slice(0, 120);
  const asOfParam = request.nextUrl.searchParams.get("asOf");
  const asOf = asOfParam && /^\d{4}-\d{2}-\d{2}$/.test(asOfParam) ? asOfParam : undefined;
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  const warehouse = warehouses.has(warehouseParam) ? warehouseParam : "PGS";
  const period = periods.has(periodParam) ? periodParam : "weekly";

  try {
    const dataset = await getOperationalDataset({ force });
    const payload = buildAnalysis(dataset, warehouse, period, { division, role, asOf });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=0, must-revalidate",
        "Server-Timing": `source;desc=\"${dataset.sourceMode}\"`,
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
