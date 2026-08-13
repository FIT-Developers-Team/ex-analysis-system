import { describe, expect, it } from "vitest";
import { buildAnalysis, __test } from "@/lib/analysis/engine";
import type { MetricPoint, OperationalDataset } from "@/lib/types";

function point(date: string, metric: string, value: number, division = "Outbound"): MetricPoint {
  return { warehouse: "PGS", date, division, role: "All", remarks: "", metric, detail: "", source: "test", value, quality: "valid" };
}

function dataset(points: MetricPoint[], fetchedAt = "2026-07-26T00:00:00Z"): OperationalDataset {
  return {
    sourceMode: "workbook",
    sourceName: "test",
    fetchedAt,
    points,
    highlights: [],
    diagnostics: { totalCells: points.length, validCells: points.length, blankCells: 0, formulaErrors: 0, futureCells: 0, latestCompleteDate: fetchedAt.slice(0, 10) },
  };
}

/** 56 days of a warehouse that cancels 5 of every 95 requested units. */
function baselinePoints(): MetricPoint[] {
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
    points.push(point(date, "Budget Mandays Picker", 10));
    points.push(point(date, "Actual Mandays Picker", 9));
    points.push(point(date, "SLA Checker Inbound Achievement", 0.99, "Inbound"));
  }
  return points;
}

