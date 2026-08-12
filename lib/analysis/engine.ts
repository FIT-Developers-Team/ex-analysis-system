import { metricAliasKeys, normalizeLabel } from "@/lib/data/metric-aliases";
import type {
  AnalysisPayload,
  AggregationMode,
  CapacityZone,
  DriverSignal,
  FunctionalModule,
  Initiative,
  MetricPoint,
  MetricReading,
  OperationalDataset,
  PainPoint,
  Period,
  Severity,
  TrendSeries,
  PivotMetricRow,
  WarehouseComparisonRow,
} from "@/lib/types";

type Window = { start: string; end: string; days: number };
type Aggregate = { value: number | null; coverage: number; count: number };

const DAY = 86_400_000;
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const iso = (date: Date) => date.toISOString().slice(0, 10);
const aggregateCache = new WeakMap<MetricPoint[], Map<string, Aggregate>>();
const metricIndexCache = new WeakMap<MetricPoint[], Map<string, MetricPoint[]>>();

function shiftIso(date: string, days: number): string {
  return iso(new Date(new Date(`${date}T00:00:00Z`).valueOf() + days * DAY));
}

function windows(asOf: string, period: Period): { current: Window; previous: Window } {
  const days = period === "daily" ? 1 : period === "weekly" ? 7 : 30;
  return {
    current: { start: shiftIso(asOf, -(days - 1)), end: asOf, days },
    previous: { start: shiftIso(asOf, -(days * 2 - 1)), end: shiftIso(asOf, -days), days },
  };
}

function pointsFor(points: MetricPoint[], key: string, window: Window): MetricPoint[] {
  let index = metricIndexCache.get(points);
  if (!index) {
    index = new Map();
    for (const point of points) {
      if (point.quality !== "valid") continue;
      for (const aliasKey of metricAliasKeys(point.metric)) {
        const bucket = index.get(aliasKey);
        if (bucket) bucket.push(point);
        else index.set(aliasKey, [point]);
      }
    }
    metricIndexCache.set(points, index);
  }
  return (index.get(key) ?? []).filter((point) => point.date >= window.start && point.date <= window.end);
}

function aggregate(points: MetricPoint[], key: string, window: Window, mode: AggregationMode = "average"): Aggregate {
  let pointCache = aggregateCache.get(points);
  if (!pointCache) {
    pointCache = new Map();
    aggregateCache.set(points, pointCache);
  }
  const cacheKey = `${key}|${window.start}|${window.end}|${mode}`;
  const cached = pointCache.get(cacheKey);
  if (cached) return cached;
  const selected = pointsFor(points, key, window).filter((point) => point.value !== null);
  const values = selected.map((point) => point.value as number);
  const dates = new Set(selected.map((point) => point.date));
  if (!values.length) {
    const empty = { value: null, coverage: 0, count: 0 };
    pointCache.set(cacheKey, empty);
    return empty;
  }
  const latestDate = [...dates].sort().at(-1);
  const latestValues = selected.filter((point) => point.date === latestDate).map((point) => point.value as number);
  const value = mode === "sum" ? values.reduce((sum, item) => sum + item, 0)
    : mode === "max" ? Math.max(...values)
    : mode === "latest" ? latestValues.reduce((sum, item) => sum + item, 0) / latestValues.length
    : values.reduce((sum, item) => sum + item, 0) / values.length;
  const result = { value, coverage: Math.min(1, dates.size / window.days), count: values.length };
  pointCache.set(cacheKey, result);
  return result;
}

function ratio(numerator: Aggregate, denominator: Aggregate, scale = 100): Aggregate {
  if (numerator.value === null || denominator.value === null || denominator.value === 0) return { value: null, coverage: Math.min(numerator.coverage, denominator.coverage), count: 0 };
  return { value: (numerator.value / denominator.value) * scale, coverage: Math.min(numerator.coverage, denominator.coverage), count: Math.min(numerator.count, denominator.count) };
}

function metricValue(points: MetricPoint[], key: string, window: Window, mode: AggregationMode = "average") {
  return aggregate(points, key, window, mode);
}

