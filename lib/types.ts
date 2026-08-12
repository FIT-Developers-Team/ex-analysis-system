export const PRIORITY_WAREHOUSES = ["PGS", "SRG", "BIT", "STR"] as const;

export type WarehouseCode = (typeof PRIORITY_WAREHOUSES)[number];
export type Period = "daily" | "weekly" | "monthly";
export type TrendDirection = "up" | "down" | "flat";
export type Severity = "critical" | "watch" | "good" | "neutral";
export type AggregationMode = "sum" | "average" | "latest" | "max";

export interface MetricPoint {
  warehouse: string;
  date: string;
  division: string;
  role: string;
  remarks: string;
  metric: string;
  detail: string;
  source: string;
  value: number | null;
  quality: "valid" | "blank" | "formula_error" | "future";
}

export interface HighlightRecord {
  date: string | null;
  warehouse: string;
  metric: string;
  issue: string;
  actionPlan: string;
}

export interface OperationalDataset {
  sourceMode: "google" | "workbook" | "snapshot";
  sourceName: string;
  fetchedAt: string;
  points: MetricPoint[];
  highlights: HighlightRecord[];
  diagnostics: {
    totalCells: number;
    validCells: number;
    blankCells: number;
    formulaErrors: number;
    futureCells: number;
    latestCompleteDate: string | null;
  };
}

export interface MetricReading {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  deltaPct: number | null;
  target: number | null;
  unit: "qty" | "percent" | "ratio" | "mandays" | "currency" | "score";
  severity: Severity;
  trend: TrendDirection;
  coverage: number;
  interpretation: string;
}

export interface TrendSeries {
  key: string;
  label: string;
  unit: MetricReading["unit"];
  values: Array<{ date: string; value: number | null }>;
}

export interface DriverSignal {
  label: string;
  score: number;
  direction: "positive" | "negative" | "mixed";
  evidence: string;
}

export interface PainPoint {
  id: string;
  warehouse: string;
  title: string;
  domain: string;
  recurrenceWeeks: number;
  severity: "high" | "medium";
  confidence: "high" | "medium" | "low";
  evidence: string[];
  hypothesis: string;
}

export interface Initiative {
  id: string;
  warehouse: string;
  title: string;
  type: "stabilize" | "optimize" | "validate";
  problem: string;
  intervention: string;
  expectedImpact: string;
  measurement: string[];
  first14Days: string[];
  confidence: "high" | "medium" | "low";
}

export interface AnalysisPayload {
  context: {
    warehouse: string;
    period: Period;
    division: string;
    role: string;
    asOf: string;
    rangeStart: string;
    rangeEnd: string;
    sourceMode: OperationalDataset["sourceMode"];
    sourceName: string;
    fetchedAt: string;
  };
  health: {
    score: number;
    status: "critical" | "watch" | "controlled";
    headline: string;
    narrative: string;
    confidence: number;
    dataWarnings: string[];
  };
  kpis: MetricReading[];
  trends: TrendSeries[];
  drivers: DriverSignal[];
  painPoints: PainPoint[];
  initiatives: Initiative[];
  filters: {
    warehouses: string[];
    divisions: string[];
    rolesByDivision: Record<string, string[]>;
    availableDates: string[];
  };
  functionalModules: FunctionalModule[];
  capacityZones: CapacityZone[];
  pivotRows: PivotMetricRow[];
  warehouseComparison: WarehouseComparisonRow[];
  metricCatalog: Array<{ division: string; role: string; metric: string; detail: string }>;
}

export interface FunctionalModule {
  division: string;
  score: number;
  status: "critical" | "watch" | "controlled" | "unavailable";
  headline: string;
  kpis: MetricReading[];
}

export interface CapacityZone {
  zone: "Ambient" | "Chiller" | "Frozen";
  actual: number | null;
  maximum: number | null;
  utilization: number | null;
  status: "critical" | "watch" | "controlled" | "unavailable";
}

export interface PivotMetricRow {
  id: string;
  division: string;
  role: string;
  metric: string;
  detail: string;
  source: string;
  aggregation: AggregationMode;
  unit: MetricReading["unit"];
  current: number | null;
  previous: number | null;
  deltaPct: number | null;
  coverage: number;
  movement: "improving" | "worsening" | "stable" | "unknown";
}

export interface WarehouseComparisonRow {
  warehouse: string;
  healthScore: number;
  forecastAccuracy: number | null;
  productivity: number | null;
  fulfillment: number | null;
  cancelRate: number | null;
  dataConfidence: number;
}

export interface SimulationInputs {
  forecastChange: number;
  attendanceChange: number;
  cancelChange: number;
  processGain: number;
}

export interface SimulationResult {
  productivityChange: number;
  slaChange: number;
  fulfillmentChange: number;
  utilizationChange: number;
  mandaysGapChange: number;
  notes: string[];
}