describe("analysis engine", () => {
  it("uses rolling windows for D/W/M", () => {
    expect(__test.windows("2026-08-12", "weekly").current).toEqual({ start: "2026-08-06", end: "2026-08-12", days: 7 });
    expect(__test.windows("2026-08-12", "daily").previous.end).toBe("2026-08-11");
    expect(__test.jakartaDate("2026-08-13T18:30:00Z")).toBe("2026-08-14");
  });

  it("derives forecast accuracy and cancellation from connected metrics", () => {
    const output = buildAnalysis(dataset(baselinePoints()), "PGS", "weekly");
    // Forecast accuracy uses original demand before cancellation. Cancelling
    // requests is an execution decision and must not rewrite planning quality.
    expect(output.kpis.find((item) => item.key === "forecast_accuracy")?.value).toBe(95);
    expect(output.kpis.find((item) => item.key === "cancel_rate")?.value).toBeCloseTo(5.263, 2);
    expect(output.initiatives.length).toBeGreaterThanOrEqual(2);
    expect(output.functionalModules).toHaveLength(5);
    expect(output.filters.divisions).toContain("Outbound");
    expect(output.pivotRows.some((item) => item.metric === "Outbound Qty Requested")).toBe(true);
    expect(output.volumeFlow).toHaveLength(28);
    expect(output.fulfillmentFunnel.map((item) => item.key)).toEqual(["forecast", "before-cancel", "after-cancel", "rts", "hub"]);
    expect(output.laborBalance).toHaveLength(28);
    expect(output.capacityHistory).toHaveLength(28);
    expect(output.relationshipSignals).toHaveLength(8);
    expect(output.riskMatrix.rows).toHaveLength(7);
    expect(output.riskMatrix.weeks).toHaveLength(8);
    expect(output.decisionInsights.some((item) => item.id === "cancel-not-recovering-productivity")).toBe(true);
    expect(output.initiatives.every((item) => item.owner && item.horizonDays > 0 && item.priorityScore >= 0)).toBe(true);
    expect(output.economics.verdict).toBe("false_economy");
    expect(output.economics.costToServeMdPerThousand).toBeGreaterThan(0);
    expect(output.initiatives.every((item) => item.successGate && item.stopLoss && item.priorityBreakdown)).toBe(true);
    expect(output.initiatives.every((item) => item.adaptiveVariant && item.whyNow && item.trigger)).toBe(true);
    expect(output.initiatives.every((item) => item.portfolioRole && item.decisionQuestion && item.counterfactual && item.leadingIndicators.length)).toBe(true);
    expect(output.causalChains.length).toBeGreaterThanOrEqual(5);
    expect(output.causalChains.some((item) => item.id === "cancel-demand-service" && item.state === "verified")).toBe(true);
    expect(output.intelligence.sourceMetrics).toBeGreaterThan(0);
    expect(output.intelligence.documentedDefinitions + output.intelligence.inferredDefinitions + output.intelligence.unresolvedDefinitions).toBe(output.intelligence.sourceMetrics);
    expect(output.metricCatalog.every((item) => item.readiness && item.decisionRole && item.family)).toBe(true);
    expect(output.operatingPicture.mode).toBe("demand_suppression");
    expect(output.operatingPicture.verifiedFacts.length).toBeGreaterThan(1);
    expect(output.operatingPicture.alternativeExplanations.length).toBeGreaterThan(1);
    expect(output.operationalThreads).toHaveLength(5);
    expect(output.operationalThreads.find((item) => item.id === "demand-labor-service")?.coveragePct).toBeGreaterThan(80);
    expect(output.contextGaps.some((item) => item.id === "cancel-capacity-proof")).toBe(true);
  });

  it("supports a flexible custom window with an equal-length comparison", () => {
    const output = buildAnalysis(dataset(baselinePoints()), "PGS", "custom", { startDate: "2026-06-10", endDate: "2026-06-19" });
    expect(output.context.rangeStart).toBe("2026-06-10");
    expect(output.context.rangeEnd).toBe("2026-06-19");
    expect(output.context.comparisonStart).toBe("2026-05-31");
    expect(output.context.comparisonEnd).toBe("2026-06-09");
    expect(output.volumeFlow).toHaveLength(10);
    expect(output.trends[0]?.values).toHaveLength(10);
  });

  it("rejects custom ranges longer than the dashboard safety limit", () => {
    expect(() => buildAnalysis(dataset(baselinePoints()), "PGS", "custom", { startDate: "2026-01-01", endDate: "2026-07-20" })).toThrow(/maksimum 180 hari/i);
  });

  it("measures fulfillment against demand before cancellation", () => {
    const output = buildAnalysis(dataset(baselinePoints()), "PGS", "weekly");
    // Warehouse FR divides by post-cancel demand and looks near perfect...
    expect(output.kpis.find((item) => item.key === "fulfillment_rate")?.value).toBeCloseTo(98.9, 1);
    // ...while the demand-side view (89 shipped of 95 requested) shows the real gap.
    expect(output.kpis.find((item) => item.key === "demand_fill_rate")?.value).toBeCloseTo(93.68, 1);
  });

  it("cancelling demand cannot improve the demand fill rate", () => {
    const shipped = 89;
    const relaxed = baselinePoints().map((item) =>
      // Cancel twice as much: post-cancel FR improves, demand fill rate must not.
      item.metric === "Outbound Qty Requested" ? { ...item, value: 85 } : item);
    const output = buildAnalysis(dataset(relaxed), "PGS", "weekly");
    expect(output.kpis.find((item) => item.key === "cancel_rate")?.value).toBeGreaterThan(5.263);
    expect(output.kpis.find((item) => item.key === "demand_fill_rate")?.value).toBeCloseTo((shipped / 95) * 100, 1);
    expect(output.kpis.find((item) => item.key === "forecast_accuracy")?.value).toBe(95);
  });

  it("keeps unconfirmed metrics visible but out of decision readiness", () => {
    const points = baselinePoints();
    points.push(point("2026-07-26", "Schedule Accuracy %", 0.62, "Personalia"));
    points.push(point("2026-07-26", "MP Recommendation All Division", 13, "Personalia"));
    const output = buildAnalysis(dataset(points), "PGS", "weekly");
    const schedule = output.metricCatalog.find((item) => item.metric === "Schedule Accuracy %");
    const recommendation = output.metricCatalog.find((item) => item.metric === "MP Recommendation All Division");
    expect(schedule?.readiness).toBe("unconfirmed");
    expect(recommendation?.readiness).toBe("unconfirmed");
    expect(output.functionalModules.flatMap((module) => module.kpis).some((item) => item.key === "schedule_accuracy" || item.key === "planogram_accuracy")).toBe(false);
    expect(output.relationshipSignals.some((item) => item.driverKey === "schedule_accuracy")).toBe(false);
    expect(output.initiatives.every((item) => !item.whyNow.toLowerCase().includes("schedule accuracy"))).toBe(true);
  });

  it("a breaching KPI blocks the controlled status", () => {
    const healthy = __test.healthFrom([
      { key: "forecast_accuracy", label: "", value: 100, previous: null, deltaPct: null, target: 100, unit: "percent", severity: "good", trend: "flat", coverage: 1, interpretation: "" },
      { key: "fulfillment_rate", label: "", value: 100, previous: null, deltaPct: null, target: 99, unit: "percent", severity: "good", trend: "flat", coverage: 1, interpretation: "" },
      { key: "sla_checker_inbound", label: "", value: 100, previous: null, deltaPct: null, target: 98, unit: "percent", severity: "good", trend: "flat", coverage: 1, interpretation: "" },
    ]);
    expect(healthy.status).toBe("controlled");

    const breaching = __test.healthFrom([
      { key: "forecast_accuracy", label: "", value: 100, previous: null, deltaPct: null, target: 100, unit: "percent", severity: "good", trend: "flat", coverage: 1, interpretation: "" },
      { key: "fulfillment_rate", label: "", value: 100, previous: null, deltaPct: null, target: 99, unit: "percent", severity: "good", trend: "flat", coverage: 1, interpretation: "" },
      { key: "sla_checker_inbound", label: "", value: 100, previous: null, deltaPct: null, target: 98, unit: "percent", severity: "good", trend: "flat", coverage: 1, interpretation: "" },
      { key: "cancel_rate", label: "", value: 43, previous: null, deltaPct: null, target: 2, unit: "percent", severity: "critical", trend: "flat", coverage: 1, interpretation: "" },
    ]);
    expect(breaching.status).not.toBe("controlled");
    expect(breaching.criticalKpis).toContain("cancel_rate");
  });

  it("the cockpit gauge and the benchmark row report the same score", () => {
    const output = buildAnalysis(dataset(baselinePoints()), "PGS", "weekly");
    const row = output.warehouseComparison.find((item) => item.warehouse === "PGS");
    expect(row?.healthScore).toBe(output.health.score);
    expect(row?.status).toBe(output.health.status);
    expect(row?.asOf).toBe(output.context.asOf);
  });

  it("scores never flatline, so chronic underperformance still ranks", () => {
    // The old linear penalty returned 0 for both of these, making them indistinguishable.
    const poor = __test.scoreMetric("schedule_accuracy", 52);
    const worse = __test.scoreMetric("schedule_accuracy", 40);
    expect(poor).toBeGreaterThan(0);
    expect(worse).toBeGreaterThan(0);
    expect(poor).toBeGreaterThan(worse);
    // Calibration at the midpoint is preserved: 50 at the same gap as before.
    expect(__test.decayScore(10, 5)).toBeCloseTo(50, 5);
  });

  it("treats zero-volume days as no-operations rather than measurements", () => {
    const points = baselinePoints();
    points.push(point("2026-07-27", "Outbound Qty Requested", 0));
    points.push(point("2026-07-27", "Outbound Qty RTS", 0));
    expect(__test.noOperationDates(points).has("2026-07-27")).toBe(true);
    expect(__test.noOperationDates(points).has("2026-07-01")).toBe(false);
  });

  it("derives correlation confidence from significance, not sample size alone", () => {
    // r=0.02 over 40 days is noise however many days it spans.
    const noise = __test.correlationPValue(0.02, 40);
    expect(noise).toBeGreaterThan(0.5);
    const real = __test.correlationPValue(-0.73, 84);
    expect(real).toBeLessThan(0.0001);
  });

  it("flags correlations whose two sides share a variable", () => {
    const output = buildAnalysis(dataset(baselinePoints()), "PGS", "weekly");
    const mandays = output.relationshipSignals.find((item) => item.id === "mandays-productivity");
    // picker productivity is volume/mandays, so mandays sits on both sides.
    expect(mandays?.sharedTerm).toBeTruthy();
    const attendance = output.relationshipSignals.find((item) => item.id === "attendance-sla");
    expect(attendance?.sharedTerm).toBeNull();
  });

  it("never lets a fallback initiative outrank an evidence-linked one", () => {
    const output = buildAnalysis(dataset(baselinePoints()), "PGS", "weekly");
    const firstFallback = output.initiatives.findIndex((item) => item.linkedPainIds.length === 0);
    const lastEvidenced = output.initiatives.map((item) => item.linkedPainIds.length > 0).lastIndexOf(true);
    if (firstFallback >= 0 && lastEvidenced >= 0) expect(firstFallback).toBeGreaterThan(lastEvidenced);
  });
});