function derived(points: MetricPoint[], key: string, window: Window): Aggregate {
  switch (key) {
    case "inbound_forecast_accuracy":
      return ratio(metricValue(points, "actual_inbound", window, "sum"), metricValue(points, "forecast_weekly_inbound", window, "sum"));
    case "inbound_productivity_attainment":
      return ratio(metricValue(points, "checker_productivity", window), metricValue(points, "checker_productivity_target", window));
    case "forecast_accuracy":
      return ratio(metricValue(points, "outbound_requested", window, "sum"), metricValue(points, "forecast_weekly_outbound", window, "sum"));
    case "productivity_attainment":
      return ratio(metricValue(points, "picker_productivity", window), metricValue(points, "picker_productivity_target", window));
    case "putaway_productivity_attainment":
      return ratio(metricValue(points, "putaway_productivity", window), metricValue(points, "putaway_productivity_target", window));
    case "inbound_capacity_utilization":
      return ratio(metricValue(points, "actual_inbound", window, "sum"), metricValue(points, "inbound_capacity", window, "sum"));
    case "inventory_capacity_utilization":
      return ratio(metricValue(points, "inventory_actual", window, "max"), metricValue(points, "inventory_capacity", window, "max"));
    case "outbound_capacity_utilization":
      return ratio(metricValue(points, "outbound_requested", window, "sum"), metricValue(points, "outbound_capacity", window, "sum"));
    case "mandays_variance": {
      const actual = metricValue(points, "actual_picker_mandays", window, "sum");
      const budget = metricValue(points, "budget_picker_mandays", window, "sum");
      if (actual.value === null || budget.value === null || budget.value === 0) return { value: null, coverage: Math.min(actual.coverage, budget.coverage), count: 0 };
      return { value: ((actual.value - budget.value) / budget.value) * 100, coverage: Math.min(actual.coverage, budget.coverage), count: Math.min(actual.count, budget.count) };
    }
    case "cancel_rate": {
      const before = metricValue(points, "outbound_before_cancel", window, "sum");
      const after = metricValue(points, "outbound_requested", window, "sum");
      if (before.value === null || after.value === null || before.value === 0) return { value: null, coverage: Math.min(before.coverage, after.coverage), count: 0 };
      return { value: Math.max(0, ((before.value - after.value) / before.value) * 100), coverage: Math.min(before.coverage, after.coverage), count: Math.min(before.count, after.count) };
    }
    case "capacity_utilization": {
      const direct = [metricValue(points, "inbound_utilization", window), metricValue(points, "inventory_utilization_max", window), metricValue(points, "outbound_utilization", window)];
      const derivedCapacity = [
        ratio(metricValue(points, "actual_inbound", window, "sum"), metricValue(points, "inbound_capacity", window, "sum")),
        ratio(metricValue(points, "inventory_actual", window, "max"), metricValue(points, "inventory_capacity", window, "max")),
        ratio(metricValue(points, "outbound_requested", window, "sum"), metricValue(points, "outbound_capacity", window, "sum")),
      ];
      const candidates = [...direct, ...derivedCapacity];
      const valid = candidates.filter((item) => item.value !== null);
      if (!valid.length) return { value: null, coverage: 0, count: 0 };
      const normalized = valid.map((item) => (item.value as number) <= 2 ? (item.value as number) * 100 : item.value as number);
      return { value: Math.max(...normalized), coverage: Math.max(...valid.map((item) => item.coverage)), count: valid.length };
    }
    case "dcc_accuracy": {
      const candidates = ["inventory_accuracy_qty", "inventory_accuracy_sloc", "sloc_qty_accuracy"].map((item) => metricValue(points, item, window)).filter((item) => item.value !== null);
      if (!candidates.length) return { value: null, coverage: 0, count: 0 };
      const values = candidates.map((item) => (item.value as number) <= 2 ? (item.value as number) * 100 : item.value as number);
      return { value: values.reduce((sum, item) => sum + item, 0) / values.length, coverage: Math.min(...candidates.map((item) => item.coverage)), count: candidates.length };
    }
    default:
      return metricValue(points, key, window);
  }
}

function normalizePercent(key: string, value: number | null): number | null {
  if (value === null) return null;
  const directPercent = new Set(["inbound_forecast_accuracy", "inbound_productivity_attainment", "forecast_accuracy", "productivity_attainment", "putaway_productivity_attainment", "inbound_capacity_utilization", "inventory_capacity_utilization", "outbound_capacity_utilization", "mandays_variance", "cancel_rate", "capacity_utilization", "dcc_accuracy"]);
  return !directPercent.has(key) && Math.abs(value) <= 2 ? value * 100 : value;
}

