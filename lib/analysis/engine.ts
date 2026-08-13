import { metricAliasKeys, normalizeLabel } from "@/lib/data/metric-aliases";
import { buildMetricSemantic, OPERATION_GLOSSARY, OPERATING_RULES } from "@/lib/analysis/operations-ontology";
import { PRIORITY_WAREHOUSES } from "@/lib/types";
import type {
  AnalysisPayload,
  AggregationMode,
  CapacityHistoryPoint,
  CapacityZone,
  CausalChain,
  DecisionInsight,
  DriverSignal,
  FunctionalModule,
  Initiative,
  IntelligenceSummary,
  MetricPoint,
  MetricReading,
  OperationsEconomics,
  OperationalMetricSemantic,
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

function windows(asOf: string, period: Period, rangeStart?: string): { current: Window; previous: Window } {
  const customDays = rangeStart ? Math.floor((new Date(`${asOf}T00:00:00Z`).valueOf() - new Date(`${rangeStart}T00:00:00Z`).valueOf()) / DAY) + 1 : null;
  const days = period === "custom" ? customDays ?? 1 : period === "daily" ? 1 : period === "weekly" ? 7 : 30;
  const currentStart = period === "custom" && rangeStart ? rangeStart : shiftIso(asOf, -(days - 1));
  return {
    current: { start: currentStart, end: asOf, days },
    previous: { start: shiftIso(currentStart, -days), end: shiftIso(currentStart, -1), days },
  };
}

function datesInWindow(window: Window): string[] {
  return Array.from({ length: window.days }, (_, index) => shiftIso(window.start, index));
}

function visualWindow(current: Window, period: Period): Window {
  return period === "custom" ? current : { start: shiftIso(current.end, -27), end: current.end, days: 28 };
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
      // Forecast quality is measured against demand before cancellation. Using
      // the post-cancel request made an operational decision (cancel) rewrite
      // the planning error and rewarded warehouses for removing demand.
      return ratio(metricValue(points, "outbound_before_cancel", window, "sum"), metricValue(points, "forecast_weekly_outbound", window, "sum"));
    case "demand_fill_rate":
      // Deliberately measured against demand BEFORE cancellation. fulfillment_rate
      // divides by the post-cancel request, so cancelling work raises it; this one
      // cannot be improved by removing demand.
      return ratio(metricValue(points, "outbound_rts", window, "sum"), metricValue(points, "outbound_before_cancel", window, "sum"));
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
  const directPercent = new Set(["inbound_forecast_accuracy", "inbound_productivity_attainment", "forecast_accuracy", "demand_fill_rate", "productivity_attainment", "putaway_productivity_attainment", "relabel_productivity_attainment", "inbound_capacity_utilization", "inventory_capacity_utilization", "outbound_capacity_utilization", "mandays_variance", "cancel_rate", "capacity_utilization", "dcc_accuracy"]);
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
  fulfillment_rate: { label: "Warehouse FR", unit: "percent", target: 99, higher: true, interpretation: "RTS terhadap request setelah cancel; kebal terhadap pembatalan, baca bersama Demand fill rate." },
  // Target 97 is derived from the guardrails the business already set, not invented:
  // FR target 99% x (100% - cancel target 2%) = 97.02%.
  demand_fill_rate: { label: "Demand fill rate", unit: "percent", target: 97, higher: true, interpretation: "RTS terhadap request sebelum cancel; inilah porsi permintaan yang benar-benar dilayani." },
  sla_checker_inbound: { label: "Inbound checker SLA", unit: "percent", target: 98, higher: true, interpretation: "Guardrail lead time saat mengatur manpower." },
  mandays_variance: { label: "Mandays vs budget", unit: "percent", target: 0, higher: false, interpretation: "Negatif berarti hemat; valid hanya jika SLA dan productivity tetap sehat." },
  capacity_utilization: { label: "Utilisasi puncak alur", unit: "percent", target: 85, higher: false, interpretation: "Utilisasi tertinggi di antara inbound, inventory, dan outbound. Ini bukan okupansi gudang—untuk itu baca panel zona." },
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

function dailyTrend(points: MetricPoint[], key: string, window: Window): TrendSeries {
  const rule = rules[key];
  const values = datesInWindow(window).map((date) => {
    const value = normalizePercent(key, derived(points, key, { start: date, end: date, days: 1 }).value);
    return { date, value };
  });
  return { key, label: rule.label, unit: rule.unit, values };
}

/**
 * Converts a shortfall into a 0–100 score without ever reaching the floor.
 *
 * The previous linear form `100 - gap * slope` hit exactly 0 once the gap passed
 * 100/slope, so a chronically underperforming metric froze at zero and stopped
 * carrying information — schedule accuracy scored 0 on 100% of STR's observations,
 * which is why the People risk row read as a flat line for eight straight weeks.
 *
 * This halves the score every `50 / slope` points of shortfall, so it matches the
 * old calibration where it mattered (still 50 at the same gap) and keeps ranking
 * warehouses that are all far below target.
 */
function decayScore(gap: number, slope: number): number {
  if (gap <= 0) return 100;
  return clamp(100 * Math.pow(0.5, (gap * slope) / 50));
}

function scoreMetric(key: string, value: number | null): number {
  if (value === null) return 50;
  switch (key) {
    case "forecast_accuracy":
    case "inbound_forecast_accuracy": return decayScore(Math.abs(value - 100), 2.5);
    case "productivity_attainment":
    case "inbound_productivity_attainment":
    case "putaway_productivity_attainment": return clamp(value);
    case "relabel_productivity_attainment": return clamp(value);
    case "fulfillment_rate": return decayScore(99 - value, 8);
    case "demand_fill_rate": return decayScore(97 - value, 4);
    case "sla_checker_inbound": return decayScore(98 - value, 5);
    case "mandays_variance": return decayScore(value, 4);
    case "capacity_utilization":
    case "inbound_capacity_utilization":
    case "inventory_capacity_utilization":
    case "outbound_capacity_utilization": return decayScore(value - 85, 6);
    case "cancel_rate": return decayScore(value - 2, 10);
    case "dcc_accuracy": return clamp(value);
    case "attendance_all": return decayScore(96 - value, 5);
    case "churn_all": return decayScore(value - 5, 8);
    case "schedule_accuracy":
    case "replenishment_completion":
    case "putaway_completion":
    case "planogram_accuracy":
    case "found_rate":
    case "mp_fulfill_accuracy":
    case "truck_delivered_rate":
    case "on_time_dispatch":
    case "on_time_arrival": return decayScore((rules[key]?.target ?? 95) - value, 5);
    default: return clamp(value);
  }
}

/** The KPI basket. Everything shown on a card is also scored — nothing is
 *  displayed as a headline number while sitting outside the health score. */
const KPI_KEYS = [
  "forecast_accuracy",
  "productivity_attainment",
  "fulfillment_rate",
  "demand_fill_rate",
  "sla_checker_inbound",
  "mandays_variance",
  "capacity_utilization",
  "cancel_rate",
  "troubleshoot_fr",
  "dcc_accuracy",
  "pick_to_pf",
] as const;

export interface HealthSummary {
  score: number;
  status: "critical" | "watch" | "controlled";
  criticalKpis: string[];
  pillarsAvailable: number;
  pillarsTotal: number;
}

/**
 * Single definition of warehouse health, used by both the cockpit gauge and the
 * benchmark table. These used to be two separate calculations over two different
 * KPI baskets, so the same warehouse could show 75 in one place and 62 in another.
 *
 * A breaching KPI blocks the "controlled" status outright. Averaging a basket lets
 * two critical breaches hide behind five healthy metrics, which is how a warehouse
 * cancelling 43% of its demand still read as merely "watch".
 */
function healthFrom(kpis: MetricReading[]): HealthSummary {
  const scored = kpis.filter((item) => item.value !== null);
  const criticalKpis = kpis.filter((item) => item.severity === "critical").map((item) => item.key);
  const score = scored.length
    ? Math.round(scored.reduce((sum, item) => sum + scoreMetric(item.key, item.value), 0) / scored.length)
    : 50;
  let status: HealthSummary["status"] = scored.length < 3 ? "watch" : score < 65 ? "critical" : score < 82 ? "watch" : "controlled";
  if (criticalKpis.length > 0 && status === "controlled") status = "watch";
  return { score, status, criticalKpis, pillarsAvailable: scored.length, pillarsTotal: kpis.length };
}

/**
 * Dates on which the warehouse did not run. A zero is a real number to the parser,
 * so closed days entered correlation series as genuine observations — STR's
 * headline r of -0.92 was -0.63 once its 18 zero-volume days were removed.
 */
function noOperationDates(points: MetricPoint[]): Set<string> {
  const volume = new Map<string, number>();
  for (const point of points) {
    if (point.quality !== "valid" || point.value === null) continue;
    const keys = metricAliasKeys(point.metric);
    if (!keys.includes("outbound_requested") && !keys.includes("outbound_before_cancel") && !keys.includes("outbound_rts")) continue;
    volume.set(point.date, Math.max(volume.get(point.date) ?? 0, point.value));
  }
  return new Set([...volume.entries()].filter(([, value]) => value === 0).map(([date]) => date));
}

/** Abramowitz & Stegun 7.1.26 — enough precision for a p-value badge. */
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** Two-sided p for a Pearson r, via the t statistic with a normal approximation. */
function correlationPValue(coefficient: number, sampleSize: number): number | null {
  const df = sampleSize - 2;
  if (df < 1 || Math.abs(coefficient) >= 1) return null;
  const t = (coefficient * Math.sqrt(df)) / Math.sqrt(1 - coefficient * coefficient);
  const z = (Math.abs(t) * (1 - 1 / (4 * df))) / Math.sqrt(1 + (t * t) / (2 * df));
  return Math.min(1, Math.max(0, 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2)))));
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
    // schedule_accuracy is intentionally excluded: its source definition is still
    // unconfirmed and may exceed 100%, so it must never trigger a recommendation.
    { id: "people", title: "Kehadiran belum konsisten menopang workload", domain: "Personalia", key: "attendance_all", predicate: (v: number) => v < 96, hypothesis: "Gap kehadiran mengurangi SLA buffer dan memaksa perubahan alokasi manpower saat operasi berjalan.", tokens: ["resign", "attendance", "manpower", "mp "] },
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

