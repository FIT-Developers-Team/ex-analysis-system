import { describe, expect, it } from "vitest";
import {
  buildFloorBriefing,
  buildFloorStations,
  FLOOR_ENGINE_KEYS,
  FLOOR_METRIC_RULES,
  FLOOR_STATIONS,
  floorScore,
  floorSeverity,
  type FloorResolver,
} from "@/lib/analysis/floor-operations";
import { buildAnalysis } from "@/lib/analysis/engine";
import { METRIC_ALIASES } from "@/lib/data/metric-aliases";
import type { MetricPoint, MetricReading, OperationalDataset } from "@/lib/types";

const engineKeys = new Set<string>(FLOOR_ENGINE_KEYS);

function emptyResolver(overrides: Record<string, number | null> = {}): FloorResolver {
  return {
    raw: (key) => ({ value: overrides[key] ?? null, coverage: key in overrides ? 1 : 0 }),
    kpi: () => undefined,
  };
}

const noopScore = () => 100;

describe("floor station configuration", () => {
  it("resolves every station signal to a rule that can grade it", () => {
    const unknown = FLOOR_STATIONS.flatMap((station) =>
      station.signals.filter((key) => !FLOOR_METRIC_RULES[key] && !engineKeys.has(key)).map((key) => `${station.id}:${key}`));
    expect(unknown).toEqual([]);
  });

  it("maps every floor rule to a source column", () => {
    // A rule with no alias can never match a cell, so it would render as a
    // permanently empty signal and read as "not tracked" rather than "mistyped".
    const unmapped = Object.keys(FLOOR_METRIC_RULES).filter((key) => !METRIC_ALIASES[key]?.length);
    expect(unmapped).toEqual([]);
  });

  it("keeps failure-mode evidence inside the station that owns it", () => {
    // Every key a mode quotes has to be one of its own station's signals,
    // otherwise the evidence line silently renders "n/a" in production.
    const dangling: string[] = [];
    for (const station of FLOOR_STATIONS) {
      const available = new Set(station.signals);
      for (const mode of station.failureModes) {
        const body = mode.evaluate.toString();
        const referenced = [
          ...[...body.matchAll(/value\.([a-z0-9_]+)/g)].map((match) => match[1]),
          ...[...body.matchAll(/fmt\.(?:pct|num)\("([a-z0-9_]+)"/g)].map((match) => match[1]),
        ];
        for (const key of referenced) if (!available.has(key)) dangling.push(`${station.id}/${mode.id}:${key}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("covers the whole chain from vendor arrival to hub handover", () => {
    expect(FLOOR_STATIONS).toHaveLength(12);
    expect(FLOOR_STATIONS[0].stage).toBe("Inbound");
    expect(FLOOR_STATIONS.at(-1)?.stage).toBe("Dispatch");
    expect(FLOOR_STATIONS.every((station) => station.wmsSteps.length > 0 && station.gembaChecks.length > 0)).toBe(true);
    expect(FLOOR_STATIONS.every((station) => station.failureModes.every((mode) => mode.containment && mode.correction && mode.trigger))).toBe(true);
  });
});

describe("floor grading", () => {
  it("shows context metrics without grading them", () => {
    const rule = FLOOR_METRIC_RULES.so_ratio;
    expect(rule.target).toBeNull();
    expect(floorScore(rule, 44)).toBeNull();
    expect(floorSeverity(rule, 44)).toBe("neutral");
  });

  it("gives a zero-target loss metric an absolute watch band", () => {
    // Proportional bands collapse at target 0: 0 x 1.12 is still 0, which would
    // make every non-zero reading an instant breach.
    const rule = FLOOR_METRIC_RULES.checker_late;
    expect(floorSeverity(rule, 0)).toBe("good");
    expect(floorSeverity(rule, 4)).toBe("watch");
    expect(floorSeverity(rule, 40)).toBe("critical");
  });

  it("decays rather than clipping, so two bad readings stay distinguishable", () => {
    const rule = FLOOR_METRIC_RULES.seuic_adoption;
    const bad = floorScore(rule, 40) as number;
    const worse = floorScore(rule, 10) as number;
    expect(bad).toBeGreaterThan(0);
    expect(worse).toBeGreaterThan(0);
    expect(bad).toBeGreaterThan(worse);
  });

  it("scales a fraction unconditionally, including above 2", () => {
    // Collective attainment reaches 2.46 on a light day. A "multiply only if
    // below 2" heuristic rendered that as 2.5% instead of 246%.
    const stations = buildFloorStations(emptyResolver({ packer_attainment_source: 2.458 }), noopScore);
    const signal = stations.find((station) => station.id === "packing-check")?.signals.find((item) => item.key === "packer_attainment_source");
    expect(signal?.value).toBeCloseTo(245.8, 1);
    expect(signal?.severity).toBe("good");
  });
});

describe("floor station state", () => {
  it("marks a station without data as unmeasured, never as healthy", () => {
    const stations = buildFloorStations(emptyResolver(), noopScore);
    expect(stations.every((station) => station.state === "unmeasured")).toBe(true);
    expect(stations.every((station) => station.score === null)).toBe(true);
    const briefing = buildFloorBriefing(stations);
    expect(briefing.unmeasuredCount).toBe(12);
    expect(briefing.measuredStations).toBe(0);
    expect(briefing.constraintStationId).toBeNull();
    expect(briefing.headline).toContain("Belum ada stasiun yang terukur");
  });

  it("fires a failure mode only when its trigger is satisfied", () => {
    const dormant = buildFloorStations(emptyResolver({ po_adjustment: 0, checker_otif: 0.99, checker_late: 0 }), noopScore);
    const active = buildFloorStations(emptyResolver({ po_adjustment: 3, checker_otif: 0.99, checker_late: 0 }), noopScore);
    const modeOf = (list: ReturnType<typeof buildFloorStations>) =>
      list.find((station) => station.id === "po-arrival")?.failureModes.find((mode) => mode.id === "po-adjustment-habit");
    expect(modeOf(dormant)?.active).toBe(false);
    expect(modeOf(dormant)?.evidence).toEqual([]);
    expect(modeOf(active)?.active).toBe(true);
    expect(modeOf(active)?.evidence[0]).toContain("3");
  });

  it("quotes the engine's own reading for shared KPI keys", () => {
    const reading: MetricReading = {
      key: "cancel_rate", label: "Request cancelled", value: 9.03, previous: null, deltaPct: null,
      target: 2, unit: "percent", severity: "critical", trend: "flat", coverage: 1, interpretation: "test",
    };
    const stations = buildFloorStations({ raw: () => ({ value: null, coverage: 0 }), kpi: (key) => key === "cancel_rate" ? reading : undefined }, noopScore);
    const signal = stations.find((station) => station.id === "outbound-wave")?.signals.find((item) => item.key === "cancel_rate");
    expect(signal?.value).toBe(9.03);
    expect(signal?.severity).toBe("critical");
  });
});

describe("floor layer inside the analysis payload", () => {
  function point(date: string, metric: string, value: number, division = "Outbound"): MetricPoint {
    return { warehouse: "PGS", date, division, role: "All", remarks: "", metric, detail: "", source: "test", value, quality: "valid" };
  }

  function dataset(points: MetricPoint[]): OperationalDataset {
    return {
      sourceMode: "workbook",
      sourceName: "test",
      fetchedAt: "2026-07-26T00:00:00Z",
      points,
      highlights: [],
      diagnostics: { totalCells: points.length, validCells: points.length, blankCells: 0, formulaErrors: 0, futureCells: 0, latestCompleteDate: "2026-07-26" },
    };
  }

  it("builds stations from the same points as the KPI layer", () => {
    const points: MetricPoint[] = [];
    for (let index = 0; index < 30; index += 1) {
      const date = new Date(Date.UTC(2026, 5, 1 + index)).toISOString().slice(0, 10);
      points.push(point(date, "Outbound Forecast Weekly", 100));
      points.push(point(date, "Outbound Qty Requested (Before Cancel)", 95));
      points.push(point(date, "Outbound Qty Requested", 90));
      points.push(point(date, "Outbound Qty RTS", 89));
      points.push(point(date, "Outbound Qty Actual (Hub Received)", 80));
      points.push(point(date, "Picker Productivity Target", 1000));
      points.push(point(date, "Picker Actual Productivity Collective", 900));
      points.push(point(date, "Budget Mandays Picker", 10));
      points.push(point(date, "Actual Mandays Picker", 9));
      points.push(point(date, "Adoption Rate SEUIC %", 0.99));
      points.push(point(date, "Koli Hilang di Staging %", 0.004));
    }
    const output = buildAnalysis(dataset(points), "PGS", "weekly");

    expect(output.floorStations).toHaveLength(12);
    const cancelKpi = output.kpis.find((item) => item.key === "cancel_rate")?.value;
    const wave = output.floorStations.find((station) => station.id === "outbound-wave");
    expect(wave?.signals.find((item) => item.key === "cancel_rate")?.value).toBe(cancelKpi);

    // RTS above hub received is a real, closable gap and must raise its mode.
    const loading = output.floorStations.find((station) => station.id === "loading-hub");
    expect(loading?.failureModes.find((mode) => mode.id === "rts-hub-gap")?.active).toBe(true);

    // A leak of 0.4% is over the 0.1% working threshold.
    const packing = output.floorStations.find((station) => station.id === "packing-check");
    expect(packing?.signals.find((item) => item.key === "staging_lost_rate")?.severity).toBe("critical");

    // Stations with no source column here stay unmeasured rather than scoring 100.
    expect(output.floorStations.some((station) => station.state === "unmeasured")).toBe(true);
    expect(output.floorBriefing.unmeasuredCount).toBeGreaterThan(0);
  });
});
