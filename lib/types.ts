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
  source: "kpi" | "highlight" | "hybrid";
  impactScore: number;
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
  priorityScore: number;
  owner: string;
  effort: "low" | "medium" | "high";
  horizonDays: number;
  linkedPainIds: string[];
  evidence: string[];
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
    /** Keys of every KPI currently breaching its guardrail. A non-empty list
     *  blocks the "controlled" status so a critical breach cannot be averaged away. */
    criticalKpis: string[];
    /** How many of the scored KPI pillars actually had data this window. */
    pillarsAvailable: number;
    pillarsTotal: number;
  };
  kpis: MetricReading[];
  trends: TrendSeries[];
  drivers: DriverSignal[];
  decisionInsights: DecisionInsight[];
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
  capacityHistory: CapacityHistoryPoint[];
  volumeFlow: VolumeFlowPoint[];
  fulfillmentFunnel: FlowStage[];
  laborBalance: LaborBalancePoint[];
  relationshipSignals: RelationshipSignal[];
  riskMatrix: RiskMatrix;
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
  /** Set when the reading is present but cannot be trusted, e.g. two zones
   *  reporting an identical actual. Null when the reading is clean. */
  note: string | null;
}

export interface CapacityHistoryPoint {
  date: string;
  ambient: number | null;
  chiller: number | null;
  frozen: number | null;
}

export interface VolumeFlowPoint {
  date: string;
  inboundForecast: number | null;
  inboundActual: number | null;
  outboundForecast: number | null;
  beforeCancel: number | null;
  afterCancel: number | null;
  rts: number | null;
  hubReceived: number | null;
}

export interface FlowStage {
  key: string;
  label: string;
  value: number | null;
  conversionPct: number | null;
  lossQty: number | null;
  status: "critical" | "watch" | "controlled" | "unavailable";
}

export interface LaborBalancePoint {
  date: string;
  budgetMandays: number | null;
  actualMandays: number | null;
  productivity: number | null;
  fulfillment: number | null;
  cancelRate: number | null;
}

export interface RelationshipSignal {
  id: string;
  driverKey: string;
  driverLabel: string;
  outcomeKey: string;
  outcomeLabel: string;
  driverDomain: string;
  outcomeDomain: string;
  coefficient: number | null;
  /** Two-sided p-value for the correlation. Confidence is derived from this
   *  together with the sample size, not from the sample size alone. */
  pValue: number | null;
  /** True when p clears the Bonferroni threshold for the whole hypothesis set. */
  survivesMultiplicity: boolean;
  sampleSize: number;
  lagDays: number;
  strength: "strong" | "moderate" | "weak" | "insufficient";
  confidence: "high" | "medium" | "low";
  alignment: "supports" | "contradicts" | "inconclusive";
  /** Names the variable that appears on both sides of the pair. When set, the
   *  correlation is partly an algebraic identity and cannot evidence a mechanism. */
  sharedTerm: string | null;
  narrative: string;
  decision: string;
}

export interface RiskMatrix {
  weeks: string[];
  rows: Array<{
    domain: string;
    values: Array<number | null>;
    currentRisk: number | null;
  }>;
}

export interface DecisionInsight {
  id: string;
  priority: "critical" | "high" | "medium";
  domain: string;
  title: string;
  observation: string;
  implication: string;
  recommendedAction: string;
  evidence: string[];
  confidence: "high" | "medium" | "low";
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
  /** Computed by the same function as AnalysisPayload.health.score, over the
   *  same KPI basket, on the shared cut-off date. The two can no longer diverge. */
  healthScore: number;
  status: "critical" | "watch" | "controlled";
  asOf: string | null;
  forecastAccuracy: number | null;
  productivity: number | null;
  fulfillment: number | null;
  demandFillRate: number | null;
  cancelRate: number | null;
  dataConfidence: number;
  pillarsAvailable: number;
  pillarsTotal: number;
  /** False when this warehouse is missing pillars the others report, so its
   *  rank is not like-for-like. */
  comparable: boolean;
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