const rules: Record<string, { label: string; unit: MetricReading["unit"]; target: number | null; higher: boolean; interpretation: string }> = {
  inbound_forecast_accuracy: { label: "Inbound forecast accuracy", unit: "percent", target: 100, higher: true, interpretation: "Actual inbound vs weekly forecast; zona sehat 90–110%." },
  inbound_productivity_attainment: { label: "Checker productivity", unit: "percent", target: 100, higher: true, interpretation: "Actual checker output per manday terhadap productivity target." },
  forecast_accuracy: { label: "Forecast accuracy", unit: "percent", target: 100, higher: true, interpretation: "Actual outbound vs weekly forecast; zona sehat 90–110%." },
  productivity_attainment: { label: "Picker productivity", unit: "percent", target: 100, higher: true, interpretation: "Produktivitas aktual terhadap target; dihitung dari actual goods." },
  putaway_productivity_attainment: { label: "Putaway productivity", unit: "percent", target: 100, higher: true, interpretation: "Actual putaway productivity terhadap target kolektif." },
  inbound_capacity_utilization: { label: "Inbound utilization", unit: "percent", target: 85, higher: false, interpretation: "Actual inbound terhadap max inbound capacity." },
  inventory_capacity_utilization: { label: "Inventory utilization", unit: "percent", target: 85, higher: false, interpretation: "Peak inventory actual terhadap max inventory capacity." },
  outbound_capacity_utilization: { label: "Outbound utilization", unit: "percent", target: 85, higher: false, interpretation: "Request setelah cancel terhadap max outbound capacity." },
  fulfillment_rate: { label: "Warehouse FR", unit: "percent", target: 99, higher: true, interpretation: "RTS terhadap request setelah cancel." },
  sla_checker_inbound: { label: "Inbound checker SLA", unit: "percent", target: 98, higher: true, interpretation: "Guardrail lead time saat mengatur manpower." },
  mandays_variance: { label: "Mandays vs budget", unit: "percent", target: 0, higher: false, interpretation: "Negatif berarti hemat; valid hanya jika SLA dan productivity tetap sehat." },
  capacity_utilization: { label: "Peak capacity", unit: "percent", target: 85, higher: false, interpretation: "Utilisasi tertinggi inbound, inventory, atau outbound." },
  cancel_rate: { label: "Request cancelled", unit: "percent", target: 2, higher: false, interpretation: "Before cancel vs after cancel; harus dibaca bersama FR dan productivity." },
  troubleshoot_fr: { label: "Troubleshoot FR", unit: "percent", target: 90, higher: true, interpretation: "Task executed terhadap task created." },
  dcc_accuracy: { label: "DCC accuracy", unit: "percent", target: 98, higher: true, interpretation: "Rata-rata accuracy Qty, SLOC, dan SLOC × Qty." },
  pick_to_pf: { label: "Pick to PF", unit: "percent", target: 85, higher: true, interpretation: "Share picking dari pickface; berkaitan dengan replenishment dan productivity." },
  attendance_all: { label: "Attendance", unit: "percent", target: 96, higher: true, interpretation: "Actual attendance terhadap schedule keseluruhan." },
  churn_all: { label: "Churn rate", unit: "percent", target: 5, higher: false, interpretation: "Share manpower resign; lebih rendah lebih baik." },
  schedule_accuracy: { label: "Schedule accuracy", unit: "percent", target: 95, higher: true, interpretation: "Kesesuaian scheduled mandays terhadap manpower plan." },
  replenishment_completion: { label: "Replenishment completion", unit: "percent", target: 95, higher: true, interpretation: "Task replenishment yang selesai terhadap task created." },
  on_time_dispatch: { label: "On-time dispatch", unit: "percent", target: 98, higher: true, interpretation: "Dispatch sesuai cut-off warehouse/fleet." },
  on_time_arrival: { label: "On-time arrival", unit: "percent", target: 98, higher: true, interpretation: "Arrival route sesuai target." },
};

function severity(key: string, value: number | null, target: number | null): Severity {
  if (value === null || target === null) return "neutral";
  if (key.includes("forecast_accuracy")) return value >= 90 && value <= 110 ? "good" : value >= 80 && value <= 120 ? "watch" : "critical";
  if (key === "mandays_variance") return value <= 0 ? "good" : value <= 8 ? "watch" : "critical";
  if (key.includes("capacity_utilization")) return value < 85 ? "good" : value <= 92 ? "watch" : "critical";
  if (key === "cancel_rate") return value <= target ? "good" : value <= 5 ? "watch" : "critical";
  const rule = rules[key];
  if (!rule) return "neutral";
  if (rule.higher) return value >= target ? "good" : value >= target * 0.92 ? "watch" : "critical";
  return value <= target ? "good" : value <= target * 1.12 ? "watch" : "critical";
}

function reading(points: MetricPoint[], key: string, current: Window, previous: Window): MetricReading {
  const currentAgg = derived(points, key, current);
  const previousAgg = derived(points, key, previous);
  const value = normalizePercent(key, currentAgg.value);
  const previousValue = normalizePercent(key, previousAgg.value);
  const deltaPct = value !== null && previousValue !== null && previousValue !== 0 ? ((value - previousValue) / Math.abs(previousValue)) * 100 : null;
  const rule = rules[key];
  return {
    key,
    label: rule.label,
    value,
    previous: previousValue,
    deltaPct,
    target: rule.target,
    unit: rule.unit,
    severity: severity(key, value, rule.target),
    trend: deltaPct === null || Math.abs(deltaPct) < 0.5 ? "flat" : deltaPct > 0 ? "up" : "down",
    coverage: currentAgg.coverage,
    interpretation: rule.interpretation,
  };
}

function dailyTrend(points: MetricPoint[], key: string, asOf: string): TrendSeries {
  const rule = rules[key];
  const values = Array.from({ length: 28 }, (_, index) => shiftIso(asOf, index - 27)).map((date) => {
    const value = normalizePercent(key, derived(points, key, { start: date, end: date, days: 1 }).value);
    return { date, value };
  });
  return { key, label: rule.label, unit: rule.unit, values };
}

