import { metricAliasKeys, normalizeLabel } from "@/lib/data/metric-aliases";
import type {
  AnalysisPayload,
  AggregationMode,
  CapacityHistoryPoint,
  CapacityZone,
  DecisionInsight,
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
  FlowStage,
  HighlightRecord,
  LaborBalancePoint,
  PivotMetricRow,
  RelationshipSignal,
  RiskMatrix,
  VolumeFlowPoint,
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
    case "relabel_productivity_attainment":
      return ratio(metricValue(points, "relabel_productivity", window), metricValue(points, "relabel_target", window));
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
  const directPercent = new Set(["inbound_forecast_accuracy", "inbound_productivity_attainment", "forecast_accuracy", "productivity_attainment", "putaway_productivity_attainment", "relabel_productivity_attainment", "inbound_capacity_utilization", "inventory_capacity_utilization", "outbound_capacity_utilization", "mandays_variance", "cancel_rate", "capacity_utilization", "dcc_accuracy"]);
  return !directPercent.has(key) && Math.abs(value) <= 2 ? value * 100 : value;
}

const rules: Record<string, { label: string; unit: MetricReading["unit"]; target: number | null; higher: boolean; interpretation: string }> = {
  inbound_forecast_accuracy: { label: "Inbound forecast accuracy", unit: "percent", target: 100, higher: true, interpretation: "Actual inbound vs weekly forecast; zona sehat 90–110%." },
  inbound_productivity_attainment: { label: "Checker productivity", unit: "percent", target: 100, higher: true, interpretation: "Actual checker output per manday terhadap productivity target." },
  forecast_accuracy: { label: "Forecast accuracy", unit: "percent", target: 100, higher: true, interpretation: "Actual outbound vs weekly forecast; zona sehat 90–110%." },
  productivity_attainment: { label: "Picker productivity", unit: "percent", target: 100, higher: true, interpretation: "Produktivitas aktual terhadap target; dihitung dari actual goods." },
  putaway_productivity_attainment: { label: "Putaway productivity", unit: "percent", target: 100, higher: true, interpretation: "Actual putaway productivity terhadap target kolektif." },
  relabel_productivity_attainment: { label: "Relabel productivity", unit: "percent", target: 100, higher: true, interpretation: "Actual relabel productivity terhadap target; bukan forecast attainment karena forecast pcs relabel tidak tersedia." },
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
  putaway_completion: { label: "Putaway completion", unit: "percent", target: 98, higher: true, interpretation: "Putaway done terhadap actual workload yang diterima." },
  planogram_accuracy: { label: "Planogram accuracy", unit: "percent", target: 98, higher: true, interpretation: "Kesesuaian penempatan SKU terhadap planogram." },
  found_rate: { label: "Found rate", unit: "percent", target: 90, higher: true, interpretation: "Share item yang ditemukan dari proses recovery inventory." },
  mp_fulfill_accuracy: { label: "MP fulfill accuracy", unit: "percent", target: 95, higher: true, interpretation: "Ketersediaan manpower terhadap kebutuhan yang direncanakan." },
  truck_delivered_rate: { label: "Truck delivered", unit: "percent", target: 98, higher: true, interpretation: "Truck delivered terhadap dedicated truck." },
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
    case "relabel_productivity_attainment": return clamp(value);
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
    case "putaway_completion":
    case "planogram_accuracy":
    case "found_rate":
    case "mp_fulfill_accuracy":
    case "truck_delivered_rate":
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

function painAnalysis(points: MetricPoint[], highlights: HighlightRecord[], warehouse: string, asOf: string): PainPoint[] {
  const definitions = [
    { id: "forecast", title: "Demand variance melemahkan manpower plan", domain: "Planning", key: "forecast_accuracy", predicate: (v: number) => v < 85 || v > 115, hypothesis: "Forecast yang tidak akurat membuat MPP fixed tidak sejalan dengan actual workload.", tokens: ["forecast", "volume"] },
    { id: "people", title: "People plan tidak konsisten dengan kebutuhan operasi", domain: "Personalia", key: "schedule_accuracy", predicate: (v: number) => v < 90, hypothesis: "Mismatch schedule, attendance, atau churn mengubah SLA buffer dan output per manday.", tokens: ["resign", "attendance", "manpower", "mp "] },
    { id: "productivity", title: "Produktivitas picker berulang di bawah target", domain: "Outbound", key: "productivity_attainment", predicate: (v: number) => v < 92, hypothesis: "Gap dapat berasal dari volume dilution, pickface availability, allocation MP, atau process loss.", tokens: ["productivity", "produktivitas"] },
    { id: "cancel", title: "Cancel request belum memberi manfaat operasi", domain: "Outbound", key: "cancel_rate", predicate: (v: number) => v > 3, hypothesis: "Cancel dapat mengurangi denominator tanpa menghilangkan fixed mandays sehingga productivity tetap tidak membaik.", tokens: ["cancel"] },
    { id: "capacity", title: "Capacity pressure berulang", domain: "Capacity", key: "capacity_utilization", predicate: (v: number) => v > 90, hypothesis: "Zona jenuh meningkatkan queue, travel, dan risiko SLA meskipun manpower ditambah.", tokens: ["capacity", "occupancy", "full", "space"] },
    { id: "replenishment", title: "Replenishment belum menjaga kesiapan pickface", domain: "Inventory", key: "replenishment_completion", predicate: (v: number) => v < 92, hypothesis: "Task replenish yang tertinggal mengalihkan picking dari pickface dan menambah travel/recovery.", tokens: ["replenish", "pickface", "pick to pf"] },
    { id: "troubleshoot", title: "Recovery troubleshoot belum stabil", domain: "Inventory", key: "troubleshoot_fr", predicate: (v: number) => v < 85, hypothesis: "Task recovery tertinggal terhadap creation; cek MP, aging task, dan kualitas SLOC.", tokens: ["troubleshoot", "found"] },
    { id: "dcc", title: "Inventory accuracy belum terkendali", domain: "Inventory", key: "dcc_accuracy", predicate: (v: number) => v < 95, hypothesis: "Kualitas SLOC memicu lost, troubleshoot, replenishment rework, dan productivity loss.", tokens: ["sloc", "dcc", "accuracy", "ldp", "lbh"] },
    { id: "fleet", title: "Fleet punctuality menekan service completion", domain: "Fleet", key: "on_time_dispatch", predicate: (v: number) => v < 95, hypothesis: "Dispatch atau arrival yang terlambat dapat mengaburkan kualitas fulfillment warehouse.", tokens: ["dispatch", "arrival", "truck", "fleet"] },
  ];
  const warehouseHighlights = highlights.filter((item) => normalizeLabel(item.warehouse).includes(normalizeLabel(warehouse)));
  return definitions.map((definition) => {
    const breach = weeklyBreachCount(points, definition.key, asOf, definition.predicate);
    const matchedHighlights = warehouseHighlights.filter((item) => definition.tokens.some((token) => normalizeLabel(`${item.metric} ${item.issue}`).includes(normalizeLabel(token))));
    const currentValue = normalizePercent(definition.key, derived(points, definition.key, { start: shiftIso(asOf, -6), end: asOf, days: 7 }).value);
    const metricRisk = currentValue === null ? 25 : 100 - scoreMetric(definition.key, currentValue);
    const impactScore = Math.round(clamp(breach.weeks * 10 + metricRisk * 0.45 + Math.min(15, matchedHighlights.length * 7)));
    return { definition, breach, matchedHighlights, impactScore };
  })
    .filter(({ breach, matchedHighlights }) => breach.weeks >= 2 || (breach.weeks >= 1 && matchedHighlights.length > 0))
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 6)
    .map(({ definition, breach, matchedHighlights, impactScore }) => ({
      id: `${warehouse}-${definition.id}`,
      warehouse,
      title: definition.title,
      domain: definition.domain,
      recurrenceWeeks: breach.weeks,
      severity: impactScore >= 65 ? "high" : "medium",
      confidence: breach.weeks >= 4 || (breach.weeks >= 2 && matchedHighlights.length > 0) ? "high" : breach.weeks >= 2 ? "medium" : "low",
      evidence: [...breach.samples, ...matchedHighlights.slice(0, 2).map((item) => `Ops note ${item.date ?? "historical"}: ${item.issue}`)],
      hypothesis: definition.hypothesis,
      source: breach.weeks > 0 && matchedHighlights.length > 0 ? "hybrid" : matchedHighlights.length > 0 ? "highlight" : "kpi",
      impactScore,
    }));
}