function buildInitiatives(
  warehouse: string,
  pains: PainPoint[],
  relationships: RelationshipSignal[],
  kpis: MetricReading[],
  zones: CapacityZone[],
  economics: OperationsEconomics,
  chains: CausalChain[],
): Initiative[] {
  type ControlFields = Pick<Initiative, "valueLens" | "successGate" | "stopLoss">;
  type AdaptiveFields = Pick<Initiative, "adaptiveVariant" | "whyNow" | "trigger" | "linkedChainIds">;
  type Template = Omit<Initiative, "id" | "warehouse" | "confidence" | "priorityScore" | "linkedPainIds" | "evidence" | "priorityBreakdown" | keyof ControlFields | keyof AdaptiveFields>;
  const controls: Record<string, ControlFields> = {
    forecast: { valueLens: "cost", successGate: "Forecast 90–110%, productivity ≥100%, cancel ≤2%.", stopLoss: "Hentikan pengurangan MP jika SLA <98% atau demand fill <97%." },
    people: { valueLens: "cost", successGate: "Attendance ≥96% dan SLA ≥98% pada volume band yang sama.", stopLoss: "Batalkan redeployment jika queue atau SLA memburuk dua cut-off berturut-turut." },
    productivity: { valueLens: "speed", successGate: "Productivity ≥100% tanpa penurunan demand fill atau SLA.", stopLoss: "Hentikan perubahan metode jika lost/rework atau cancel meningkat." },
    cancel: { valueLens: "service", successGate: "Cancel ≤2% dan demand fill ≥97%.", stopLoss: "Kembalikan gate jika projected capacity >92% atau SLA berisiko gagal." },
    capacity: { valueLens: "capacity", successGate: "Semua zona <85% dengan putaway SLA tetap sehat.", stopLoss: "Eskalasi overflow jika proyeksi zona menyentuh 92%." },
    replenishment: { valueLens: "speed", successGate: "Replenishment ≥95% dan Pick-to-PF ≥85%.", stopLoss: "Hentikan prioritas baru jika next-wave shortage tidak turun." },
    troubleshoot: { valueLens: "quality", successGate: "Troubleshoot FR ≥90% dan aging queue turun.", stopLoss: "Ubah allocation jika tambahan MP tidak menaikkan recovery rate." },
    dcc: { valueLens: "quality", successGate: "DCC ≥98% dan repeat offender turun dua minggu.", stopLoss: "Perluas audit jika koreksi SLOC tidak menurunkan lost/rework." },
    fleet: { valueLens: "service", successGate: "On-time dispatch dan arrival ≥98%.", stopLoss: "Pisahkan ownership bila delay berasal dari readiness warehouse." },
  };
  const templates: Record<string, Template> = {
    forecast: { title: "Demand-to-Labor Control Loop", type: "optimize", owner: "Planning + Personalia", effort: "medium", horizonDays: 30, problem: "MPP dibangun dari forecast tetapi actual workload bergerak berbeda.", intervention: "Buat daily reforecast H-1/H-0, flex band ±10%, dan cross-role redeployment berbasis remaining workload.", expectedImpact: "Menekan productivity dilution tanpa mengorbankan inbound SLA atau fulfillment.", measurement: ["Forecast accuracy", "Mandays variance", "Productivity attainment", "SLA checker"], first14Days: ["Baseline error per weekday dan cut-off", "Definisikan flex pool serta trigger 10%", "Pilot satu shift dan review daily"] },
    people: { title: "Labor Guardrail & Flex Pool", type: "optimize", owner: "Personalia + Ops", effort: "medium", horizonDays: 30, problem: "Attendance dan actual workload tidak selalu bergerak pada ritme yang sama.", intervention: "Tetapkan staffing band per workload, flex pool lintas role, dan trigger redeployment berbasis remaining hours serta risiko SLA.", expectedImpact: "Meningkatkan SLA buffer dengan mandays yang lebih efisien dan mengurangi overstaff dilution.", measurement: ["Attendance", "Mandays variance", "Productivity", "SLA"], first14Days: ["Hitung staffing band per weekday", "Definisikan role yang dapat cross-deploy", "Uji trigger H+3 pada satu shift"] },
    productivity: { title: "Actual-Volume Productivity Cell", type: "stabilize", owner: "Outbound", effort: "medium", horizonDays: 21, problem: "Produktivitas berada di bawah target berulang dan mudah bias oleh forecast atau mandays.", intervention: "Kelola hourly remaining workload, actual mandays, pickface availability, dan loss reason dalam satu control cell.", expectedImpact: "Menaikkan actual pcs/manday dengan bukti driver, bukan sekadar mengejar target agregat.", measurement: ["Actual volume per manday", "Pick to PF", "Pick to Lost", "FR"], first14Days: ["Pareto 3 loss reason per shift", "Tetapkan hourly recovery owner", "Bandingkan regular vs OJT productivity"] },
    cancel: { title: "Cancel Challenge Gate", type: "validate", owner: "Outbound + Planning", effort: "low", horizonDays: 14, problem: "Request dibatalkan saat kemampuan warehouse belum dibuktikan secara kuantitatif.", intervention: "Wajibkan capacity proof sebelum cancel: remaining volume, remaining hours, attendance, run-rate, dan risk-to-SLA.", expectedImpact: "Mengurangi avoidable cancel dan menjaga denominator productivity serta service level.", measurement: ["Cancel rate", "FR before/after cancel", "Productivity", "Capacity headroom"], first14Days: ["Tag reason setiap cancel", "Backtest 4 minggu", "Aktifkan approval gate untuk cancel >2%"] },
    capacity: { title: "Zone Capacity Guardrail", type: "stabilize", owner: "Inventory + Inbound", effort: "medium", horizonDays: 30, problem: "Salah satu area frozen/chiller/ambient mendekati atau melewati operating envelope.", intervention: "Gunakan zonal heatmap, H+3 projection, dan trigger overflow/milkrun sebelum occupancy masuk zona jenuh.", expectedImpact: "Mengurangi congestion, putaway delay, dan risiko SLA lintas fungsi.", measurement: ["Actual vs max per zone", "Putaway lead time", "Inbound utilization", "Lost/rework"], first14Days: ["Validasi max capacity tiap zone", "Set warning 85% dan critical 92%", "Simulasikan overflow playbook"] },
    replenishment: { title: "Pickface Readiness Loop", type: "stabilize", owner: "Inventory + Outbound", effort: "medium", horizonDays: 21, problem: "Replenishment completion belum konsisten menjaga pickface availability.", intervention: "Prioritaskan replenish dengan next-wave demand, SLOC confidence, dan aging; pasang cut-off sebelum wave picking.", expectedImpact: "Menaikkan Pick to PF dan productivity sekaligus menurunkan travel serta task lost.", measurement: ["Replenishment completion", "Pick to PF", "Picker productivity", "Pick to Lost"], first14Days: ["Petakan top SKU pemicu non-PF", "Tetapkan replenish cut-off", "Pilot next-wave queue pada satu zone"] },
    troubleshoot: { title: "Troubleshoot Recovery Engine", type: "optimize", owner: "Inventory", effort: "medium", horizonDays: 21, problem: "Task troubleshoot berulang tidak pulih dengan laju yang cukup.", intervention: "Prioritaskan task berdasarkan value-at-risk, aging, SLOC confidence, dan peluang found; sesuaikan MP per queue.", expectedImpact: "Meningkatkan FR troubleshoot dan menurunkan lost serta dampaknya ke SO fulfillment.", measurement: ["Troubleshoot FR", "Queue aging", "Found %", "Contribution to SO FR"], first14Days: ["Buat aging bucket", "Pisahkan fast-win vs deep search", "Uji allocation MP berdasar arrival rate"] },
    dcc: { title: "SLOC Reliability Sprint", type: "stabilize", owner: "Inventory", effort: "medium", horizonDays: 30, problem: "Akurasi inventory yang rendah menimbulkan loss berantai ke replenishment, troubleshoot, dan picking.", intervention: "Targetkan SLOC berulang bermasalah dengan DCC risk-based, root-cause tag, dan close-loop correction.", expectedImpact: "Meningkatkan SLOC × Qty accuracy serta mengurangi task lost dan rework.", measurement: ["SLOC × Qty accuracy", "LDP/LBH", "Pick to Lost", "Replenishment completion"], first14Days: ["Pareto SLOC repeat offender", "Audit 20 SLOC tertinggi", "Lock owner dan due date correction"] },
    fleet: { title: "Dispatch-to-Arrival Control", type: "stabilize", owner: "Fleet", effort: "low", horizonDays: 14, problem: "Punctuality fleet dapat menahan service completion setelah warehouse selesai menyiapkan order.", intervention: "Pisahkan delay warehouse vs fleet, pasang departure cut-off, dan pantau route repeat offender.", expectedImpact: "Menaikkan on-time dispatch/arrival tanpa menyalahkan fulfillment warehouse.", measurement: ["On-time dispatch", "On-time arrival", "Truck delivered", "Hub received"], first14Days: ["Tag ownership setiap delay", "Pareto route berulang", "Daily recovery untuk departure miss"] },
  };
  const kpiValue = (key: string) => kpis.find((item) => item.key === key)?.value ?? null;
  const formatPct = (value: number | null) => value === null ? "n/a" : `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
  const highestZone = [...zones].filter((zone) => zone.utilization !== null).sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0];
  const chainByKey: Record<string, string[]> = {
    forecast: ["forecast-labor-productivity"],
    people: ["forecast-labor-productivity", "checker-labor-sla"],
    productivity: ["forecast-labor-productivity", "inventory-sloc-service"],
    cancel: ["cancel-demand-service"],
    capacity: ["zone-capacity-flow"],
    replenishment: ["inventory-sloc-service"],
    troubleshoot: ["inventory-sloc-service"],
    dcc: ["inventory-sloc-service"],
    fleet: ["warehouse-fleet-hub"],
  };
  const adaptive = (key: string, pain: PainPoint | null): AdaptiveFields & Partial<Template> => {
    const cancel = kpiValue("cancel_rate");
    const demandFill = kpiValue("demand_fill_rate");
    const productivity = kpiValue("productivity_attainment");
    const forecast = kpiValue("forecast_accuracy");
    const sla = kpiValue("sla_checker_inbound");
    const mandays = kpiValue("mandays_variance");
    const dcc = kpiValue("dcc_accuracy");
    const troubleshoot = kpiValue("troubleshoot_fr");
    const pickface = kpiValue("pick_to_pf");
    const linkedChainIds = (chainByKey[key] ?? []).filter((id) => chains.some((chain) => chain.id === id));
    const defaultFields: AdaptiveFields = {
      adaptiveVariant: `${key}-baseline-validation`,
      whyNow: pain ? `${pain.recurrenceWeeks} dari 8 minggu menembus guardrail dengan impact score ${pain.impactScore}.` : "Evidence berulang belum melewati ambang; playbook dipakai untuk validasi baseline.",
      trigger: pain ? `Aktif ketika breach ${key} muncul kembali pada cut berikut.` : "Aktif hanya setelah dua cut berturut-turut menunjukkan gap yang sama.",
      linkedChainIds,
    };
    if (key === "cancel") {
      if ((cancel ?? 0) >= 20) return {
        ...defaultFields,
        adaptiveVariant: "cancel-demand-protection-war-room",
        title: "Demand Protection War Room",
        whyNow: `Cancel ${formatPct(cancel)} dan demand fill ${formatPct(demandFill)} menunjukkan demand loss material, bukan sekadar penyesuaian beban.`,
        trigger: "Aktif segera saat cancel harian >10% atau projected demand fill <90%.",
        intervention: "Bekukan cancel otomatis, wajibkan reason-code dan capacity proof per jam, lalu gunakan approval head untuk setiap cancel tambahan sampai demand fill pulih.",
        expectedImpact: "Memulihkan demand yang seharusnya dapat dilayani dan membedakan constraint nyata dari keputusan cancel yang avoidable.",
      };
      if ((cancel ?? 0) > 5 && (economics.capacityHeadroomPct ?? 0) >= 8) return {
        ...defaultFields,
        adaptiveVariant: "cancel-headroom-challenge",
        title: "Capacity-Proof Cancel Challenge",
        whyNow: `Cancel ${formatPct(cancel)} terjadi saat headroom zona masih ${formatPct(economics.capacityHeadroomPct)}; kemampuan proses perlu dibuktikan sebelum demand dihapus.`,
        trigger: "Wajib review ketika cancel >2% dan headroom zona ≥8%.",
      };
      return { ...defaultFields, adaptiveVariant: "cancel-exception-gate", title: "Cancel Exception Gate", whyNow: `Cancel ${formatPct(cancel)} perlu dijaga agar fulfillment post-cancel tidak menutupi demand fill ${formatPct(demandFill)}.` };
    }
    if (key === "forecast") {
      if (forecast !== null && forecast < 85) return {
        ...defaultFields,
        adaptiveVariant: "forecast-volume-dilution",
        title: "Volume-Dilution Labor Rebaseline",
        whyNow: `Demand hanya ${formatPct(forecast)} dari forecast sementara mandays gap ${formatPct(mandays)} dan productivity ${formatPct(productivity)}.`,
        trigger: "Aktif ketika demand/forecast <90% dua cut atau productivity turun pada actual MD tetap.",
        intervention: "Rebaseline staffing per volume band dan weekday, lalu redeploy flex pool dari remaining workload—bukan forecast awal.",
      };
      if (forecast !== null && forecast > 115) return {
        ...defaultFields,
        adaptiveVariant: "forecast-surge-flex",
        title: "Surge Flex Capacity Cell",
        whyNow: `Demand mencapai ${formatPct(forecast)} dari forecast; lindungi SLA dan demand fill tanpa menormalkan overtime permanen.`,
        trigger: "Aktif ketika demand/forecast >110% dan remaining workload melewati kapasitas jam tersisa.",
        intervention: "Aktifkan flex pool dan resequence workload pada constrained process; tutup surge setelah run-rate kembali ke operating band.",
      };
      return { ...defaultFields, adaptiveVariant: "forecast-weekday-bias", title: "Weekday Forecast Bias Control", whyNow: `Forecast accuracy ${formatPct(forecast)} berulang, tetapi arah bias perlu dipisahkan per weekday dan cut-off.` };
    }
    if (key === "productivity") {
      if ((dcc !== null && dcc < 95) || (troubleshoot !== null && troubleshoot < 85) || (pickface !== null && pickface < 80)) return {
        ...defaultFields,
        adaptiveVariant: "productivity-pickface-constraint",
        title: "Pickface Constraint Removal Cell",
        whyNow: `Productivity ${formatPct(productivity)} bergerak bersama sinyal inventory: DCC ${formatPct(dcc)}, troubleshoot FR ${formatPct(troubleshoot)}, Pick-to-PF ${formatPct(pickface)}.`,
        trigger: "Aktif ketika productivity <92% dan sedikitnya satu guardrail inventory ikut gagal.",
        intervention: "Kelola loss tree per jam dari SLOC/replenish/troubleshoot ke picking; tahan penambahan MP sampai constraint non-labor terukur.",
      };
      if ((mandays ?? 0) < -3 && (sla ?? 100) < 98) return {
        ...defaultFields,
        adaptiveVariant: "productivity-undercoverage-recovery",
        title: "Undercoverage Recovery Cell",
        whyNow: `Actual MD ${formatPct(mandays)} terhadap budget, productivity ${formatPct(productivity)}, dan SLA ${formatPct(sla)} menunjukkan saving belum aman.`,
        trigger: "Aktif ketika actual MD <budget sementara productivity atau SLA menembus guardrail.",
      };
      return { ...defaultFields, adaptiveVariant: "productivity-method-skill-mix", title: "Method & Skill-Mix Productivity Cell", whyNow: `Productivity ${formatPct(productivity)} perlu dibedah per method, OJT/regular, zone, dan loss reason—bukan ditutup dengan tambahan MP.` };
    }
    if (key === "people") {
      return (sla ?? 100) < 98
        ? { ...defaultFields, adaptiveVariant: "people-attendance-sla", title: "Attendance-to-SLA Flex Pool", whyNow: `Gap people berulang bersamaan dengan SLA ${formatPct(sla)}; redeployment harus diarahkan ke jam constraint.` }
        : { ...defaultFields, adaptiveVariant: "people-shift-mix", title: "Shift Mix & Flex Pool Rebalance", whyNow: `People signal berulang tetapi SLA ${formatPct(sla)} masih terlindungi; fokus pada skill mix dan dilution.` };
    }
    if (key === "capacity") return {
      ...defaultFields,
      adaptiveVariant: `capacity-${highestZone?.zone.toLowerCase() ?? "zone"}-release`,
      title: `${highestZone?.zone ?? "Zonal"} Constraint Release`,
      whyNow: `${highestZone?.zone ?? "Zona teratas"} berada di ${formatPct(highestZone?.utilization ?? null)} dan menjadi operating envelope tersempit.`,
      trigger: `Aktif pada warning 85%; overflow wajib sebelum ${highestZone?.zone ?? "zona"} menyentuh 92%.`,
    };
    if (key === "replenishment") return {
      ...defaultFields,
      adaptiveVariant: pickface === null ? "replenishment-evidence-recovery" : "replenishment-next-wave",
      title: pickface === null ? "Replenishment Evidence Recovery" : "Next-Wave Pickface Readiness",
      whyNow: pickface === null ? "Replenishment breach tersedia tetapi Pick-to-PF tidak dilacak; hubungan ke picking belum boleh diasumsikan." : `Replenishment perlu dikaitkan langsung ke Pick-to-PF ${formatPct(pickface)} dan next-wave demand.`,
      trigger: "Aktif ketika completion <92% atau shortage next-wave naik dua cut.",
    };
    if (key === "troubleshoot") return {
      ...defaultFields,
      adaptiveVariant: (dcc ?? 100) < 95 ? "troubleshoot-sloc-recovery" : "troubleshoot-aging-queue",
      title: (dcc ?? 100) < 95 ? "SLOC-to-FR Recovery Engine" : "Troubleshoot Aging Queue Control",
      whyNow: `Troubleshoot FR ${formatPct(troubleshoot)}${dcc === null ? "" : ` dan DCC ${formatPct(dcc)}`}; mandays role belum tersedia sehingga staffing tetap hipotesis.`,
      trigger: "Aktif ketika FR <85%; perubahan MP baru boleh diuji setelah arrival rate dan aging tersedia.",
    };
    if (key === "dcc") return {
      ...defaultFields,
      adaptiveVariant: (troubleshoot ?? 100) < 85 ? "dcc-sloc-fr-loop" : "dcc-repeat-offender",
      title: (troubleshoot ?? 100) < 85 ? "SLOC-to-FR Closed Loop" : "Risk-Based DCC Repeat-Offender Sprint",
      whyNow: `DCC ${formatPct(dcc)}${troubleshoot === null ? "" : ` dan troubleshoot FR ${formatPct(troubleshoot)}`} menentukan prioritas SLOC yang paling merusak service.`,
    };
    if (key === "fleet") return { ...defaultFields, adaptiveVariant: "fleet-owner-split", title: "Dispatch-to-Hub Ownership Split", whyNow: `Demand downstream harus dipisahkan dari completion warehouse; demand tidak terlayani saat ini ${economics.unservedDemandQty?.toLocaleString("id-ID") ?? "n/a"} unit.` };
    return defaultFields;
  };
  const selected = pains.slice(0, 4).flatMap((pain) => {
    const key = pain.id.split("-").at(-1) ?? "productivity";
    const template = templates[key];
    if (!template) return [];
    const adaptation = adaptive(key, pain);
    const supportingRelationship = relationships.find((item) =>
      (item.driverDomain === pain.domain || item.outcomeDomain === pain.domain)
      && item.survivesMultiplicity
      && !item.sharedTerm
      && item.alignment !== "inconclusive");
    const relationshipBonus = supportingRelationship?.strength === "strong" ? 8 : supportingRelationship?.strength === "moderate" ? 4 : 0;
    const priorityBreakdown = {
      impact: pain.impactScore,
      recurrence: Math.round(clamp(pain.recurrenceWeeks * 12.5)),
      evidence: Math.round(clamp(pain.evidence.length * 20 + relationshipBonus * 2.5)),
      feasibility: template.effort === "low" ? 90 : template.effort === "medium" ? 70 : 50,
    };
    const priorityScore = Math.round(priorityBreakdown.impact * 0.45 + priorityBreakdown.recurrence * 0.25 + priorityBreakdown.evidence * 0.2 + priorityBreakdown.feasibility * 0.1);
    return [{
      ...template,
      ...adaptation,
      ...controls[key],
      id: `${warehouse}-${key}-initiative`,
      warehouse,
      confidence: pain.confidence,
      priorityScore,
      priorityBreakdown,
      linkedPainIds: [pain.id],
      evidence: [...pain.evidence.slice(0, 3), ...(supportingRelationship ? [supportingRelationship.narrative] : [])],
    } satisfies Initiative];
  });
  const fallbacks = ["forecast", "productivity"].filter((key) => !selected.some((item) => item.id.includes(`-${key}-`))).map((key) => ({
    ...templates[key],
    ...adaptive(key, null),
    ...controls[key],
    id: `${warehouse}-${key}-initiative`,
    warehouse,
    confidence: "low" as const,
    priorityScore: 0,
    priorityBreakdown: { impact: 0, recurrence: 0, evidence: 0, feasibility: templates[key].effort === "low" ? 90 : 70 },
    linkedPainIds: [],
    evidence: ["Inisiatif dasar; evidence berulang belum mencapai ambang prioritas."],
  } satisfies Initiative));
  // Evidence-linked initiatives are ranked and filled first. Fallbacks only ever
  // occupy leftover slots: sorting them into one pool let a hardcoded score of 55
  // push out a real, evidence-backed initiative that had scored lower.
  return [...selected.sort((a, b) => b.priorityScore - a.priorityScore), ...fallbacks].slice(0, 4);
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

function metricSemanticCatalog(points: MetricPoint[], current: Window): OperationalMetricSemantic[] {
  const catalog = new Map<string, {
    division: string;
    role: string;
    remarks: string;
    metric: string;
    detail: string;
    activeDates: Set<string>;
  }>();
  for (const point of points) {
    const id = `${normalizeLabel(point.division)}|${normalizeLabel(point.role)}|${normalizeLabel(point.metric)}|${normalizeLabel(point.remarks)}`;
    const existing = catalog.get(id) ?? {
      division: point.division,
      role: point.role,
      remarks: point.remarks,
      metric: point.metric,
      detail: point.detail,
      activeDates: new Set<string>(),
    };
    if (!existing.detail && point.detail) existing.detail = point.detail;
    if (point.quality === "valid" && point.value !== null && point.date >= current.start && point.date <= current.end) existing.activeDates.add(point.date);
    catalog.set(id, existing);
  }
  for (const item of OPERATION_GLOSSARY) {
    const division = canonicalDivision(item.division);
    const id = `${normalizeLabel(division)}|${normalizeLabel(item.role)}|${normalizeLabel(item.metric)}|${normalizeLabel(item.remarks)}`;
    if (!catalog.has(id)) catalog.set(id, {
      division,
      role: item.role,
      remarks: item.remarks,
      metric: item.metric,
      detail: item.details,
      activeDates: new Set<string>(),
    });
  }
  return [...catalog.values()]
    .map((item) => buildMetricSemantic({
      division: canonicalDivision(item.division),
      role: item.role,
      remarks: item.remarks,
      metric: item.metric,
      detail: item.detail,
      activeCoverage: Math.min(1, item.activeDates.size / current.days),
    }))
    .sort((a, b) => a.division.localeCompare(b.division) || a.role.localeCompare(b.role) || a.metric.localeCompare(b.metric));
}

function intelligenceSummary(catalog: OperationalMetricSemantic[]): IntelligenceSummary {
  const domains = [...new Set(catalog.map((item) => item.division))].sort().map((domain) => {
    const metrics = catalog.filter((item) => item.division === domain);
    const active = metrics.filter((item) => item.activeCoverage > 0);
    return {
      domain,
      totalMetrics: metrics.length,
      activeMetrics: active.length,
      decisionReadyMetrics: metrics.filter((item) => item.readiness === "decision_ready").length,
      activeCoveragePct: metrics.length ? Math.round(active.reduce((sum, item) => sum + item.activeCoverage, 0) / metrics.length * 100) : 0,
    };
  });
  const semanticallyUsable = catalog.filter((item) => item.readiness !== "unconfirmed" && (item.detail.trim() || item.family !== "other")).length;
  return {
    sourceMetrics: catalog.length,
    activeMetrics: catalog.filter((item) => item.activeCoverage > 0).length,
    decisionReadyMetrics: catalog.filter((item) => item.readiness === "decision_ready").length,
    diagnosticMetrics: catalog.filter((item) => item.readiness === "diagnostic_only").length,
    observationalMetrics: catalog.filter((item) => item.readiness === "observational").length,
    unconfirmedMetrics: catalog.filter((item) => item.readiness === "unconfirmed").length,
    semanticCoveragePct: catalog.length ? Math.round(semanticallyUsable / catalog.length * 100) : 0,
    domains,
    operatingRules: OPERATING_RULES,
  };
}

/**
 * Benchmarks every warehouse on one shared cut-off and one shared KPI basket.
 *
 * Two things used to make this table misleading. It ran its own four-metric score,
 * so a warehouse could rank on a number that disagreed with its own cockpit gauge;
 * and each warehouse resolved its own latest date, so the "common cut-off" the
 * README promised was not enforced. It now takes the earliest of the warehouses'
 * operational dates, so nobody is compared against a fresher week than the rest.
 */
function warehouseComparison(dataset: OperationalDataset, period: Period, requestedAsOf?: string, requestedDays?: number): WarehouseComparisonRow[] {
  const resolved = PRIORITY_WAREHOUSES.map((warehouse) => {
    const points = dataset.points.filter((point) => point.warehouse === warehouse);
    const availableDates = [...new Set(points.filter((point) => point.quality === "valid").map((point) => point.date))].sort();
    const eligible = availableDates.filter((date) => !requestedAsOf || date <= requestedAsOf);
    return { warehouse, points, latest: latestOperationalDate(points, eligible) };
  });

  const sharedAsOf = resolved.map((item) => item.latest).filter((date): date is string => Boolean(date)).sort()[0] ?? null;
  // A pillar counts as comparable only when at least one warehouse reports it,
  // so a metric nobody tracks does not drag every row down.
  const maxPillars = Math.max(1, ...resolved.map((item) => {
    if (!sharedAsOf || !item.latest) return 0;
    const rangeStart = period === "custom" && requestedDays ? shiftIso(sharedAsOf, -(requestedDays - 1)) : undefined;
    const { current, previous } = windows(sharedAsOf, period, rangeStart);
    return KPI_KEYS.map((key) => reading(item.points, key, current, previous)).filter((kpi) => kpi.value !== null).length;
  }));

  return resolved.map(({ warehouse, points, latest }) => {
    if (!sharedAsOf || !latest) {
      return { warehouse, healthScore: 0, status: "watch" as const, asOf: null, forecastAccuracy: null, productivity: null, fulfillment: null, demandFillRate: null, cancelRate: null, dataConfidence: 0, pillarsAvailable: 0, pillarsTotal: KPI_KEYS.length, comparable: false };
    }
    const rangeStart = period === "custom" && requestedDays ? shiftIso(sharedAsOf, -(requestedDays - 1)) : undefined;
    const { current, previous } = windows(sharedAsOf, period, rangeStart);
    const kpis = KPI_KEYS.map((key) => reading(points, key, current, previous));
    const health = healthFrom(kpis);
    const pick = (key: string) => kpis.find((item) => item.key === key)?.value ?? null;
    return {
      warehouse,
      healthScore: health.score,
      status: health.status,
      asOf: sharedAsOf,
      forecastAccuracy: pick("forecast_accuracy"),
      productivity: pick("productivity_attainment"),
      fulfillment: pick("fulfillment_rate"),
      demandFillRate: pick("demand_fill_rate"),
      cancelRate: pick("cancel_rate"),
      dataConfidence: Math.round((kpis.reduce((sum, item) => sum + item.coverage, 0) / kpis.length) * 100),
      pillarsAvailable: health.pillarsAvailable,
      pillarsTotal: KPI_KEYS.length,
      comparable: health.pillarsAvailable >= maxPillars,
    };
  });
}

/**
 * Zonal occupancy, with two guards the raw sheet needs.
 *
 * Every zone in every warehouse reported 0 on 2026-08-10 — a snapshot that did not
 * run, not an empty warehouse — so zero readings are dropped rather than averaged
 * in. And SRG and STR report an identical actual for Ambient and Chiller on every
 * date, which then gets divided by two different maximums to produce two different
 * utilizations from one number. At most one of those can be right, so both are
 * flagged instead of being drawn as fact.
 */
function capacityZones(points: MetricPoint[], current: Window): CapacityZone[] {
  const zones = (["Ambient", "Chiller", "Frozen"] as const).map((zone) => {
    const suffix = normalizeLabel(zone);
    const actualPoints = points.filter((point) => normalizeLabel(point.metric) === `inventory actual max by qty ${suffix}` && point.value !== 0);
    const maximumPoints = points.filter((point) => normalizeLabel(point.metric) === `inventory capacity max by qty ${suffix}` && point.value !== 0);
    const actual = aggregateRaw(actualPoints, current, "latest", "qty").value;
    const maximum = aggregateRaw(maximumPoints, current, "latest", "qty").value;
    const utilization = actual !== null && maximum !== null && maximum > 0 ? (actual / maximum) * 100 : null;
    const status: CapacityZone["status"] = utilization === null ? "unavailable" : utilization >= 92 ? "critical" : utilization >= 85 ? "watch" : "controlled";
    return { zone, actual, maximum, utilization, status, note: null as string | null };
  });

  for (const zone of zones) {
    if (zone.actual === null) continue;
    const twins = zones.filter((other) => other.zone !== zone.zone && other.actual === zone.actual);
    if (twins.length) {
      zone.note = `Actual identik dengan ${twins.map((item) => item.zone).join(" dan ")}; salah satu pemetaan zona di sumber hampir pasti keliru. Jangan pakai utilisasi ini untuk keputusan kapasitas sebelum dikonfirmasi.`;
    }
  }
  return zones;
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

function volumeFlow(points: MetricPoint[], window: Window): VolumeFlowPoint[] {
  return datesInWindow(window).map((date) => ({
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

function laborBalance(points: MetricPoint[], window: Window): LaborBalancePoint[] {
  return datesInWindow(window).map((date) => ({
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

function capacityHistory(points: MetricPoint[], window: Window): CapacityHistoryPoint[] {
  return datesInWindow(window).map((date) => ({
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

/**
 * Guarded association signals.
 *
 * Three corrections over the first version. Confidence now comes from the p-value
 * rather than the sample size alone — an r of 0.02 over 40 days was previously
 * badged "high confidence" when it is indistinguishable from noise. A Bonferroni
 * threshold covers the whole hypothesis set, because running nine hypotheses across
 * four warehouses at alpha 0.05 is expected to manufacture false positives. And
 * pairs that share an input are named as such: picker productivity is literally
 * volume divided by mandays, so correlating it against mandays variance measures
 * the formula, not the operation.
 */
function relationshipSignals(points: MetricPoint[], asOf: string, skipDates: Set<string>): RelationshipSignal[] {
  const definitions = [
    { id: "forecast-productivity", driverKey: "forecast_error", driverLabel: "Forecast error", outcomeKey: "productivity_attainment", outcomeLabel: "Picker productivity", driverDomain: "Planning", outcomeDomain: "Outbound", lagDays: 0, expectedSign: -1, sharedTerm: "Outbound qty requested (ada di kedua sisi)", decision: "Gunakan flex labor saat forecast error bergerak bersama productivity dilution." },
    { id: "mandays-productivity", driverKey: "mandays_variance", driverLabel: "Mandays variance", outcomeKey: "productivity_attainment", outcomeLabel: "Picker productivity", driverDomain: "Personalia", outcomeDomain: "Outbound", lagDays: 0, expectedSign: -1, sharedTerm: "Actual mandays picker (penyebut produktivitas, pembilang variance)", decision: "Pisahkan excess mandays dari process loss sebelum mengubah budget." },
    { id: "attendance-sla", driverKey: "attendance_all", driverLabel: "Attendance", outcomeKey: "sla_checker_inbound", outcomeLabel: "Inbound SLA", driverDomain: "Personalia", outcomeDomain: "Inbound", lagDays: 0, expectedSign: 1, sharedTerm: null, decision: "Gunakan attendance sebagai early warning SLA, bukan alasan tunggal menambah MP." },
    { id: "dcc-pickface", driverKey: "dcc_accuracy", driverLabel: "DCC accuracy", outcomeKey: "pick_to_pf", outcomeLabel: "Pick to PF", driverDomain: "Inventory", outcomeDomain: "Outbound", lagDays: 1, expectedSign: 1, sharedTerm: null, decision: "Prioritaskan SLOC correction bila accuracy hari ini terkait pickface availability besok." },
    { id: "replenish-pickface", driverKey: "replenishment_completion", driverLabel: "Replenishment completion", outcomeKey: "pick_to_pf", outcomeLabel: "Pick to PF", driverDomain: "Inventory", outcomeDomain: "Outbound", lagDays: 1, expectedSign: 1, sharedTerm: null, decision: "Sinkronkan replenishment cut-off dengan kebutuhan picking H+1." },
    { id: "troubleshoot-fr", driverKey: "troubleshoot_fr", driverLabel: "Troubleshoot FR", outcomeKey: "fulfillment_rate", outcomeLabel: "Warehouse FR", driverDomain: "Inventory", outcomeDomain: "Service", lagDays: 0, expectedSign: 1, sharedTerm: null, decision: "Alokasikan recovery berdasarkan contribution-to-FR, aging, dan value-at-risk." },
    { id: "cancel-productivity", driverKey: "cancel_rate", driverLabel: "Cancel rate", outcomeKey: "productivity_attainment", outcomeLabel: "Picker productivity", driverDomain: "Planning", outcomeDomain: "Outbound", lagDays: 0, expectedSign: -1, sharedTerm: "Outbound qty requested (penyebut cancel rate, pembilang produktivitas)", decision: "Wajibkan capacity proof bila cancel naik tetapi productivity tidak ikut pulih." },
    { id: "capacity-productivity", driverKey: "capacity_pressure", driverLabel: "Capacity pressure >85%", outcomeKey: "productivity_attainment", outcomeLabel: "Picker productivity", driverDomain: "Capacity", outcomeDomain: "Outbound", lagDays: 0, expectedSign: -1, sharedTerm: null, decision: "Aktifkan overflow playbook sebelum congestion menekan output per manday." },
  ];
  // Eight hypotheses x four warehouses is the family the correction has to cover.
  const bonferroni = 0.05 / (definitions.length * PRIORITY_WAREHOUSES.length);
  const dates = Array.from({ length: 84 }, (_, index) => shiftIso(asOf, index - 83)).filter((date) => !skipDates.has(date));

  return definitions.map((definition) => {
    const pairs: Array<[number, number]> = [];
    for (const date of dates) {
      const outcomeDate = shiftIso(date, definition.lagDays);
      if (skipDates.has(outcomeDate)) continue;
      const driver = dailyDerived(points, definition.driverKey, date);
      const outcome = dailyDerived(points, definition.outcomeKey, outcomeDate);
      if (driver !== null && outcome !== null && Number.isFinite(driver) && Number.isFinite(outcome)) pairs.push([driver, outcome]);
    }
    const coefficient = pearson(pairs);
    const absolute = Math.abs(coefficient ?? 0);
    const pValue = coefficient === null ? null : correlationPValue(coefficient, pairs.length);
    const survivesMultiplicity = pValue !== null && pValue < bonferroni;
    const strength: RelationshipSignal["strength"] = coefficient === null ? "insufficient" : absolute >= 0.55 ? "strong" : absolute >= 0.3 ? "moderate" : "weak";
    const confidence: RelationshipSignal["confidence"] = pValue === null || pValue >= 0.05 || pairs.length < 18
      ? "low"
      : survivesMultiplicity && pairs.length >= 35
        ? "high"
        : "medium";
    const alignment: RelationshipSignal["alignment"] = coefficient === null || pValue === null || pValue >= 0.05 || absolute < 0.2
      ? "inconclusive"
      : Math.sign(coefficient) === definition.expectedSign ? "supports" : "contradicts";

    const stat = coefficient === null
      ? "belum cukup data"
      : `r=${coefficient.toFixed(2)}, n=${pairs.length}, p=${pValue === null ? "n/a" : pValue < 0.0001 ? "<0,0001" : pValue.toFixed(4)}`;
    const multiplicityNote = coefficient === null ? "" : survivesMultiplicity ? " Bertahan setelah koreksi multiplisitas." : " Tidak bertahan setelah koreksi multiplisitas—perlakukan sebagai petunjuk, bukan bukti.";
    const sharedNote = definition.sharedTerm ? ` Peringatan: kedua sisi berbagi ${definition.sharedTerm}, sehingga sebagian korelasi ini dijamin oleh rumus dan bukan temuan operasional.` : "";
    const narrative = alignment === "supports"
      ? `${definition.driverLabel} bergerak sesuai arah hubungan operasional yang diharapkan terhadap ${definition.outcomeLabel} (${stat}).${multiplicityNote}${sharedNote}`
      : alignment === "contradicts"
        ? `Pola ${definition.driverLabel} terhadap ${definition.outcomeLabel} berlawanan dengan hipotesis awal (${stat}); cek segmentasi shift, weekday, dan volume—atau hipotesisnya yang perlu dikoreksi.${multiplicityNote}${sharedNote}`
        : `Hubungan ${definition.driverLabel} dan ${definition.outcomeLabel} tidak dapat dibedakan dari noise (${stat}); jangan gunakan sebagai dasar keputusan.${sharedNote}`;

    return { ...definition, coefficient, pValue, survivesMultiplicity, sampleSize: pairs.length, strength, confidence, alignment, narrative } satisfies RelationshipSignal;
  }).sort((a, b) => {
    // Rank by evidential weight: confirmed signals first, confounded ones last.
    const weight = (item: RelationshipSignal) => (item.survivesMultiplicity ? 2 : item.alignment === "inconclusive" ? 0 : 1) - (item.sharedTerm ? 0.5 : 0);
    return weight(b) - weight(a) || Math.abs(b.coefficient ?? 0) - Math.abs(a.coefficient ?? 0);
  });
}

function riskMatrix(points: MetricPoint[], asOf: string): RiskMatrix {
  const definitions = [
    { domain: "Planning", keys: ["forecast_accuracy", "inbound_forecast_accuracy"] },
    // schedule_accuracy is deliberately excluded: the source definition remains
    // unconfirmed and values can exceed 100%, so it must not shape risk or action.
    { domain: "People", keys: ["attendance_all", "churn_all"] },
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
  const strongest = relationships.find((item) => item.survivesMultiplicity && !item.sharedTerm && item.alignment !== "inconclusive");

  const mandays = value("mandays_variance");
  const productivity = value("productivity_attainment");
  const sla = value("sla_checker_inbound");
  const cancelRate = value("cancel_rate");
  const cancelTarget = rules.cancel_rate.target ?? 2;
  if (mandays !== null && productivity !== null && sla !== null) {
    if (mandays < -3 && productivity >= 100 && sla >= 98 && cancelRate !== null && cancelRate > cancelTarget) {
      // The three "healthy" readings are all measured on workload that was thrown
      // away. Cancelling demand lowers the mandays needed and raises output per
      // manday at the same time, which is exactly the pattern that would otherwise
      // be read as efficiency — so the budget recommendation is withheld.
      add({
        id: "labor-saving-confounded-by-cancel",
        priority: cancelRate > 5 ? "critical" : "high",
        domain: "Labor economics",
        title: "Penghematan mandays tidak dapat dinilai selama cancel masih tinggi",
        observation: `Actual mandays ${Math.abs(mandays).toFixed(1)}% di bawah budget dengan productivity ${pct(productivity)} dan SLA ${pct(sla)}, tetapi ${pct(cancelRate)} permintaan dibatalkan pada window yang sama.`,
        implication: "Ketiga angka sehat itu diukur setelah sebagian beban kerja dihapus. Beban yang 'tidak membutuhkan' manday adalah beban yang dibuang, bukan beban yang diselesaikan lebih efisien.",
        recommendedAction: `Turunkan cancel ke bawah ${cancelTarget}% lebih dulu, lalu ukur ulang mandays pada beban kerja penuh. Jangan mengubah baseline budget berdasarkan window ini.`,
        evidence: [`Mandays variance ${pct(mandays)}`, `Cancel rate ${pct(cancelRate)} (target ${cancelTarget}%)`, `Demand fill rate ${pct(value("demand_fill_rate"))}`],
        confidence: confidenceFor("mandays_variance", "cancel_rate", "productivity_attainment"),
      });
    } else if (mandays < -3 && productivity >= 100 && sla >= 98) {
      add({
        id: "labor-budget-opportunity",
        priority: "high",
        domain: "Labor economics",
        title: "Budget mandays berpotensi lebih besar dari kebutuhan aktual",
        observation: `Actual mandays ${Math.abs(mandays).toFixed(1)}% di bawah budget, sementara productivity ${pct(productivity)}, inbound SLA ${pct(sla)}, dan cancel ${pct(cancelRate)} sama-sama sehat.`,
        implication: "Efisiensi tidak sedang dibayar dengan penurunan output, service, atau permintaan yang dibuang; baseline budget layak diuji ulang per weekday dan volume band.",
        recommendedAction: "Backtest 8 minggu dan turunkan budget hanya pada volume band yang konsisten, dengan SLA 98%, productivity 100%, dan cancel di bawah target sebagai stop-loss.",
        evidence: [`Mandays variance ${pct(mandays)}`, `Productivity ${pct(productivity)}`, `Inbound SLA ${pct(sla)}`, `Cancel rate ${pct(cancelRate)}`],
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
    const relationship = relationships.find((item) =>
      ["dcc-pickface", "replenish-pickface", "troubleshoot-fr"].includes(item.id)
      && item.survivesMultiplicity
      && !item.sharedTerm
      && item.alignment !== "inconclusive");
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

function operationsEconomics(points: MetricPoint[], current: Window, previous: Window, kpis: MetricReading[], zones: CapacityZone[]): OperationsEconomics {
  const currentValue = (key: string, mode: AggregationMode = "sum") => metricValue(points, key, current, mode).value;
  const previousValue = (key: string, mode: AggregationMode = "sum") => metricValue(points, key, previous, mode).value;
  const kpi = (key: string) => kpis.find((item) => item.key === key)?.value ?? null;
  const requestedQty = currentValue("outbound_before_cancel");
  const afterCancelQty = currentValue("outbound_requested");
  const servedQty = currentValue("outbound_rts");
  const hubQty = currentValue("outbound_actual_hub");
  const budgetMandays = currentValue("budget_picker_mandays");
  const actualMandays = currentValue("actual_picker_mandays");
  const previousServed = previousValue("outbound_rts");
  const previousMandays = previousValue("actual_picker_mandays");
  const cancelledQty = requestedQty !== null && afterCancelQty !== null ? Math.max(0, requestedQty - afterCancelQty) : null;
  const executionLossQty = afterCancelQty !== null && servedQty !== null ? Math.max(0, afterCancelQty - servedQty) : null;
  const downstreamLossQty = servedQty !== null && hubQty !== null ? Math.max(0, servedQty - hubQty) : null;
  const finalServiceQty = hubQty ?? servedQty;
  const unservedDemandQty = requestedQty !== null && finalServiceQty !== null ? Math.max(0, requestedQty - finalServiceQty) : null;
  const mandaysDelta = actualMandays !== null && budgetMandays !== null && budgetMandays > 0 ? (actualMandays - budgetMandays) / budgetMandays * 100 : null;
  const costToServeMdPerThousand = actualMandays !== null && servedQty !== null && servedQty > 0 ? actualMandays / servedQty * 1_000 : null;
  const previousCostToServeMdPerThousand = previousMandays !== null && previousServed !== null && previousServed > 0 ? previousMandays / previousServed * 1_000 : null;
  const costToServeDeltaPct = costToServeMdPerThousand !== null && previousCostToServeMdPerThousand !== null && previousCostToServeMdPerThousand > 0
    ? (costToServeMdPerThousand - previousCostToServeMdPerThousand) / previousCostToServeMdPerThousand * 100
    : null;
  const productivity = kpi("productivity_attainment");
  const demandFill = kpi("demand_fill_rate");
  const sla = kpi("sla_checker_inbound");
  const cancel = kpi("cancel_rate");
  const serviceAdjustedProductivity = productivity === null ? null
    : productivity * Math.min(1, (demandFill ?? 97) / 97) * Math.min(1, (sla ?? 98) / 98);
  const peakZoneUtilization = zones.map((zone) => zone.utilization).filter((value): value is number => value !== null).sort((a, b) => b - a)[0] ?? null;
  const capacityHeadroomPct = peakZoneUtilization === null ? null : 100 - peakZoneUtilization;

  let verdict: OperationsEconomics["verdict"] = "balanced";
  if (actualMandays === null || servedQty === null || mandaysDelta === null) verdict = "insufficient";
  else if (mandaysDelta < -3 && ((cancel ?? 0) > 2 || (demandFill ?? 100) < 97)) verdict = "false_economy";
  else if (mandaysDelta < -3 && ((productivity ?? 100) < 92 || (sla ?? 100) < 98)) verdict = "undercoverage";
  else if (mandaysDelta < -3 && (productivity ?? 0) >= 100 && (sla ?? 0) >= 98 && (cancel ?? 100) <= 2 && (demandFill ?? 0) >= 97) verdict = "validated_saving";
  else if (mandaysDelta >= -3 && (productivity ?? 100) < 92) verdict = "process_loss";

  const copy: Record<OperationsEconomics["verdict"], { headline: string; narrative: string }> = {
    validated_saving: { headline: "Penghematan tenaga kerja tervalidasi", narrative: "Mandays lebih rendah tetap menjaga produktivitas, SLA, cancel, dan permintaan yang dilayani. Uji ulang baseline budget per volume band sebelum menjadikannya standar." },
    false_economy: { headline: "Hemat mandays, tetapi demand ikut hilang", narrative: "Selisih mandays belum bisa disebut efisiensi karena cancel atau demand fill melewati guardrail. Pulihkan service lebih dulu, lalu hitung ulang kebutuhan tenaga kerja." },
    undercoverage: { headline: "Risiko kekurangan tenaga kerja", narrative: "Mandays berada di bawah budget, tetapi produktivitas atau SLA tidak aman. Tambahkan kapasitas hanya pada jam constraint dan ukur respons outputnya." },
    process_loss: { headline: "Tenaga kerja tersedia, output belum mengikuti", narrative: "Gap lebih mungkin berasal dari volume dilution, pickface, assignment, atau process loss. Jangan menambah manpower sebelum loss tree per jam jelas." },
    balanced: { headline: "Biaya tenaga kerja dan service relatif seimbang", narrative: "Belum ada indikasi kuat false saving atau process loss. Pertahankan guardrail dan bandingkan per weekday serta volume band." },
    insufficient: { headline: "Bukti biaya operasi belum cukup", narrative: "Actual mandays atau volume yang dilayani belum tersedia lengkap. Sistem tidak mengubah kekosongan data menjadi rekomendasi penghematan." },
  };
  const format = (value: number | null, suffix = "") => value === null ? "n/a" : `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}${suffix}`;
  return {
    verdict,
    ...copy[verdict],
    requestedQty,
    servedQty,
    cancelledQty,
    executionLossQty,
    downstreamLossQty,
    unservedDemandQty,
    budgetMandays,
    actualMandays,
    mandaysDelta,
    costToServeMdPerThousand,
    previousCostToServeMdPerThousand,
    costToServeDeltaPct,
    serviceAdjustedProductivity,
    capacityHeadroomPct,
    evidence: [
      `Demand awal ${format(requestedQty)}; dilayani ${format(servedQty)}; tidak terlayani ${format(unservedDemandQty)}.`,
      `Actual mandays ${format(actualMandays)} vs budget ${format(budgetMandays)} (${format(mandaysDelta, "%")}).`,
      `Intensitas tenaga kerja ${format(costToServeMdPerThousand)} MD per 1.000 unit; perubahan ${format(costToServeDeltaPct, "%")}.`,
    ],
    guardrails: ["Demand fill ≥97%", "Cancel ≤2%", "Inbound SLA ≥98%", "Productivity attainment ≥100%", "Zonal capacity <92%"],
  };
}

function causalChains(
  points: MetricPoint[],
  current: Window,
  kpis: MetricReading[],
  zones: CapacityZone[],
  relationships: RelationshipSignal[],
  economics: OperationsEconomics,
  pains: PainPoint[],
): CausalChain[] {
  const kpi = (key: string) => kpis.find((item) => item.key === key)?.value ?? null;
  const value = (key: string, mode: AggregationMode = "average") => normalizePercent(key, metricValue(points, key, current, mode).value);
  const raw = (key: string, mode: AggregationMode = "sum") => metricValue(points, key, current, mode).value;
  const format = (item: number | null, suffix = "") => item === null ? "n/a" : `${item.toLocaleString("id-ID", { maximumFractionDigits: 1 })}${suffix}`;
  const painIds = (...tokens: string[]) => pains.filter((pain) => tokens.some((token) => normalizeLabel(`${pain.domain} ${pain.title}`).includes(normalizeLabel(token)))).map((pain) => pain.id);
  const statisticallySupported = (...ids: string[]) => relationships.find((item) => ids.includes(item.id) && item.survivesMultiplicity && !item.sharedTerm && item.alignment !== "inconclusive");
  const chains: CausalChain[] = [];

  const forecastAccuracy = kpi("forecast_accuracy");
  const productivity = kpi("productivity_attainment");
  const demandFill = kpi("demand_fill_rate");
  const cancel = kpi("cancel_rate");
  const forecast = raw("forecast_weekly_outbound");
  const demandBeforeCancel = economics.requestedQty;
  const volumeLaborState: CausalChain["state"] = forecastAccuracy === null || productivity === null || economics.actualMandays === null
    ? "blocked"
    : (forecastAccuracy < 85 || forecastAccuracy > 115) && productivity < 100 ? "supported" : "hypothesis";
  chains.push({
    id: "forecast-labor-productivity",
    priorityScore: Math.round(clamp((forecastAccuracy === null ? 20 : Math.abs(100 - forecastAccuracy) * 2.2) + (productivity === null ? 15 : Math.max(0, 100 - productivity) * 1.8) + 28)),
    title: "Forecast → manpower plan → produktivitas actual",
    domain: "Planning + Labor",
    state: volumeLaborState,
    confidence: volumeLaborState === "supported" ? "medium" : "low",
    cause: "Workload aktual bergerak berbeda dari forecast yang dipakai untuk menyiapkan manpower.",
    mechanism: ["Forecast membentuk MPP dan budget mandays", "Actual volume menjadi numerator produktivitas", "Fixed mandays pada volume rendah menciptakan dilution; volume tinggi menciptakan overload"],
    outcome: "Produktivitas, SLA, dan kebutuhan flex manpower dapat bergerak berlawanan bila volume band tidak dikontrol.",
    evidence: [`Demand awal ${format(demandBeforeCancel)} vs forecast ${format(forecast)} (${format(forecastAccuracy, "%")}).`, `Actual mandays ${format(economics.actualMandays)} vs budget ${format(economics.budgetMandays)}.`, `Productivity attainment ${format(productivity, "%")}.`],
    counterEvidence: productivity !== null && productivity >= 100 ? ["Produktivitas masih mencapai target; variance forecast belum terbukti menjadi process loss pada window ini."] : [],
    missingEvidence: ["Hourly workload dan remaining hours", "Alokasi MP per shift/role", "Skill mix regular vs OJT"],
    recommendedAction: forecastAccuracy !== null && forecastAccuracy < 90
      ? "Rebaseline staffing per volume band dan weekday; redeploy flex pool hanya setelah remaining workload terukur."
      : "Backtest bias forecast per weekday dan aktifkan flex trigger ketika actual keluar dari band ±10%.",
    linkedPainIds: painIds("forecast", "productivity", "personalia"),
  });

  const cancelState: CausalChain["state"] = cancel === null || demandFill === null ? "blocked" : cancel > 2 && demandFill < 97 ? "verified" : cancel > 2 ? "supported" : "hypothesis";
  chains.push({
    id: "cancel-demand-service",
    priorityScore: Math.round(clamp((cancel ?? 0) * 2.5 + Math.max(0, 97 - (demandFill ?? 97)) * 3 + 35)),
    title: "Request awal → cancel → eksekusi → demand terlayani",
    domain: "Outbound + Service",
    state: cancelState,
    confidence: cancelState === "verified" ? "high" : cancelState === "supported" ? "medium" : "low",
    cause: "Sebagian request dikeluarkan sebelum eksekusi warehouse selesai dinilai.",
    mechanism: ["Cancel menurunkan demand yang masuk ke denominator fulfillment", "Mandays yang sudah hadir tetap menjadi cost", "Fulfillment post-cancel dapat naik sementara demand fill tetap turun"],
    outcome: "Service terlihat sehat pada denominator setelah cancel walau demand awal tidak terselesaikan.",
    evidence: [`Cancel ${format(cancel, "%")} atau ${format(economics.cancelledQty)} unit.`, `Demand fill sebelum cancel ${format(demandFill, "%")}.`, `Demand tidak terlayani ${format(economics.unservedDemandQty)} unit.`],
    counterEvidence: economics.capacityHeadroomPct !== null && economics.capacityHeadroomPct < 8 ? ["Headroom zona <8%; sebagian cancel mungkin berasal dari constraint capacity nyata."] : [],
    missingEvidence: ["Reason code cancel", "Remaining hours saat approval", "Projected run-rate dan constrained process"],
    recommendedAction: cancel !== null && cancel >= 20
      ? "Aktifkan war room demand protection: reason-code wajib, capacity proof per jam, dan approval head untuk cancel tambahan."
      : "Terapkan challenge gate sebelum cancel dengan remaining volume, run-rate, attendance, dan headroom zona.",
    linkedPainIds: painIds("cancel", "outbound"),
  });

  const dcc = kpi("dcc_accuracy");
  const replenish = value("replenishment_completion");
  const troubleshoot = kpi("troubleshoot_fr");
  const pickface = kpi("pick_to_pf");
  const inventoryFailures = [dcc !== null && dcc < 95, replenish !== null && replenish < 92, troubleshoot !== null && troubleshoot < 85, pickface !== null && pickface < 80].filter(Boolean).length;
  const inventoryAssociation = statisticallySupported("dcc-pickface", "replenish-pickface", "troubleshoot-fr");
  const inventoryState: CausalChain["state"] = [dcc, replenish, troubleshoot, pickface].filter((item) => item !== null).length < 2 ? "blocked" : inventoryFailures >= 2 ? "supported" : "hypothesis";
  chains.push({
    id: "inventory-sloc-service",
    priorityScore: Math.round(clamp(25 + inventoryFailures * 18 + (inventoryAssociation ? 12 : 0))),
    title: "SLOC → replenish → troubleshoot → picking",
    domain: "Inventory + Outbound",
    state: inventoryState,
    confidence: inventoryState === "supported" && inventoryAssociation ? "high" : inventoryState === "supported" ? "medium" : "low",
    cause: "Readiness dan akurasi lokasi menentukan apakah picker menemukan stok di pickface.",
    mechanism: ["SLOC tidak akurat menciptakan shortage semu atau task lost", "Replenishment terlambat memindahkan picking keluar pickface", "Troubleshoot menyerap recovery work sebelum SO dapat dipenuhi"],
    outcome: "Travel, rework, Pick-to-Lost, productivity, dan fulfillment bergerak sebagai satu loss chain.",
    evidence: [`DCC ${format(dcc, "%")}; replenish ${format(replenish, "%")}.`, `Troubleshoot FR ${format(troubleshoot, "%")}; Pick-to-PF ${format(pickface, "%")}.`, ...(inventoryAssociation ? [inventoryAssociation.narrative] : [])],
    counterEvidence: inventoryFailures === 0 ? ["Metric inventory yang tersedia belum menembus guardrail pada window ini."] : [],
    missingEvidence: ["SLOC repeat offender per SKU", "Aging replenish dan troubleshoot", ...(raw("actual_picker_mandays") === null ? ["Actual mandays picker"] : [])],
    recommendedAction: inventoryFailures >= 2
      ? "Buat loss tree per SLOC: repeat offender DCC, next-wave replenish, aging troubleshoot, lalu ukur efek H+1 pada Pick-to-PF dan FR."
      : "Validasi missing coverage dan jalankan sampling SLOC sebelum menyimpulkan penyebab produktivitas.",
    linkedPainIds: painIds("dcc", "replenish", "troubleshoot", "inventory"),
  });

  const checkerBudget = raw("budget_checker_mandays");
  const checkerActual = raw("actual_checker_mandays");
  const checkerSla = kpi("sla_checker_inbound");
  const checkerProductivity = normalizePercent("inbound_productivity_attainment", derived(points, "inbound_productivity_attainment", current).value);
  const checkerState: CausalChain["state"] = checkerBudget === null || checkerActual === null || checkerSla === null ? "blocked"
    : checkerActual < checkerBudget && checkerSla < 98 ? "supported" : "hypothesis";
  chains.push({
    id: "checker-labor-sla",
    priorityScore: Math.round(clamp(30 + Math.max(0, 98 - (checkerSla ?? 98)) * 3 + Math.max(0, 100 - (checkerProductivity ?? 100)) * 1.2)),
    title: "Checker manpower → lead time → inbound SLA",
    domain: "Inbound + Labor",
    state: checkerState,
    confidence: checkerState === "supported" ? "medium" : "low",
    cause: "Checker capacity dan workload aktual menentukan lead time penerimaan.",
    mechanism: ["Kurang MP menambah queue dan lead time", "Lebih banyak MP memberi SLA buffer", "Overstaff pada volume rendah dapat menurunkan output per manday"],
    outcome: "SLA dan productivity harus dioptimalkan sebagai pasangan, bukan secara terpisah.",
    evidence: [`Checker actual MD ${format(checkerActual)} vs budget ${format(checkerBudget)}.`, `Inbound SLA ${format(checkerSla, "%")}; productivity attainment ${format(checkerProductivity, "%")}.`],
    counterEvidence: checkerSla !== null && checkerSla >= 98 ? ["SLA checker masih memenuhi guardrail pada cut aktif."] : [],
    missingEvidence: ["Arrival curve PO per jam", "Lead time checker per batch", "Attendance checker aktual"],
    recommendedAction: "Bandingkan staffing pada volume band dan arrival curve yang sama; ubah MP hanya di jam constraint, lalu ukur respons SLA dan productivity.",
    linkedPainIds: painIds("personalia", "inbound"),
  });

  const constrainedZone = [...zones].filter((zone) => zone.utilization !== null).sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0];
  const capacityState: CausalChain["state"] = !constrainedZone ? "blocked" : (constrainedZone.utilization ?? 0) >= 85 ? "verified" : "hypothesis";
  chains.push({
    id: "zone-capacity-flow",
    priorityScore: Math.round(clamp(25 + Math.max(0, (constrainedZone?.utilization ?? 70) - 75) * 2.5)),
    title: `${constrainedZone?.zone ?? "Zonal"} capacity → congestion → throughput`,
    domain: "Capacity + Flow",
    state: capacityState,
    confidence: capacityState === "verified" ? "high" : capacityState === "blocked" ? "low" : "medium",
    cause: "Constraint lokal di satu zona dapat tersembunyi oleh rata-rata kapasitas warehouse.",
    mechanism: ["Occupancy tinggi mengurangi ruang staging/putaway", "Congestion menambah travel dan queue", "Tambahan MP atau volume memberi diminishing return dekat batas kapasitas"],
    outcome: "Putaway SLA, replenishment, dan outbound throughput dapat turun bersamaan.",
    evidence: constrainedZone ? [`${constrainedZone.zone} ${format(constrainedZone.utilization, "%")} (${format(constrainedZone.actual)} / ${format(constrainedZone.maximum)}).`] : ["Actual atau max capacity zona belum tersedia."],
    counterEvidence: constrainedZone && (constrainedZone.utilization ?? 100) < 85 ? ["Seluruh zona yang tersedia masih di bawah warning envelope 85%."] : [],
    missingEvidence: ["H+3 projection per zona", "Slot/staging queue", "Overflow capacity yang benar-benar tersedia"],
    recommendedAction: constrainedZone && (constrainedZone.utilization ?? 0) >= 85
      ? `Aktifkan projection dan overflow playbook ${constrainedZone.zone}; jangan menambah volume sebelum headroom kembali aman.`
      : "Pertahankan zonal warning dan validasi max capacity setiap perubahan layout.",
    linkedPainIds: painIds("capacity"),
  });

  const rts = economics.servedQty;
  const hub = raw("outbound_actual_hub");
  const dispatch = value("on_time_dispatch");
  const arrival = value("on_time_arrival");
  const downstreamLoss = rts !== null && hub !== null ? Math.max(0, rts - hub) : null;
  const fleetState: CausalChain["state"] = rts === null || hub === null ? "blocked" : downstreamLoss !== null && downstreamLoss > 0 ? "verified" : "hypothesis";
  chains.push({
    id: "warehouse-fleet-hub",
    priorityScore: Math.round(clamp(25 + (downstreamLoss !== null && rts ? downstreamLoss / rts * 300 : 0) + Math.max(0, 95 - (dispatch ?? 95)) * 1.5)),
    title: "RTS → dispatch → arrival → hub received",
    domain: "Warehouse + Fleet",
    state: fleetState,
    confidence: fleetState === "verified" ? "high" : fleetState === "blocked" ? "low" : "medium",
    cause: "Barang yang selesai di warehouse masih dapat kehilangan service pada handoff dan perjalanan fleet.",
    mechanism: ["RTS menandai completion warehouse", "Dispatch/departure menandai kesiapan fleet", "Hub received menutup service downstream"],
    outcome: "Gap downstream tidak boleh otomatis dibebankan ke productivity atau fulfillment warehouse.",
    evidence: [`RTS ${format(rts)}; hub received ${format(hub)}; gap ${format(downstreamLoss)}.`, `On-time dispatch ${format(dispatch, "%")}; arrival ${format(arrival, "%")}.`],
    counterEvidence: downstreamLoss === 0 ? ["Tidak ada gap kuantitas antara RTS dan hub pada window ini."] : [],
    missingEvidence: ["Delay ownership per route", "Cut-off departure", "Exception/fleet adjustment reason"],
    recommendedAction: "Pisahkan owner delay warehouse vs fleet per route dan ukur recovery dari dispatch sampai hub received.",
    linkedPainIds: painIds("fleet"),
  });

  const wastage = raw("total_wastage");
  const gmv = raw("gmv");
  if (wastage !== null || gmv !== null) {
    const wastageRate = wastage !== null && gmv !== null && gmv > 0 ? wastage / gmv * 100 : null;
    chains.push({
      id: "quality-wastage-value",
      priorityScore: Math.round(clamp(20 + (wastageRate ?? 0) * 20)),
      title: "Quality loss → wastage → GMV exposure",
      domain: "Quality + Cost",
      state: wastageRate === null ? "blocked" : "verified",
      confidence: wastageRate === null ? "low" : "high",
      cause: "Handling, expired, inbound-to-bad, dan penyebab lain mengubah loss operasional menjadi nilai bisnis.",
      mechanism: ["QC/QM mengidentifikasi sumber loss", "Qty/value wastage membentuk exposure", "% to GMV menormalkan materialitas terhadap skala bisnis"],
      outcome: "Prioritas quality dapat dinilai dari nilai dan run-rate, bukan hanya jumlah kasus.",
      evidence: [`Total wastage ${format(wastage)}; GMV ${format(gmv)}; rasio ${format(wastageRate, "%")}.`],
      counterEvidence: [],
      missingEvidence: wastageRate === null ? ["Denominator GMV terverifikasi", "Wastage by cause dan value"] : ["Wastage by cause dan owner"],
      recommendedAction: "Pisahkan handling, expired, inbound-to-bad, dan others; prioritaskan Pareto value dengan guardrail % to GMV.",
      linkedPainIds: [],
    });
  }

  const stateRank: Record<CausalChain["state"], number> = { verified: 4, supported: 3, hypothesis: 2, blocked: 1 };
  return chains.sort((a, b) => b.priorityScore - a.priorityScore || stateRank[b.state] - stateRank[a.state]).slice(0, 7);
}

export function buildAnalysis(
  dataset: OperationalDataset,
  warehouse: string,
  period: Period,
  options: { division?: string; role?: string; asOf?: string; startDate?: string; endDate?: string } = {},
): AnalysisPayload {
  const warehousePoints = dataset.points.filter((point) => point.warehouse === warehouse);
  if (!warehousePoints.length) throw new Error(`Data warehouse ${warehouse} tidak ditemukan pada sumber.`);
  const validDates = [...new Set(warehousePoints.filter((point) => point.quality === "valid").map((point) => point.date))].sort();
  const hasCustomRange = Boolean(options.startDate || options.endDate || period === "custom");
  if (hasCustomRange && (!options.startDate || !options.endDate)) throw new Error("Rentang kustom membutuhkan tanggal mulai dan tanggal akhir.");
  if (options.startDate && options.endDate && options.startDate > options.endDate) throw new Error("Tanggal mulai tidak boleh melewati tanggal akhir.");
  const effectivePeriod: Period = options.startDate && options.endDate ? "custom" : period;
  const asOf = options.endDate ?? (options.asOf && validDates.includes(options.asOf) ? options.asOf : latestOperationalDate(warehousePoints, validDates));
  if (!asOf) throw new Error(`Tidak ada tanggal valid untuk ${warehouse}.`);
  if (asOf > (validDates.at(-1) ?? asOf)) throw new Error("Tanggal akhir melewati data aktual terakhir.");
  const { current, previous } = windows(asOf, effectivePeriod, options.startDate);
  if (current.days > 180) throw new Error("Rentang analisis maksimum 180 hari agar dashboard tetap responsif dan perbandingan tetap relevan.");
  const division = options.division && options.division !== "All" ? options.division : "All";
  const role = options.role && options.role !== "All" ? options.role : "All";
  const kpis = KPI_KEYS.map((key) => reading(warehousePoints, key, current, previous));
  const health = healthFrom(kpis);
  const confidence = Math.round(kpis.reduce((sum, item) => sum + item.coverage, 0) / kpis.length * 100);
  const weakest = [...kpis].filter((item) => item.value !== null).sort((a, b) => scoreMetric(a.key, a.value) - scoreMetric(b.key, b.value)).slice(0, 2);
  const pains = painAnalysis(warehousePoints, dataset.highlights, warehouse, asOf);
  const noOpsDates = noOperationDates(warehousePoints);
  const noOpsInWindow = [...noOpsDates].filter((date) => date >= shiftIso(asOf, -83) && date <= asOf);
  const dataWarnings: string[] = [];
  if (dataset.diagnostics.formulaErrors > 0) dataWarnings.push(`${dataset.diagnostics.formulaErrors.toLocaleString("id-ID")} sel sumber mengandung formula error dan dikeluarkan dari perhitungan.`);
  if (confidence < 75) dataWarnings.push(`Coverage KPI periode ini ${confidence}%; hasil ber-confidence rendah perlu divalidasi.`);
  if (health.pillarsAvailable < health.pillarsTotal) dataWarnings.push(`${health.pillarsTotal - health.pillarsAvailable} dari ${health.pillarsTotal} pilar KPI tidak memiliki data pada window ini; skor kesehatan dihitung atas basket yang lebih kecil dan tidak setara dengan warehouse yang datanya lengkap.`);
  if (noOpsInWindow.length > 0) dataWarnings.push(`${noOpsInWindow.length} hari tanpa operasi (volume outbound nol) dikeluarkan dari analisis hubungan: ${noOpsInWindow.slice(0, 5).join(", ")}${noOpsInWindow.length > 5 ? ", …" : ""}.`);
  if (dataset.diagnostics.futureCells > 0) dataWarnings.push("Tanggal masa depan diperlakukan sebagai plan, bukan actual performance.");

  // A metric that used to be reported and then stopped is an operational reporting
  // failure; a metric that was never tracked is a scope decision. Both used to
  // render as an identical blank cell, so a regression could pass unnoticed.
  const historical = new Set(warehousePoints.filter((point) => point.quality === "valid" && point.value !== null).flatMap((point) => metricAliasKeys(point.metric)));
  const stalled = kpis.filter((kpi) => kpi.value === null).filter((kpi) => derived(warehousePoints, kpi.key, { start: "0000-01-01", end: asOf, days: 1 }).value !== null || historical.has(kpi.key));
  if (stalled.length) dataWarnings.push(`Metrik berikut pernah dilaporkan tetapi kosong pada window aktif—kemungkinan kemunduran pelaporan, bukan metrik yang memang tidak dilacak: ${stalled.map((item) => item.label).join(", ")}.`);

  // The source computes its own forecast accuracy. Comparing it against the engine's
  // derivation turns a silent divergence into a visible warning.
  for (const [derivedKey, sourceKey, label] of [["forecast_accuracy", "source_outbound_forecast_accuracy", "Forecast accuracy outbound"], ["inbound_forecast_accuracy", "source_inbound_forecast_accuracy", "Forecast accuracy inbound"]] as const) {
    const ours = normalizePercent(derivedKey, derived(warehousePoints, derivedKey, current).value);
    const theirs = normalizePercent(sourceKey, metricValue(warehousePoints, sourceKey, current).value);
    if (ours === null || theirs === null) continue;
    if (Math.abs(ours - theirs) > 2) dataWarnings.push(`${label}: hasil mesin ${ours.toFixed(1)}% berbeda ${Math.abs(ours - theirs).toFixed(1)} pp dari kolom hitungan sumber (${theirs.toFixed(1)}%). Rekonsiliasi definisi diperlukan.`);
  }
  if (!warehousePoints.some((point) => normalizeLabel(point.metric).includes("forecast") && normalizeLabel(point.metric).includes("relabel"))) dataWarnings.push("Forecast pcs relabel tidak tersedia; productivity relabel tidak boleh dinilai sebagai forecast attainment.");
  if (!warehousePoints.some((point) => normalizeLabel(point.role).includes("troubleshoot") && normalizeLabel(point.metric).includes("manday"))) dataWarnings.push("Mandays troubleshooter tidak tersedia; FR troubleshoot dapat dimonitor, tetapi dampak manpower belum dapat dibuktikan.");

  const divisions = [...new Set(warehousePoints.map((point) => canonicalDivision(point.division)).filter(Boolean))].sort();
  const rolesByDivision: Record<string, string[]> = { All: [...new Set(warehousePoints.map((point) => point.role).filter(Boolean))].sort() };
  for (const item of divisions) rolesByDivision[item] = [...new Set(warehousePoints.filter((point) => canonicalDivision(point.division) === item).map((point) => point.role).filter(Boolean))].sort();
  const modules = functionalModules(warehousePoints, current, previous);
  const zones = capacityZones(warehousePoints, current);
  for (const zone of zones) if (zone.note) dataWarnings.push(`Zona ${zone.zone}: ${zone.note}`);
  const relationships = relationshipSignals(warehousePoints, asOf, noOpsDates);
  const economics = operationsEconomics(warehousePoints, current, previous, kpis, zones);
  const chains = causalChains(warehousePoints, current, kpis, zones, relationships, economics, pains);
  const semanticCatalog = metricSemanticCatalog(warehousePoints, current);
  const intelligence = intelligenceSummary(semanticCatalog);
  const chartWindow = visualWindow(current, effectivePeriod);
  const sync = dataset.sync ?? {
    provider: dataset.sourceMode,
    state: dataset.sourceMode === "snapshot" ? "fallback" as const : "live" as const,
    lastAttemptAt: dataset.fetchedAt,
    lastSuccessAt: dataset.fetchedAt,
    latencyMs: null,
    attempts: 1,
    rangesLoaded: 0,
    cacheExpiresAt: null,
    staleAfterSeconds: 86_400,
    isStale: false,
    message: "Metadata sinkron belum tersedia pada dataset ini.",
  };
  const activeTrendKeys = division === "All" ? ["forecast_accuracy", "productivity_attainment", "demand_fill_rate", "capacity_utilization", "cancel_rate", "dcc_accuracy"]
    : MODULES.find((module) => module.division === division)?.keys.slice(0, 6) ?? ["forecast_accuracy", "productivity_attainment"];

  return {
    context: {
      warehouse,
      period: effectivePeriod,
      division,
      role,
      asOf,
      rangeStart: current.start,
      rangeEnd: current.end,
      comparisonStart: previous.start,
      comparisonEnd: previous.end,
      timezone: "Asia/Jakarta",
      sourceMode: dataset.sourceMode,
      sourceName: dataset.sourceName,
      fetchedAt: dataset.fetchedAt,
      sync,
    },
    health: {
      score: health.score,
      status: health.status,
      headline: health.pillarsAvailable < 3
        ? "Data window belum cukup"
        : health.status === "critical" ? "Intervensi lintas fungsi diperlukan"
        : health.criticalKpis.length ? `Skor agregat sehat, tetapi ${health.criticalKpis.length} KPI menembus guardrail`
        : health.status === "watch" ? "Operasi belum stabil" : "Operasi dalam kendali",
      narrative: weakest.length ? `${weakest.map((item) => item.label).join(" dan ")} menjadi pressure point utama. Baca bersama volume, mandays, SLA, dan capacity—jangan mengoptimalkan satu KPI secara terpisah.` : "Data belum cukup untuk menentukan pressure point; sistem tidak memberi status kritis tanpa evidence minimum.",
      confidence,
      dataWarnings,
      criticalKpis: health.criticalKpis,
      pillarsAvailable: health.pillarsAvailable,
      pillarsTotal: health.pillarsTotal,
    },
    kpis,
    trends: activeTrendKeys.map((key) => dailyTrend(warehousePoints, key, chartWindow)),
    drivers: driverSignals(kpis),
    decisionInsights: decisionInsights(kpis, zones, pains, relationships),
    causalChains: chains,
    painPoints: pains,
    initiatives: buildInitiatives(warehouse, pains, relationships, kpis, zones, economics, chains),
    filters: {
      warehouses: ["PGS", "SRG", "BIT", "STR"],
      divisions,
      rolesByDivision,
      availableDates: validDates.filter((date) => date <= asOf).slice(-180).reverse(),
      minimumDate: validDates[0],
      maximumDate: validDates.at(-1) ?? asOf,
    },
    functionalModules: modules,
    capacityZones: zones,
    capacityHistory: capacityHistory(warehousePoints, chartWindow),
    volumeFlow: volumeFlow(warehousePoints, chartWindow),
    fulfillmentFunnel: fulfillmentFunnel(warehousePoints, current),
    laborBalance: laborBalance(warehousePoints, chartWindow),
    relationshipSignals: relationships,
    riskMatrix: riskMatrix(warehousePoints, asOf),
    pivotRows: pivotMetrics(warehousePoints, current, previous, division, role),
    warehouseComparison: warehouseComparison(dataset, effectivePeriod, asOf, current.days),
    metricCatalog: semanticCatalog,
    intelligence,
    economics,
  };
}

export const __test = { shiftIso, windows, normalizePercent, scoreMetric, decayScore, healthFrom, noOperationDates, correlationPValue, KPI_KEYS };