function scoreMetric(key: string, value: number | null): number {
  if (value === null) return 50;
  switch (key) {
    case "forecast_accuracy":
    case "inbound_forecast_accuracy": return clamp(100 - Math.abs(value - 100) * 2.5);
    case "productivity_attainment":
    case "inbound_productivity_attainment":
    case "putaway_productivity_attainment": return clamp(value);
    case "fulfillment_rate": return clamp(100 - Math.max(0, 99 - value) * 8);
    case "sla_checker_inbound": return clamp(100 - Math.max(0, 98 - value) * 5);
    case "mandays_variance": return clamp(100 - Math.max(0, value) * 4);
    case "capacity_utilization":
    case "inbound_capacity_utilization":
    case "inventory_capacity_utilization":
    case "outbound_capacity_utilization": return value <= 85 ? 100 : clamp(100 - (value - 85) * 6);
    case "cancel_rate": return clamp(100 - Math.max(0, value - 2) * 10);
    case "dcc_accuracy": return clamp(value);
    case "attendance_all": return clamp(100 - Math.max(0, 96 - value) * 5);
    case "churn_all": return clamp(100 - Math.max(0, value - 5) * 8);
    case "schedule_accuracy":
    case "replenishment_completion":
    case "on_time_dispatch":
    case "on_time_arrival": return clamp(100 - Math.max(0, (rules[key]?.target ?? 95) - value) * 5);
    default: return clamp(value);
  }
}

function weeklyBreachCount(points: MetricPoint[], key: string, asOf: string, predicate: (value: number) => boolean): { weeks: number; samples: string[] } {
  let weeks = 0;
  const samples: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    const end = shiftIso(asOf, -index * 7);
    const window = { start: shiftIso(end, -6), end, days: 7 };
    const value = normalizePercent(key, derived(points, key, window).value);
    if (value !== null && predicate(value)) {
      weeks += 1;
      samples.push(`${window.start}–${window.end}: ${value.toFixed(1)}%`);
    }
  }
  return { weeks, samples: samples.slice(0, 3) };
}

function painAnalysis(points: MetricPoint[], warehouse: string, asOf: string): PainPoint[] {
  const definitions = [
    { id: "forecast", title: "Demand variance melemahkan manpower plan", domain: "Planning", key: "forecast_accuracy", predicate: (v: number) => v < 85 || v > 115, hypothesis: "Forecast yang tidak akurat membuat MPP fixed tidak sejalan dengan actual workload." },
    { id: "productivity", title: "Produktivitas picker berulang di bawah target", domain: "Outbound", key: "productivity_attainment", predicate: (v: number) => v < 92, hypothesis: "Gap dapat berasal dari volume dilution, pickface availability, allocation MP, atau process loss." },
    { id: "cancel", title: "Cancel request belum memberi manfaat operasi", domain: "Outbound", key: "cancel_rate", predicate: (v: number) => v > 3, hypothesis: "Cancel dapat mengurangi denominator tanpa menghilangkan fixed mandays sehingga productivity tetap tidak membaik." },
    { id: "capacity", title: "Capacity pressure berulang", domain: "Capacity", key: "capacity_utilization", predicate: (v: number) => v > 90, hypothesis: "Zona jenuh meningkatkan queue, travel, dan risiko SLA meskipun manpower ditambah." },
    { id: "troubleshoot", title: "Recovery troubleshoot belum stabil", domain: "Inventory", key: "troubleshoot_fr", predicate: (v: number) => v < 85, hypothesis: "Task recovery tertinggal terhadap creation; cek MP, aging task, dan kualitas SLOC." },
    { id: "dcc", title: "Inventory accuracy belum terkendali", domain: "Inventory", key: "dcc_accuracy", predicate: (v: number) => v < 95, hypothesis: "Kualitas SLOC memicu lost, troubleshoot, replenishment rework, dan productivity loss." },
  ];
  return definitions.map((definition) => ({ definition, evidence: weeklyBreachCount(points, definition.key, asOf, definition.predicate) }))
    .filter(({ evidence }) => evidence.weeks >= 2)
    .sort((a, b) => b.evidence.weeks - a.evidence.weeks)
    .slice(0, 5)
    .map(({ definition, evidence }) => ({
      id: `${warehouse}-${definition.id}`,
      warehouse,
      title: definition.title,
      domain: definition.domain,
      recurrenceWeeks: evidence.weeks,
      severity: evidence.weeks >= 5 ? "high" : "medium",
      confidence: evidence.weeks >= 4 ? "high" : "medium",
      evidence: evidence.samples,
      hypothesis: definition.hypothesis,
    }));
}

