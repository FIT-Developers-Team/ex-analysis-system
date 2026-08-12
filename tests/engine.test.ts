import { describe, expect, it } from "vitest";
import { buildAnalysis, __test } from "@/lib/analysis/engine";
import type { MetricPoint, OperationalDataset } from "@/lib/types";

function point(date: string, metric: string, value: number): MetricPoint {
  return { warehouse: "PGS", date, division: "Outbound", role: "All", remarks: "", metric, detail: "", source: "test", value, quality: "valid" };
}

describe("analysis engine", () => {
  it("uses rolling windows for D/W/M", () => {
    expect(__test.windows("2026-08-12", "weekly").current).toEqual({ start: "2026-08-06", end: "2026-08-12", days: 7 });
    expect(__test.windows("2026-08-12", "daily").previous.end).toBe("2026-08-11");
  });

  it("derives forecast accuracy and cancellation from connected metrics", () => {
    const points: MetricPoint[] = [];
    for (let index = 0; index < 56; index += 1) {
      const date = new Date(Date.UTC(2026, 5, 1 + index)).toISOString().slice(0, 10);
      points.push(point(date, "Outbound Forecast Weekly", 100));
      points.push(point(date, "Outbound Qty Requested (Before Cancel)", 95));
      points.push(point(date, "Outbound Qty Requested", 90));
      points.push(point(date, "Outbound Qty RTS", 89));
      points.push(point(date, "Fulfillment Rate % Warehouse", 0.989));
      points.push(point(date, "Picker Productivity Target", 1000));
      points.push(point(date, "Picker Actual Productivity Collective", 900));
    }
    const dataset: OperationalDataset = { sourceMode: "workbook", sourceName: "test", fetchedAt: "2026-07-26T00:00:00Z", points, highlights: [], diagnostics: { totalCells: points.length, validCells: points.length, blankCells: 0, formulaErrors: 0, futureCells: 0, latestCompleteDate: "2026-07-26" } };
    const output = buildAnalysis(dataset, "PGS", "weekly");
    expect(output.kpis.find((item) => item.key === "forecast_accuracy")?.value).toBe(90);
    expect(output.kpis.find((item) => item.key === "cancel_rate")?.value).toBeCloseTo(5.263, 2);
    expect(output.initiatives.length).toBeGreaterThanOrEqual(2);
    expect(output.functionalModules).toHaveLength(5);
    expect(output.filters.divisions).toContain("Outbound");
    expect(output.pivotRows.some((item) => item.metric === "Outbound Qty Requested")).toBe(true);
    expect(output.warehouseComparison.find((item) => item.warehouse === "PGS")?.productivity).toBe(90);
    expect(output.volumeFlow).toHaveLength(28);
    expect(output.fulfillmentFunnel.map((item) => item.key)).toEqual(["forecast", "before-cancel", "after-cancel", "rts", "hub"]);
    expect(output.laborBalance).toHaveLength(28);
    expect(output.capacityHistory).toHaveLength(28);
    expect(output.relationshipSignals).toHaveLength(9);
    expect(output.relationshipSignals.every((item) => item.coefficient === null && item.strength === "insufficient")).toBe(true);
    expect(output.riskMatrix.rows).toHaveLength(7);
    expect(output.riskMatrix.weeks).toHaveLength(8);
    expect(output.decisionInsights.some((item) => item.id === "cancel-not-recovering-productivity")).toBe(true);
    expect(output.initiatives.every((item) => item.owner && item.horizonDays > 0 && item.priorityScore >= 0)).toBe(true);
  });
});