function buildInitiatives(warehouse: string, pains: PainPoint[], relationships: RelationshipSignal[]): Initiative[] {
  type Template = Omit<Initiative, "id" | "warehouse" | "confidence" | "priorityScore" | "linkedPainIds" | "evidence">;
  const templates: Record<string, Template> = {
    forecast: { title: "Demand-to-Labor Control Loop", type: "optimize", owner: "Planning + Personalia", effort: "medium", horizonDays: 30, problem: "MPP dibangun dari forecast tetapi actual workload bergerak berbeda.", intervention: "Buat daily reforecast H-1/H-0, flex band ±10%, dan cross-role redeployment berbasis remaining workload.", expectedImpact: "Menekan productivity dilution tanpa mengorbankan inbound SLA atau fulfillment.", measurement: ["Forecast accuracy", "Mandays variance", "Productivity attainment", "SLA checker"], first14Days: ["Baseline error per weekday dan cut-off", "Definisikan flex pool serta trigger 10%", "Pilot satu shift dan review daily"] },
    people: { title: "Labor Guardrail & Flex Pool", type: "optimize", owner: "Personalia + Ops", effort: "medium", horizonDays: 30, problem: "Schedule, attendance, dan actual workload tidak selalu bergerak pada ritme yang sama.", intervention: "Tetapkan staffing band per workload, flex pool lintas role, dan trigger redeployment berbasis remaining hours serta SLA risk.", expectedImpact: "Meningkatkan SLA buffer dengan mandays yang lebih efisien dan mengurangi overstaff dilution.", measurement: ["Schedule accuracy", "Attendance", "Mandays variance", "Productivity", "SLA"], first14Days: ["Hitung staffing band per weekday", "Definisikan role yang dapat cross-deploy", "Uji trigger H+3 pada satu shift"] },
    productivity: { title: "Actual-Volume Productivity Cell", type: "stabilize", owner: "Outbound", effort: "medium", horizonDays: 21, problem: "Produktivitas berada di bawah target berulang dan mudah bias oleh forecast atau mandays.", intervention: "Kelola hourly remaining workload, actual mandays, pickface availability, dan loss reason dalam satu control cell.", expectedImpact: "Menaikkan actual pcs/manday dengan bukti driver, bukan sekadar mengejar target agregat.", measurement: ["Actual volume per manday", "Pick to PF", "Pick to Lost", "FR"], first14Days: ["Pareto 3 loss reason per shift", "Tetapkan hourly recovery owner", "Bandingkan regular vs OJT productivity"] },
    cancel: { title: "Cancel Challenge Gate", type: "validate", owner: "Outbound + Planning", effort: "low", horizonDays: 14, problem: "Request dibatalkan saat kemampuan warehouse belum dibuktikan secara kuantitatif.", intervention: "Wajibkan capacity proof sebelum cancel: remaining volume, remaining hours, attendance, run-rate, dan risk-to-SLA.", expectedImpact: "Mengurangi avoidable cancel dan menjaga denominator productivity serta service level.", measurement: ["Cancel rate", "FR before/after cancel", "Productivity", "Capacity headroom"], first14Days: ["Tag reason setiap cancel", "Backtest 4 minggu", "Aktifkan approval gate untuk cancel >2%"] },
    capacity: { title: "Zone Capacity Guardrail", type: "stabilize", owner: "Inventory + Inbound", effort: "medium", horizonDays: 30, problem: "Salah satu area frozen/chiller/ambient mendekati atau melewati operating envelope.", intervention: "Gunakan zonal heatmap, H+3 projection, dan trigger overflow/milkrun sebelum occupancy masuk zona jenuh.", expectedImpact: "Mengurangi congestion, putaway delay, dan risiko SLA lintas fungsi.", measurement: ["Actual vs max per zone", "Putaway lead time", "Inbound utilization", "Lost/rework"], first14Days: ["Validasi max capacity tiap zone", "Set warning 85% dan critical 92%", "Simulasikan overflow playbook"] },
    replenishment: { title: "Pickface Readiness Loop", type: "stabilize", owner: "Inventory + Outbound", effort: "medium", horizonDays: 21, problem: "Replenishment completion belum konsisten menjaga pickface availability.", intervention: "Prioritaskan replenish dengan next-wave demand, SLOC confidence, dan aging; pasang cut-off sebelum wave picking.", expectedImpact: "Menaikkan Pick to PF dan productivity sekaligus menurunkan travel serta task lost.", measurement: ["Replenishment completion", "Pick to PF", "Picker productivity", "Pick to Lost"], first14Days: ["Petakan top SKU pemicu non-PF", "Tetapkan replenish cut-off", "Pilot next-wave queue pada satu zone"] },
    troubleshoot: { title: "Troubleshoot Recovery Engine", type: "optimize", owner: "Inventory", effort: "medium", horizonDays: 21, problem: "Task troubleshoot berulang tidak pulih dengan laju yang cukup.", intervention: "Prioritaskan task berdasarkan value-at-risk, aging, SLOC confidence, dan peluang found; sesuaikan MP per queue.", expectedImpact: "Meningkatkan FR troubleshoot dan menurunkan lost serta dampaknya ke SO fulfillment.", measurement: ["Troubleshoot FR", "Queue aging", "Found %", "Contribution to SO FR"], first14Days: ["Buat aging bucket", "Pisahkan fast-win vs deep search", "Uji allocation MP berdasar arrival rate"] },
    dcc: { title: "SLOC Reliability Sprint", type: "stabilize", owner: "Inventory", effort: "medium", horizonDays: 30, problem: "Akurasi inventory yang rendah menimbulkan loss berantai ke replenishment, troubleshoot, dan picking.", intervention: "Targetkan SLOC berulang bermasalah dengan DCC risk-based, root-cause tag, dan close-loop correction.", expectedImpact: "Meningkatkan SLOC × Qty accuracy serta mengurangi task lost dan rework.", measurement: ["SLOC × Qty accuracy", "LDP/LBH", "Pick to Lost", "Replenishment completion"], first14Days: ["Pareto SLOC repeat offender", "Audit 20 SLOC tertinggi", "Lock owner dan due date correction"] },
    fleet: { title: "Dispatch-to-Arrival Control", type: "stabilize", owner: "Fleet", effort: "low", horizonDays: 14, problem: "Punctuality fleet dapat menahan service completion setelah warehouse selesai menyiapkan order.", intervention: "Pisahkan delay warehouse vs fleet, pasang departure cut-off, dan pantau route repeat offender.", expectedImpact: "Menaikkan on-time dispatch/arrival tanpa menyalahkan fulfillment warehouse.", measurement: ["On-time dispatch", "On-time arrival", "Truck delivered", "Hub received"], first14Days: ["Tag ownership setiap delay", "Pareto route berulang", "Daily recovery untuk departure miss"] },
  };
  const selected = pains.slice(0, 4).flatMap((pain) => {
    const key = pain.id.split("-").at(-1) ?? "productivity";
    const template = templates[key];
    if (!template) return [];
    const supportingRelationship = relationships.find((item) => (item.driverDomain === pain.domain || item.outcomeDomain === pain.domain) && item.strength !== "insufficient");
    const relationshipBonus = supportingRelationship?.strength === "strong" ? 8 : supportingRelationship?.strength === "moderate" ? 4 : 0;
    return [{
      ...template,
      id: `${warehouse}-${key}-initiative`,
      warehouse,
      confidence: pain.confidence,
      priorityScore: Math.round(clamp(pain.impactScore + relationshipBonus)),
      linkedPainIds: [pain.id],
      evidence: [...pain.evidence.slice(0, 3), ...(supportingRelationship ? [supportingRelationship.narrative] : [])],
    } satisfies Initiative];
  });
  const fallbacks = ["forecast", "productivity"].filter((key) => !selected.some((item) => item.id.includes(`-${key}-`))).map((key) => ({ ...templates[key], id: `${warehouse}-${key}-initiative`, warehouse, confidence: "medium" as const, priorityScore: 55, linkedPainIds: [], evidence: ["Baseline initiative digunakan karena recurrent pain evidence belum mencapai threshold."] } satisfies Initiative));
  return [...selected, ...fallbacks].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 4);
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
  { division: "Personalia", matches: ["personalia", "personal"], keys: ["attendance_all", "churn_all", "schedule_accuracy", "mp_fulfill_accuracy"] },
  { division: "Inbound", matches: ["inbound"], keys: ["inbound_forecast_accuracy", "inbound_productivity_attainment", "relabel_productivity_attainment", "sla_checker_inbound", "inbound_capacity_utilization"] },
  { division: "Inventory", matches: ["inventory"], keys: ["putaway_productivity_attainment", "putaway_completion", "inventory_capacity_utilization", "dcc_accuracy", "planogram_accuracy", "troubleshoot_fr", "found_rate", "replenishment_completion"] },
  { division: "Outbound", matches: ["outbound"], keys: ["forecast_accuracy", "productivity_attainment", "fulfillment_rate", "cancel_rate", "outbound_capacity_utilization", "pick_to_pf"] },
  { division: "Fleet", matches: ["fleet"], keys: ["on_time_dispatch", "on_time_arrival", "truck_delivered_rate"] },
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
    const eligibleDates = availableDates.filter((date) => !requestedAsOf || date <= requestedAsOf);
    const latest = latestOperationalDate(points, eligibleDates);
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