function buildInitiatives(warehouse: string, pains: PainPoint[]): Initiative[] {
  const templates: Record<string, Omit<Initiative, "id" | "warehouse" | "confidence">> = {
    forecast: { title: "Demand-to-Labor Control Loop", type: "optimize", problem: "MPP dibangun dari forecast tetapi actual workload bergerak berbeda.", intervention: "Buat daily reforecast H-1/H-0, flex band ±10%, dan cross-role redeployment berbasis remaining workload.", expectedImpact: "Menekan productivity dilution tanpa mengorbankan inbound SLA atau fulfillment.", measurement: ["Forecast accuracy", "Mandays variance", "Productivity attainment", "SLA checker"], first14Days: ["Baseline error per weekday dan cut-off", "Definisikan flex pool serta trigger 10%", "Pilot satu shift dan review daily"] },
    productivity: { title: "Actual-Volume Productivity Cell", type: "stabilize", problem: "Produktivitas berada di bawah target berulang dan mudah bias oleh forecast atau mandays.", intervention: "Kelola hourly remaining workload, actual mandays, pickface availability, dan loss reason dalam satu control cell.", expectedImpact: "Menaikkan actual pcs/manday dengan bukti driver, bukan sekadar mengejar target agregat.", measurement: ["Actual volume per manday", "Pick to PF", "Pick to Lost", "FR"], first14Days: ["Pareto 3 loss reason per shift", "Tetapkan hourly recovery owner", "Bandingkan regular vs OJT productivity"] },
    cancel: { title: "Cancel Challenge Gate", type: "validate", problem: "Request dibatalkan saat kemampuan warehouse belum dibuktikan secara kuantitatif.", intervention: "Wajibkan capacity proof sebelum cancel: remaining volume, remaining hours, attendance, run-rate, dan risk-to-SLA.", expectedImpact: "Mengurangi avoidable cancel dan menjaga denominator productivity serta service level.", measurement: ["Cancel rate", "FR before/after cancel", "Productivity", "Capacity headroom"], first14Days: ["Tag reason setiap cancel", "Backtest 4 minggu", "Aktifkan approval gate untuk cancel >2%"] },
    capacity: { title: "Zone Capacity Guardrail", type: "stabilize", problem: "Salah satu area frozen/chiller/ambient mendekati atau melewati operating envelope.", intervention: "Gunakan zonal heatmap, H+3 projection, dan trigger overflow/milkrun sebelum occupancy masuk zona jenuh.", expectedImpact: "Mengurangi congestion, putaway delay, dan risiko SLA lintas fungsi.", measurement: ["Actual vs max per zone", "Putaway lead time", "Inbound utilization", "Lost/rework"], first14Days: ["Validasi max capacity tiap zone", "Set warning 85% dan critical 92%", "Simulasikan overflow playbook"] },
    troubleshoot: { title: "Troubleshoot Recovery Engine", type: "optimize", problem: "Task troubleshoot berulang tidak pulih dengan laju yang cukup.", intervention: "Prioritaskan task berdasarkan value-at-risk, aging, SLOC confidence, dan peluang found; sesuaikan MP per queue.", expectedImpact: "Meningkatkan FR troubleshoot dan menurunkan lost serta dampaknya ke SO fulfillment.", measurement: ["Troubleshoot FR", "Queue aging", "Found %", "Contribution to SO FR"], first14Days: ["Buat aging bucket", "Pisahkan fast-win vs deep search", "Uji allocation MP berdasar arrival rate"] },
    dcc: { title: "SLOC Reliability Sprint", type: "stabilize", problem: "Akurasi inventory yang rendah menimbulkan loss berantai ke replenishment, troubleshoot, dan picking.", intervention: "Targetkan SLOC berulang bermasalah dengan DCC risk-based, root-cause tag, dan close-loop correction.", expectedImpact: "Meningkatkan SLOC × Qty accuracy serta mengurangi task lost dan rework.", measurement: ["SLOC × Qty accuracy", "LDP/LBH", "Pick to Lost", "Replenishment completion"], first14Days: ["Pareto SLOC repeat offender", "Audit 20 SLOC tertinggi", "Lock owner dan due date correction"] },
  };
  const selected = pains.slice(0, 3).map((pain) => {
    const key = pain.id.split("-").at(-1) ?? "productivity";
    return { ...templates[key], id: `${warehouse}-${key}-initiative`, warehouse, confidence: pain.confidence } satisfies Initiative;
  });
  const fallbacks = ["forecast", "productivity"].filter((key) => !selected.some((item) => item.id.includes(`-${key}-`))).map((key) => ({ ...templates[key], id: `${warehouse}-${key}-initiative`, warehouse, confidence: "medium" as const }));
  return [...selected, ...fallbacks].slice(0, 3);
}

function driverSignals(kpis: MetricReading[]): DriverSignal[] {
  return kpis.map((kpi) => {
    const score = Math.round(scoreMetric(kpi.key, kpi.value));
    const direction = score >= 85 ? "positive" : score < 65 ? "negative" : "mixed";
    const value = kpi.value === null ? "belum tersedia" : `${kpi.value.toFixed(1)}%`;
    return { label: kpi.label, score, direction, evidence: `${value}; coverage ${(kpi.coverage * 100).toFixed(0)}%.` } satisfies DriverSignal;
  }).sort((a, b) => a.score - b.score).slice(0, 6);
}

const MODULES: Array<{ division: string; matches: string[]; keys: string[] }> = [
  { division: "Personalia", matches: ["personalia", "personal"], keys: ["attendance_all", "churn_all", "schedule_accuracy"] },
  { division: "Inbound", matches: ["inbound"], keys: ["inbound_forecast_accuracy", "inbound_productivity_attainment", "sla_checker_inbound", "inbound_capacity_utilization"] },
  { division: "Inventory", matches: ["inventory"], keys: ["putaway_productivity_attainment", "inventory_capacity_utilization", "dcc_accuracy", "troubleshoot_fr", "replenishment_completion"] },
  { division: "Outbound", matches: ["outbound"], keys: ["forecast_accuracy", "productivity_attainment", "fulfillment_rate", "cancel_rate", "outbound_capacity_utilization", "pick_to_pf"] },
  { division: "Fleet", matches: ["fleet"], keys: ["on_time_dispatch", "on_time_arrival"] },
];