function dailyMetric(points: MetricPoint[], key: string, date: string, mode: AggregationMode = "sum"): number | null {
  return metricValue(points, key, { start: date, end: date, days: 1 }, mode).value;
}

function dailyDerived(points: MetricPoint[], key: string, date: string): number | null {
  const value = normalizePercent(key, derived(points, key, { start: date, end: date, days: 1 }).value);
  if (key === "forecast_error") {
    const accuracy = normalizePercent("forecast_accuracy", derived(points, "forecast_accuracy", { start: date, end: date, days: 1 }).value);
    return accuracy === null ? null : Math.abs(accuracy - 100);
  }
  if (key === "capacity_pressure") {
    const utilization = normalizePercent("capacity_utilization", derived(points, "capacity_utilization", { start: date, end: date, days: 1 }).value);
    return utilization === null ? null : Math.max(0, utilization - 85);
  }
  return value;
}

function volumeFlow(points: MetricPoint[], asOf: string): VolumeFlowPoint[] {
  return Array.from({ length: 28 }, (_, index) => shiftIso(asOf, index - 27)).map((date) => ({
    date,
    inboundForecast: dailyMetric(points, "forecast_weekly_inbound", date),
    inboundActual: dailyMetric(points, "actual_inbound", date),
    outboundForecast: dailyMetric(points, "forecast_weekly_outbound", date),
    beforeCancel: dailyMetric(points, "outbound_before_cancel", date),
    afterCancel: dailyMetric(points, "outbound_requested", date),
    rts: dailyMetric(points, "outbound_rts", date),
    hubReceived: dailyMetric(points, "outbound_actual_hub", date),
  }));
}

function fulfillmentFunnel(points: MetricPoint[], current: Window): FlowStage[] {
  const definitions = [
    { key: "forecast", label: "Forecast", source: "forecast_weekly_outbound" },
    { key: "before-cancel", label: "Requested before cancel", source: "outbound_before_cancel" },
    { key: "after-cancel", label: "Requested after cancel", source: "outbound_requested" },
    { key: "rts", label: "Ready to ship", source: "outbound_rts" },
    { key: "hub", label: "Hub received", source: "outbound_actual_hub" },
  ];
  const values = definitions.map((definition) => metricValue(points, definition.source, current, "sum").value);
  return definitions.map((definition, index) => {
    const value = values[index];
    const previousValue = index > 0 ? values[index - 1] : null;
    const conversionPct = value !== null && previousValue !== null && previousValue > 0 ? value / previousValue * 100 : null;
    const lossQty = value !== null && previousValue !== null ? Math.max(0, previousValue - value) : null;
    let status: FlowStage["status"] = "unavailable";
    if (value !== null) {
      if (index === 0) status = "controlled";
      else if (index === 1) status = conversionPct !== null && conversionPct >= 85 && conversionPct <= 115 ? "controlled" : "watch";
      else if (index === 2) status = conversionPct !== null && conversionPct >= 98 ? "controlled" : conversionPct !== null && conversionPct >= 95 ? "watch" : "critical";
      else status = conversionPct !== null && conversionPct >= 99 ? "controlled" : conversionPct !== null && conversionPct >= 97 ? "watch" : "critical";
    }
    return { key: definition.key, label: definition.label, value, conversionPct, lossQty, status };
  });
}