function canonicalDivision(value: string): string {
  const normalized = normalizeLabel(value);
  return MODULES.find((module) => module.matches.some((match) => normalized.includes(match)))?.division ?? (value.trim() || "Unmapped");
}

function functionalModules(points: MetricPoint[], current: Window, previous: Window): FunctionalModule[] {
  return MODULES.map((module) => {
    const modulePoints = points.filter((point) => canonicalDivision(point.division) === module.division);
    const kpis = module.keys.map((key) => reading(modulePoints, key, current, previous));
    const available = kpis.filter((item) => item.value !== null);
    if (!available.length) return { division: module.division, score: 0, status: "unavailable", headline: "Data belum tersedia", kpis };
    const score = Math.round(available.reduce((sum, item) => sum + scoreMetric(item.key, item.value), 0) / available.length);
    const status = score < 65 ? "critical" : score < 82 ? "watch" : "controlled";
    const weakest = [...available].sort((a, b) => scoreMetric(a.key, a.value) - scoreMetric(b.key, b.value))[0];
    return {
      division: module.division,
      score,
      status,
      headline: weakest ? `${weakest.label} menjadi constraint utama` : "Belum ada constraint terukur",
      kpis,
    };
  });
}

function inferPivotSpec(metric: string): { aggregation: AggregationMode; unit: MetricReading["unit"]; lowerIsBetter: boolean } {
  const value = normalizeLabel(metric);
  const percent = value.includes("%") || value.includes("rate") || value.includes("accuracy") || value.includes("achievement") || value.includes("utilization") || value.includes("sla") || value.includes("attendance") || value.includes("churn") || value.includes("fulfillment");
  const ratioUnit = value.includes("productivity") || value.includes("leadtime");
  const currency = value.includes("value") || value.includes("rupiah") || value.includes("cost");
  const mandays = value.includes("manday") || value.includes("man day");
  const latest = value.includes("ending") || value.includes("inventory actual") || value.includes("inventory capacity");
  const average = percent || ratioUnit;
  const aggregation: AggregationMode = latest ? "latest" : average ? "average" : "sum";
  const unit: MetricReading["unit"] = percent ? "percent" : ratioUnit ? "ratio" : currency ? "currency" : mandays ? "mandays" : "qty";
  const lowerIsBetter = ["cancel", "churn", "lost", "ldp", "lbh", "error", "leadtime", "aging"].some((token) => value.includes(token));
  return { aggregation, unit, lowerIsBetter };
}

function aggregateRaw(points: MetricPoint[], window: Window, aggregation: AggregationMode, unit: MetricReading["unit"]): Aggregate {
  const selected = points.filter((point) => point.date >= window.start && point.date <= window.end && point.quality === "valid" && point.value !== null);
  if (!selected.length) return { value: null, coverage: 0, count: 0 };
  const dates = new Set(selected.map((point) => point.date));
  const values = selected.map((point) => point.value as number);
  const latestDate = [...dates].sort().at(-1);
  const latestValues = selected.filter((point) => point.date === latestDate).map((point) => point.value as number);
  let value = aggregation === "sum" ? values.reduce((sum, item) => sum + item, 0)
    : aggregation === "max" ? Math.max(...values)
    : aggregation === "latest" ? latestValues.reduce((sum, item) => sum + item, 0) / latestValues.length
    : values.reduce((sum, item) => sum + item, 0) / values.length;
  if (unit === "percent" && Math.abs(value) <= 2) value *= 100;
  return { value, coverage: Math.min(1, dates.size / window.days), count: selected.length };
}

function pivotMetrics(points: MetricPoint[], current: Window, previous: Window, division: string, role: string): PivotMetricRow[] {
  const selected = points.filter((point) => (division === "All" || canonicalDivision(point.division) === division) && (role === "All" || point.role === role));
  const grouped = new Map<string, MetricPoint[]>();
  for (const point of selected) {
    const key = [point.division, point.role, point.metric, point.detail, point.source].join("|");
    grouped.set(key, [...(grouped.get(key) ?? []), point]);
  }
  return [...grouped.entries()].map(([id, metricPoints]) => {
    const sample = metricPoints[0];
    const spec = inferPivotSpec(sample.metric);
    const currentAgg = aggregateRaw(metricPoints, current, spec.aggregation, spec.unit);
    const previousAgg = aggregateRaw(metricPoints, previous, spec.aggregation, spec.unit);
    const deltaPct = currentAgg.value !== null && previousAgg.value !== null && previousAgg.value !== 0
      ? ((currentAgg.value - previousAgg.value) / Math.abs(previousAgg.value)) * 100
      : null;
    const directionalDelta = deltaPct === null ? null : spec.lowerIsBetter ? -deltaPct : deltaPct;
    const movement = directionalDelta === null ? "unknown" : Math.abs(directionalDelta) < 0.5 ? "stable" : directionalDelta > 0 ? "improving" : "worsening";
    return {
      id,
      division: canonicalDivision(sample.division),
      role: sample.role || "All role",
      metric: sample.metric,
      detail: sample.detail,
      source: sample.source,
      aggregation: spec.aggregation,
      unit: spec.unit,
      current: currentAgg.value,
      previous: previousAgg.value,
      deltaPct,
      coverage: currentAgg.coverage,
      movement,
    } satisfies PivotMetricRow;
  }).sort((a, b) => a.division.localeCompare(b.division) || a.role.localeCompare(b.role) || a.metric.localeCompare(b.metric));
}