function laborBalance(points: MetricPoint[], asOf: string): LaborBalancePoint[] {
  return Array.from({ length: 28 }, (_, index) => shiftIso(asOf, index - 27)).map((date) => ({
    date,
    budgetMandays: dailyMetric(points, "budget_picker_mandays", date),
    actualMandays: dailyMetric(points, "actual_picker_mandays", date),
    productivity: dailyDerived(points, "productivity_attainment", date),
    fulfillment: dailyDerived(points, "fulfillment_rate", date),
    cancelRate: dailyDerived(points, "cancel_rate", date),
  }));
}

function zoneMetric(points: MetricPoint[], date: string, zone: string): number | null {
  const target = `utilization actual vs max % ${normalizeLabel(zone)}`;
  const matches = points.filter((point) => point.date === date && point.quality === "valid" && normalizeLabel(point.metric) === target && point.value !== null);
  if (!matches.length) return null;
  const value = matches.reduce((sum, point) => sum + (point.value as number), 0) / matches.length;
  return Math.abs(value) <= 2 ? value * 100 : value;
}

function capacityHistory(points: MetricPoint[], asOf: string): CapacityHistoryPoint[] {
  return Array.from({ length: 28 }, (_, index) => shiftIso(asOf, index - 27)).map((date) => ({
    date,
    ambient: zoneMetric(points, date, "Ambient"),
    chiller: zoneMetric(points, date, "Chiller"),
    frozen: zoneMetric(points, date, "Frozen"),
  }));
}

function pearson(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 8) return null;
  const meanX = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const meanY = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  const numerator = pairs.reduce((sum, pair) => sum + (pair[0] - meanX) * (pair[1] - meanY), 0);
  const denominatorX = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair[0] - meanX) ** 2, 0));
  const denominatorY = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair[1] - meanY) ** 2, 0));
  if (denominatorX === 0 || denominatorY === 0) return null;
  return numerator / (denominatorX * denominatorY);
}

function relationshipSignals(points: MetricPoint[], asOf: string): RelationshipSignal[] {
  const definitions = [
    { id: "forecast-productivity", driverKey: "forecast_error", driverLabel: "Forecast error", outcomeKey: "productivity_attainment", outcomeLabel: "Picker productivity", driverDomain: "Planning", outcomeDomain: "Outbound", lagDays: 0, expectedSign: -1, decision: "Gunakan flex labor saat forecast error bergerak bersama productivity dilution." },
    { id: "mandays-productivity", driverKey: "mandays_variance", driverLabel: "Mandays variance", outcomeKey: "productivity_attainment", outcomeLabel: "Picker productivity", driverDomain: "Personalia", outcomeDomain: "Outbound", lagDays: 0, expectedSign: -1, decision: "Pisahkan excess mandays dari process loss sebelum mengubah budget." },
    { id: "attendance-sla", driverKey: "attendance_all", driverLabel: "Attendance", outcomeKey: "sla_checker_inbound", outcomeLabel: "Inbound SLA", driverDomain: "Personalia", outcomeDomain: "Inbound", lagDays: 0, expectedSign: 1, decision: "Gunakan attendance sebagai early warning SLA, bukan alasan tunggal menambah MP." },
    { id: "schedule-productivity", driverKey: "schedule_accuracy", driverLabel: "Schedule accuracy", outcomeKey: "productivity_attainment", outcomeLabel: "Picker productivity", driverDomain: "Personalia", outcomeDomain: "Outbound", lagDays: 0, expectedSign: 1, decision: "Koreksi mismatch schedule pada hari dengan productivity loss yang berulang." },
    { id: "dcc-pickface", driverKey: "dcc_accuracy", driverLabel: "DCC accuracy", outcomeKey: "pick_to_pf", outcomeLabel: "Pick to PF", driverDomain: "Inventory", outcomeDomain: "Outbound", lagDays: 1, expectedSign: 1, decision: "Prioritaskan SLOC correction bila accuracy hari ini terkait pickface availability besok." },
    { id: "replenish-pickface", driverKey: "replenishment_completion", driverLabel: "Replenishment completion", outcomeKey: "pick_to_pf", outcomeLabel: "Pick to PF", driverDomain: "Inventory", outcomeDomain: "Outbound", lagDays: 1, expectedSign: 1, decision: "Sinkronkan replenishment cut-off dengan kebutuhan picking H+1." },
    { id: "troubleshoot-fr", driverKey: "troubleshoot_fr", driverLabel: "Troubleshoot FR", outcomeKey: "fulfillment_rate", outcomeLabel: "Warehouse FR", driverDomain: "Inventory", outcomeDomain: "Service", lagDays: 0, expectedSign: 1, decision: "Alokasikan recovery berdasarkan contribution-to-FR, aging, dan value-at-risk." },
    { id: "cancel-productivity", driverKey: "cancel_rate", driverLabel: "Cancel rate", outcomeKey: "productivity_attainment", outcomeLabel: "Picker productivity", driverDomain: "Planning", outcomeDomain: "Outbound", lagDays: 0, expectedSign: -1, decision: "Wajibkan capacity proof bila cancel naik tetapi productivity tidak ikut pulih." },
    { id: "capacity-productivity", driverKey: "capacity_pressure", driverLabel: "Capacity pressure >85%", outcomeKey: "productivity_attainment", outcomeLabel: "Picker productivity", driverDomain: "Capacity", outcomeDomain: "Outbound", lagDays: 0, expectedSign: -1, decision: "Aktifkan overflow playbook sebelum congestion menekan output per manday." },
  ];
  const dates = Array.from({ length: 84 }, (_, index) => shiftIso(asOf, index - 83));
  return definitions.map((definition) => {
    const pairs: Array<[number, number]> = [];
    for (const date of dates) {
      const driver = dailyDerived(points, definition.driverKey, date);
      const outcome = dailyDerived(points, definition.outcomeKey, shiftIso(date, definition.lagDays));
      if (driver !== null && outcome !== null && Number.isFinite(driver) && Number.isFinite(outcome)) pairs.push([driver, outcome]);
    }
    const coefficient = pearson(pairs);
    const absolute = Math.abs(coefficient ?? 0);
    const strength: RelationshipSignal["strength"] = coefficient === null ? "insufficient" : absolute >= 0.55 ? "strong" : absolute >= 0.3 ? "moderate" : "weak";
    const confidence: RelationshipSignal["confidence"] = pairs.length >= 35 ? "high" : pairs.length >= 18 ? "medium" : "low";
    const alignment: RelationshipSignal["alignment"] = coefficient === null || absolute < 0.2 ? "inconclusive" : Math.sign(coefficient) === definition.expectedSign ? "supports" : "contradicts";
    const coefficientText = coefficient === null ? "belum cukup data" : `r=${coefficient.toFixed(2)} dari ${pairs.length} hari`;
    const narrative = alignment === "supports"
      ? `${definition.driverLabel} bergerak sesuai arah hubungan operasional yang diharapkan terhadap ${definition.outcomeLabel} (${coefficientText}).`
      : alignment === "contradicts"
        ? `Pola ${definition.driverLabel} terhadap ${definition.outcomeLabel} tidak mengikuti hipotesis awal (${coefficientText}); cek segmentasi shift, weekday, dan volume.`
        : `Hubungan ${definition.driverLabel} dan ${definition.outcomeLabel} belum stabil (${coefficientText}); jangan gunakan sebagai bukti kausal.`;
    return { ...definition, coefficient, sampleSize: pairs.length, strength, confidence, alignment, narrative } satisfies RelationshipSignal;
  }).sort((a, b) => Math.abs(b.coefficient ?? 0) * Math.min(1, b.sampleSize / 28) - Math.abs(a.coefficient ?? 0) * Math.min(1, a.sampleSize / 28));
}

function riskMatrix(points: MetricPoint[], asOf: string): RiskMatrix {
  const definitions = [
    { domain: "Planning", keys: ["forecast_accuracy", "inbound_forecast_accuracy"] },
    { domain: "People", keys: ["attendance_all", "churn_all", "schedule_accuracy"] },
    { domain: "Inbound", keys: ["inbound_productivity_attainment", "sla_checker_inbound", "inbound_capacity_utilization"] },
    { domain: "Inventory", keys: ["putaway_productivity_attainment", "dcc_accuracy", "troubleshoot_fr", "replenishment_completion"] },
    { domain: "Outbound", keys: ["productivity_attainment", "fulfillment_rate", "cancel_rate", "pick_to_pf"] },
    { domain: "Capacity", keys: ["capacity_utilization"] },
    { domain: "Fleet", keys: ["on_time_dispatch", "on_time_arrival"] },
  ];
  const windowsByWeek = Array.from({ length: 8 }, (_, index) => {
    const end = shiftIso(asOf, -(7 - index) * 7);
    return { start: shiftIso(end, -6), end, days: 7 };
  });
  const weeks = windowsByWeek.map((window) => `${window.start.slice(5)}–${window.end.slice(5)}`);
  const rows = definitions.map((definition) => {
    const values = windowsByWeek.map((window) => {
      const scores = definition.keys.flatMap((key) => {
        const value = normalizePercent(key, derived(points, key, window).value);
        return value === null ? [] : [scoreMetric(key, value)];
      });
      return scores.length ? Math.round(100 - scores.reduce((sum, value) => sum + value, 0) / scores.length) : null;
    });
    return { domain: definition.domain, values, currentRisk: values.at(-1) ?? null };
  });
  return { weeks, rows };
}