function warehouseComparison(dataset: OperationalDataset, period: Period, requestedAsOf?: string): WarehouseComparisonRow[] {
  return ["PGS", "SRG", "BIT", "STR"].map((warehouse) => {
    const points = dataset.points.filter((point) => point.warehouse === warehouse);
    const availableDates = [...new Set(points.filter((point) => point.quality === "valid").map((point) => point.date))].sort();
    const latest = availableDates.filter((date) => !requestedAsOf || date <= requestedAsOf).at(-1);
    if (!latest) return { warehouse, healthScore: 0, forecastAccuracy: null, productivity: null, fulfillment: null, cancelRate: null, dataConfidence: 0 };
    const { current } = windows(latest, period);
    const metrics = ["forecast_accuracy", "productivity_attainment", "fulfillment_rate", "cancel_rate"].map((key) => reading(points, key, current, current));
    const [forecast, productivity, fulfillment, cancel] = metrics;
    const score = Math.round(metrics.filter((item) => item.value !== null).reduce((sum, item) => sum + scoreMetric(item.key, item.value), 0) / Math.max(1, metrics.filter((item) => item.value !== null).length));
    const dataConfidence = Math.round(metrics.reduce((sum, item) => sum + item.coverage, 0) / metrics.length * 100);
    return { warehouse, healthScore: score, forecastAccuracy: forecast.value, productivity: productivity.value, fulfillment: fulfillment.value, cancelRate: cancel.value, dataConfidence };
  });
}

function capacityZones(points: MetricPoint[], current: Window): CapacityZone[] {
  return (["Ambient", "Chiller", "Frozen"] as const).map((zone) => {
    const suffix = normalizeLabel(zone);
    const actualPoints = points.filter((point) => normalizeLabel(point.metric) === `inventory actual max by qty ${suffix}`);
    const maximumPoints = points.filter((point) => normalizeLabel(point.metric) === `inventory capacity max by qty ${suffix}`);
    const actual = aggregateRaw(actualPoints, current, "latest", "qty").value;
    const maximum = aggregateRaw(maximumPoints, current, "latest", "qty").value;
    const utilization = actual !== null && maximum !== null && maximum > 0 ? actual / maximum * 100 : null;
    const status = utilization === null ? "unavailable" : utilization >= 92 ? "critical" : utilization >= 85 ? "watch" : "controlled";
    return { zone, actual, maximum, utilization, status };
  });
}

function latestOperationalDate(points: MetricPoint[], validDates: string[]): string | undefined {
  const essentials = new Set(["actual_inbound", "outbound_requested", "outbound_rts", "picker_productivity", "actual_picker_mandays", "inventory_actual"]);
  const coverageByDate = new Map<string, Set<string>>();
  for (const point of points) {
    if (point.quality !== "valid") continue;
    const matched = metricAliasKeys(point.metric).filter((key) => essentials.has(key));
    if (!matched.length) continue;
    const coverage = coverageByDate.get(point.date) ?? new Set<string>();
    matched.forEach((key) => coverage.add(key));
    coverageByDate.set(point.date, coverage);
  }
  return [...validDates].reverse().find((date) => (coverageByDate.get(date)?.size ?? 0) >= 3) ?? validDates.at(-1);
}