function decisionInsights(
  kpis: MetricReading[],
  zones: CapacityZone[],
  pains: PainPoint[],
  relationships: RelationshipSignal[],
): DecisionInsight[] {
  const byKey = new Map(kpis.map((item) => [item.key, item]));
  const value = (key: string) => byKey.get(key)?.value ?? null;
  const confidenceFor = (...keys: string[]): DecisionInsight["confidence"] => {
    const available = keys.map((key) => byKey.get(key)).filter((item): item is MetricReading => Boolean(item?.value !== null));
    if (!available.length) return "low";
    const coverage = available.reduce((sum, item) => sum + item.coverage, 0) / available.length;
    return coverage >= 0.8 ? "high" : coverage >= 0.5 ? "medium" : "low";
  };
  const insights: DecisionInsight[] = [];
  const add = (insight: DecisionInsight) => insights.push(insight);
  const pct = (number: number | null) => number === null ? "n/a" : `${number.toFixed(1)}%`;
  const strongest = relationships.find((item) => item.strength !== "insufficient" && item.confidence !== "low");

  const mandays = value("mandays_variance");
  const productivity = value("productivity_attainment");
  const sla = value("sla_checker_inbound");
  if (mandays !== null && productivity !== null && sla !== null) {
    if (mandays < -3 && productivity >= 100 && sla >= 98) {
      add({
        id: "labor-budget-opportunity",
        priority: "high",
        domain: "Labor economics",
        title: "Budget mandays berpotensi lebih besar dari kebutuhan aktual",
        observation: `Actual mandays ${Math.abs(mandays).toFixed(1)}% di bawah budget, sementara productivity ${pct(productivity)} dan inbound SLA ${pct(sla)} tetap sehat.`,
        implication: "Efisiensi tidak sedang dibayar dengan penurunan output atau service; baseline budget layak diuji ulang per weekday dan volume band.",
        recommendedAction: "Backtest 8 minggu dan turunkan budget hanya pada volume band yang konsisten, dengan SLA 98% dan productivity 100% sebagai stop-loss.",
        evidence: [`Mandays variance ${pct(mandays)}`, `Productivity ${pct(productivity)}`, `Inbound SLA ${pct(sla)}`],
        confidence: confidenceFor("mandays_variance", "productivity_attainment", "sla_checker_inbound"),
      });
    } else if (mandays < -3 && (productivity < 92 || sla < 98)) {
      add({
        id: "labor-undercoverage-risk",
        priority: productivity < 85 || sla < 95 ? "critical" : "high",
        domain: "Labor economics",
        title: "Penghematan mandays belum terbukti aman",
        observation: `Actual mandays ${pct(mandays)} terhadap budget, tetapi productivity ${pct(productivity)} dan SLA ${pct(sla)} belum sama-sama memenuhi guardrail.`,
        implication: "Selisih mandays dapat menjadi under-coverage, bukan efisiensi; lead time dan output per manday sedang tarik-menarik.",
        recommendedAction: "Kembalikan MP secara selektif pada jam constraint, lalu ukur perubahan SLA dan actual pcs/manday sebelum mengubah budget permanen.",
        evidence: [`Mandays variance ${pct(mandays)}`, `Productivity ${pct(productivity)}`, `Inbound SLA ${pct(sla)}`],
        confidence: confidenceFor("mandays_variance", "productivity_attainment", "sla_checker_inbound"),
      });
    } else if (mandays >= 0 && productivity < 92) {
      add({
        id: "labor-process-loss",
        priority: productivity < 85 ? "critical" : "high",
        domain: "Labor economics",
        title: "Mandays tersedia, tetapi output per manday belum pulih",
        observation: `Mandays berada ${pct(mandays)} terhadap budget dan productivity hanya ${pct(productivity)}.`,
        implication: "Menambah orang lagi berisiko memperbesar dilution; constraint lebih mungkin berada pada actual volume, pickface, assignment, atau process loss.",
        recommendedAction: "Jalankan hourly loss tree: actual workload, productive hours, pick-to-PF, lost/rework, dan idle allocation sebelum menambah MP.",
        evidence: [`Mandays variance ${pct(mandays)}`, `Productivity ${pct(productivity)}`],
        confidence: confidenceFor("mandays_variance", "productivity_attainment"),
      });
    }
  }

  const forecast = value("forecast_accuracy");
  if (forecast !== null && (forecast < 90 || forecast > 110)) {
    add({
      id: "demand-plan-mismatch",
      priority: forecast < 80 || forecast > 120 ? "critical" : "high",
      domain: "Planning",
      title: "MPP tidak bekerja pada workload yang direncanakan",
      observation: `Actual outbound hanya ${pct(forecast)} terhadap forecast pada window aktif.`,
      implication: forecast < 90
        ? "Fixed mandays berisiko menciptakan productivity dilution karena actual volume lebih rendah."
        : "Actual volume melampaui plan dan dapat menekan SLA, capacity, serta fulfillment.",
      recommendedAction: "Aktifkan reforecast H-1/H-0 dan flex band 10%; keputusan redeployment harus mengikuti remaining workload, bukan forecast awal saja.",
      evidence: [`Forecast accuracy ${pct(forecast)}`, productivity === null ? "Productivity n/a" : `Productivity ${pct(productivity)}`, mandays === null ? "Mandays variance n/a" : `Mandays variance ${pct(mandays)}`],
      confidence: confidenceFor("forecast_accuracy", "productivity_attainment", "mandays_variance"),
    });
  }

  const cancel = value("cancel_rate");
  const fulfillment = value("fulfillment_rate");
  if (cancel !== null && cancel > 3 && productivity !== null && productivity < 100) {
    add({
      id: "cancel-not-recovering-productivity",
      priority: cancel > 7 && productivity < 90 ? "critical" : "high",
      domain: "Outbound",
      title: "Cancel belum mengembalikan produktivitas",
      observation: `Request cancelled ${pct(cancel)}, tetapi picker productivity masih ${pct(productivity)}${fulfillment === null ? "" : ` dan FR ${pct(fulfillment)}`}.`,
      implication: "Warehouse mungkin masih mampu menyerap sebagian request; cancel mengurangi service dan denominator tanpa menghilangkan fixed labor.",
      recommendedAction: "Wajibkan capacity proof sebelum cancel: remaining qty, remaining hours, attendance, run-rate, capacity headroom, dan projected FR.",
      evidence: [`Cancel rate ${pct(cancel)}`, `Productivity ${pct(productivity)}`, fulfillment === null ? "FR n/a" : `FR ${pct(fulfillment)}`],
      confidence: confidenceFor("cancel_rate", "productivity_attainment", "fulfillment_rate"),
    });
  }

  const dcc = value("dcc_accuracy");
  const troubleshoot = value("troubleshoot_fr");
  const pickface = value("pick_to_pf");
  const inventoryBreaches = [dcc !== null && dcc < 98, troubleshoot !== null && troubleshoot < 90, pickface !== null && pickface < 85].filter(Boolean).length;
  if (inventoryBreaches >= 2) {
    const relationship = relationships.find((item) => ["dcc-pickface", "replenish-pickface", "troubleshoot-fr"].includes(item.id) && item.strength !== "insufficient");
    add({
      id: "inventory-service-chain",
      priority: inventoryBreaches === 3 ? "critical" : "high",
      domain: "Inventory → Outbound",
      title: "Inventory control berpotensi menjadi upstream constraint",
      observation: `DCC ${pct(dcc)}, troubleshoot FR ${pct(troubleshoot)}, dan Pick-to-PF ${pct(pickface)} menunjukkan ${inventoryBreaches} breach yang saling berdekatan.`,
      implication: "SLOC reliability, recovery task, dan replenishment dapat membentuk loss chain ke travel picking, task lost, dan fulfillment.",
      recommendedAction: "Prioritaskan SLOC repeat offender dan next-wave replenishment; ukur efek H+1 pada Pick-to-PF, productivity, serta FR.",
      evidence: [`DCC ${pct(dcc)}`, `Troubleshoot FR ${pct(troubleshoot)}`, `Pick-to-PF ${pct(pickface)}`, ...(relationship ? [relationship.narrative] : [])],
      confidence: relationship?.confidence ?? confidenceFor("dcc_accuracy", "troubleshoot_fr", "pick_to_pf"),
    });
  }

  const constrainedZone = [...zones].filter((zone) => zone.utilization !== null).sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0];
  if (constrainedZone && constrainedZone.utilization !== null && constrainedZone.utilization >= 85) {
    add({
      id: "zonal-capacity-pressure",
      priority: constrainedZone.utilization >= 92 ? "critical" : "high",
      domain: "Capacity",
      title: `${constrainedZone.zone} memasuki operating envelope sempit`,
      observation: `Utilisasi ${constrainedZone.zone} ${pct(constrainedZone.utilization)} pada snapshot aktif.`,
      implication: "Congestion dapat menambah queue, travel, putaway lead time, dan menurunkan return dari tambahan manpower.",
      recommendedAction: "Aktifkan warning 85%, critical 92%, serta H+3 projection untuk overflow, transfer, atau sequence inbound.",
      evidence: [`${constrainedZone.zone} actual ${(constrainedZone.actual ?? 0).toLocaleString("id-ID")}`, `${constrainedZone.zone} max ${(constrainedZone.maximum ?? 0).toLocaleString("id-ID")}`],
      confidence: constrainedZone.actual !== null && constrainedZone.maximum !== null ? "high" : "medium",
    });
  }

  if (!insights.length) {
    const pain = pains[0];
    add({
      id: "control-and-validate",
      priority: "medium",
      domain: pain?.domain ?? "Cross-functional",
      title: "Tidak ada breach besar; fokus pada stabilitas dan validasi driver",
      observation: pain ? `${pain.title} adalah recurrent signal teratas dengan impact score ${pain.impactScore}.` : "KPI inti berada dalam guardrail atau evidence belum cukup untuk escalation.",
      implication: "Perubahan besar pada budget, cancel, atau manpower belum memiliki dasar yang cukup kuat.",
      recommendedAction: "Pertahankan daily control, validasi loss reason dan coverage data, lalu eskalasi hanya jika breach berulang minimal dua minggu.",
      evidence: pain?.evidence.slice(0, 3) ?? [strongest?.narrative ?? "Tidak ada association dengan confidence memadai."],
      confidence: pain?.confidence ?? "medium",
    });
  }

  const priorityRank: Record<DecisionInsight["priority"], number> = { critical: 3, high: 2, medium: 1 };
  return insights.sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority]).slice(0, 6);
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
  const pains = painAnalysis(warehousePoints, dataset.highlights, warehouse, asOf);
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
  const zones = capacityZones(warehousePoints, current);
  const relationships = relationshipSignals(warehousePoints, asOf);
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
    decisionInsights: decisionInsights(kpis, zones, pains, relationships),
    painPoints: pains,
    initiatives: buildInitiatives(warehouse, pains, relationships),
    filters: { warehouses: ["PGS", "SRG", "BIT", "STR"], divisions, rolesByDivision, availableDates: validDates.filter((date) => date <= asOf).slice(-180).reverse() },
    functionalModules: modules,
    capacityZones: zones,
    capacityHistory: capacityHistory(warehousePoints, asOf),
    volumeFlow: volumeFlow(warehousePoints, asOf),
    fulfillmentFunnel: fulfillmentFunnel(warehousePoints, current),
    laborBalance: laborBalance(warehousePoints, asOf),
    relationshipSignals: relationships,
    riskMatrix: riskMatrix(warehousePoints, asOf),
    pivotRows: pivotMetrics(warehousePoints, current, previous, division, role),
    warehouseComparison: warehouseComparison(dataset, period, asOf),
    metricCatalog: [...catalog.values()].sort((a, b) => a.division.localeCompare(b.division) || a.role.localeCompare(b.role) || a.metric.localeCompare(b.metric)),
  };
}

export const __test = { shiftIso, windows, normalizePercent, scoreMetric };