export function buildAnalysis(
  dataset: OperationalDataset,
  warehouse: string,
  period: Period,
  options: { division?: string; role?: string; asOf?: string } = {},
): AnalysisPayload {
  const warehousePoints = dataset.points.filter((point) => point.warehouse === warehouse);
  if (!warehousePoints.length) throw new Error(`Data warehouse ${warehouse} tidak ditemukan pada sumber.`);
  const validDates = [...new Set(warehousePoints.filter((point) => point.quality === "valid").map((point) => point.date))].sort();
  const asOf = options.asOf && validDates.includes(options.asOf) ? options.asOf : latestOperationalDate(warehousePoints, validDates);
  if (!asOf) throw new Error(`Tidak ada tanggal valid untuk ${warehouse}.`);
  const { current, previous } = windows(asOf, period);
  const division = options.division && options.division !== "All" ? options.division : "All";
  const role = options.role && options.role !== "All" ? options.role : "All";
  const keys = ["forecast_accuracy", "productivity_attainment", "fulfillment_rate", "sla_checker_inbound", "mandays_variance", "capacity_utilization", "cancel_rate", "troubleshoot_fr", "dcc_accuracy", "pick_to_pf"];
  const kpis = keys.map((key) => reading(warehousePoints, key, current, previous));
  const weightedKeys = ["forecast_accuracy", "productivity_attainment", "fulfillment_rate", "sla_checker_inbound", "capacity_utilization", "cancel_rate", "dcc_accuracy"];
  const scored = weightedKeys.map((key) => kpis.find((item) => item.key === key)).filter((item): item is MetricReading => Boolean(item && item.value !== null));
  const healthScore = scored.length ? Math.round(scored.reduce((sum, item) => sum + scoreMetric(item.key, item.value), 0) / scored.length) : 50;
  const confidence = Math.round(kpis.reduce((sum, item) => sum + item.coverage, 0) / kpis.length * 100);
  const status = scored.length < 3 ? "watch" : healthScore < 65 ? "critical" : healthScore < 82 ? "watch" : "controlled";
  const weakest = [...kpis].filter((item) => item.value !== null).sort((a, b) => scoreMetric(a.key, a.value) - scoreMetric(b.key, b.value)).slice(0, 2);
  const pains = painAnalysis(warehousePoints, warehouse, asOf);
  const dataWarnings: string[] = [];
  if (dataset.diagnostics.formulaErrors > 0) dataWarnings.push(`${dataset.diagnostics.formulaErrors.toLocaleString("id-ID")} sel sumber mengandung formula error dan dikeluarkan dari perhitungan.`);
  if (confidence < 75) dataWarnings.push(`Coverage KPI periode ini ${confidence}%; hasil ber-confidence rendah perlu divalidasi.`);
  if (dataset.diagnostics.futureCells > 0) dataWarnings.push("Tanggal masa depan diperlakukan sebagai plan, bukan actual performance.");
  if (!warehousePoints.some((point) => normalizeLabel(point.metric).includes("forecast") && normalizeLabel(point.metric).includes("relabel"))) dataWarnings.push("Forecast pcs relabel tidak tersedia; productivity relabel tidak boleh dinilai sebagai forecast attainment.");
  if (!warehousePoints.some((point) => normalizeLabel(point.role).includes("troubleshoot") && normalizeLabel(point.metric).includes("manday"))) dataWarnings.push("Mandays troubleshooter tidak tersedia; FR troubleshoot dapat dimonitor, tetapi dampak manpower belum dapat dibuktikan.");

  const catalog = new Map<string, { division: string; role: string; metric: string; detail: string }>();
  for (const point of warehousePoints) {
    const key = `${normalizeLabel(point.division)}|${normalizeLabel(point.role)}|${normalizeLabel(point.metric)}`;
    if (!catalog.has(key)) catalog.set(key, { division: point.division, role: point.role, metric: point.metric, detail: point.detail });
  }

  const divisions = [...new Set(warehousePoints.map((point) => canonicalDivision(point.division)).filter(Boolean))].sort();
  const rolesByDivision: Record<string, string[]> = { All: [...new Set(warehousePoints.map((point) => point.role).filter(Boolean))].sort() };
  for (const item of divisions) rolesByDivision[item] = [...new Set(warehousePoints.filter((point) => canonicalDivision(point.division) === item).map((point) => point.role).filter(Boolean))].sort();
  const modules = functionalModules(warehousePoints, current, previous);
  const activeTrendKeys = division === "All" ? ["forecast_accuracy", "productivity_attainment", "fulfillment_rate", "capacity_utilization", "cancel_rate", "dcc_accuracy"]
    : MODULES.find((module) => module.division === division)?.keys.slice(0, 6) ?? ["forecast_accuracy", "productivity_attainment"];

  return {
    context: { warehouse, period, division, role, asOf, rangeStart: current.start, rangeEnd: current.end, sourceMode: dataset.sourceMode, sourceName: dataset.sourceName, fetchedAt: dataset.fetchedAt },
    health: {
      score: healthScore,
      status,
      headline: scored.length < 3 ? "Data window belum cukup" : status === "critical" ? "Intervensi lintas fungsi diperlukan" : status === "watch" ? "Operasi belum stabil" : "Operasi dalam kendali",
      narrative: weakest.length ? `${weakest.map((item) => item.label).join(" dan ")} menjadi pressure point utama. Baca bersama volume, mandays, SLA, dan capacity—jangan mengoptimalkan satu KPI secara terpisah.` : "Data belum cukup untuk menentukan pressure point; sistem tidak memberi status kritis tanpa evidence minimum.",
      confidence,
      dataWarnings,
    },
    kpis,
    trends: activeTrendKeys.map((key) => dailyTrend(warehousePoints, key, asOf)),
    drivers: driverSignals(kpis),
    painPoints: pains,
    initiatives: buildInitiatives(warehouse, pains),
    filters: { warehouses: ["PGS", "SRG", "BIT", "STR"], divisions, rolesByDivision, availableDates: validDates.slice(-180).reverse() },
    functionalModules: modules,
    capacityZones: capacityZones(warehousePoints, current),
    pivotRows: pivotMetrics(warehousePoints, current, previous, division, role),
    warehouseComparison: warehouseComparison(dataset, period, asOf),
    metricCatalog: [...catalog.values()].sort((a, b) => a.division.localeCompare(b.division) || a.role.localeCompare(b.role) || a.metric.localeCompare(b.metric)),
  };
}

export const __test = { shiftIso, windows, normalizePercent, scoreMetric };
