export const PRIORITY_WAREHOUSES = ["PGS", "SRG", "BIT", "STR"] as const;

export type WarehouseCode = (typeof PRIORITY_WAREHOUSES)[number];
export type Period = "daily" | "weekly" | "monthly" | "custom";
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
  sync?: DataSyncMetadata;
}

export interface DataSyncMetadata {
  provider: "google" | "workbook" | "snapshot";
  state: "live" | "cached" | "fallback";
  lastAttemptAt: string;
  lastSuccessAt: string;
  latencyMs: number | null;
  attempts: number;
  rangesLoaded: number;
  cellsLoaded: number;
  revision: string | null;
  cacheExpiresAt: string | null;
  staleAfterSeconds: number;
  isStale: boolean;
  message: string;
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
  valueLens: "service" | "cost" | "capacity" | "quality" | "speed";
  successGate: string;
  stopLoss: string;
  priorityBreakdown: {
    impact: number;
    recurrence: number;
    evidence: number;
    feasibility: number;
  };
  /** Deterministic playbook branch selected from the current operating state. */
  adaptiveVariant: string;
  /** Exact current-state reason this initiative was selected for this warehouse. */
  whyNow: string;
  /** Observable condition that starts the playbook rather than a generic calendar date. */
  trigger: string;
  linkedChainIds: string[];
  /** Role in the portfolio prevents four initiatives from trying to solve the
   *  same symptom at the same time. */
  portfolioRole: "contain" | "recover" | "optimize" | "validate";
  /** The operational question the pilot must answer before it is scaled. */
  decisionQuestion: string;
  /** Observable result that would disprove the working mechanism. */
  counterfactual: string;
  /** Early signals used before the lagging success gate is available. */
  leadingIndicators: string[];
  /** Floor stations this action is actually executed at. */
  linkedStationIds: string[];
  /** The size of the prize, computed from the active window rather than asserted. */
  quantified: Array<{ label: string; value: string; note: string }>;
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
    comparisonStart: string;
    comparisonEnd: string;
    timezone: "Asia/Jakarta";
    sourceMode: OperationalDataset["sourceMode"];
    sourceName: string;
    fetchedAt: string;
    operationalLagDays: number;
    sync: DataSyncMetadata;
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
  operatingPicture: OperatingPicture;
  operationalThreads: OperationalThread[];
  floorStations: FloorStation[];
  floorBriefing: FloorBriefing;
  statistics: OperationsStatistics;
  knowledgeBase: KnowledgeArticle[];
  contextGaps: DecisionCoverageGap[];
  causalChains: CausalChain[];
  painPoints: PainPoint[];
  initiatives: Initiative[];
  filters: {
    warehouses: string[];
    divisions: string[];
    rolesByDivision: Record<string, string[]>;
    availableDates: string[];
    minimumDate: string;
    maximumDate: string;
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
  metricCatalog: OperationalMetricSemantic[];
  intelligence: IntelligenceSummary;
  economics: OperationsEconomics;
}

export type EvidenceState = "verified" | "supported" | "hypothesis" | "blocked";

export interface CausalChain {
  id: string;
  priorityScore: number;
  title: string;
  domain: string;
  state: EvidenceState;
  confidence: "high" | "medium" | "low";
  cause: string;
  mechanism: string[];
  outcome: string;
  evidence: string[];
  counterEvidence: string[];
  missingEvidence: string[];
  recommendedAction: string;
  linkedPainIds: string[];
}

export type MetricFamily = "people" | "volume" | "capacity" | "productivity" | "service" | "inventory-quality" | "cost" | "fleet" | "other";
export type MetricDecisionRole = "outcome" | "driver" | "guardrail" | "context";
export type MetricReadiness = "decision_ready" | "diagnostic_only" | "observational" | "unconfirmed";
export type DefinitionStatus = "documented" | "inferred" | "unresolved";

export interface OperationalMetricSemantic {
  id: string;
  division: string;
  role: string;
  remarks: string;
  metric: string;
  detail: string;
  family: MetricFamily;
  decisionRole: MetricDecisionRole;
  readiness: MetricReadiness;
  polarity: "higher_better" | "lower_better" | "neutral";
  definition: string;
  definitionStatus: DefinitionStatus;
  definitionConfidence: "high" | "medium" | "low";
  inferenceBasis: string | null;
  requiredContext: string[];
  decisionUse: string;
  caveat: string | null;
  glossaryNotes: string | null;
  relatedMetrics: string[];
  activeCoverage: number;
  mappedKeyCount: number;
}

export interface OperatingRule {
  id: string;
  title: string;
  principle: string;
  decisionGuardrail: string;
}

export interface IntelligenceSummary {
  sourceMetrics: number;
  activeMetrics: number;
  decisionReadyMetrics: number;
  diagnosticMetrics: number;
  observationalMetrics: number;
  unconfirmedMetrics: number;
  semanticCoveragePct: number;
  documentedDefinitions: number;
  inferredDefinitions: number;
  unresolvedDefinitions: number;
  domains: Array<{
    domain: string;
    totalMetrics: number;
    activeMetrics: number;
    decisionReadyMetrics: number;
    activeCoveragePct: number;
  }>;
  operatingRules: OperatingRule[];
}

export type OperatingMode = "demand_suppression" | "surge_undercoverage" | "capacity_constrained" | "inventory_drag" | "volume_dilution" | "process_loss" | "balanced" | "insufficient";

export interface OperatingPicture {
  mode: OperatingMode;
  label: string;
  confidence: "high" | "medium" | "low";
  headline: string;
  situation: string;
  primaryConstraint: string;
  secondaryConstraints: string[];
  signature: string[];
  verifiedFacts: string[];
  plausibleMechanisms: string[];
  alternativeExplanations: string[];
  decisionSequence: Array<{
    phase: "contain" | "diagnose" | "optimize" | "validate";
    owner: string;
    action: string;
    exitGate: string;
  }>;
  evidenceBoundary: string;
}

export interface OperationalThreadStage {
  id: string;
  label: string;
  domain: string;
  state: "observed" | "constrained" | "partial" | "missing" | "unconfirmed";
  reading: string;
  metricKeys: string[];
}

export interface OperationalThread {
  id: string;
  title: string;
  objective: string;
  state: "connected" | "constrained" | "partial" | "blocked";
  coveragePct: number;
  narrative: string;
  decisionUse: string;
  stages: OperationalThreadStage[];
}

export interface DecisionCoverageGap {
  id: string;
  priority: "critical" | "high" | "medium" | "low";
  kind: "definition" | "measurement" | "denominator" | "ownership" | "cross_process";
  domain: string;
  title: string;
  whyItMatters: string;
  observedContext: string[];
  requiredEvidence: string[];
  decisionUnlocked: string;
  owner: string;
}

export interface OperationsEconomics {
  verdict: "validated_saving" | "false_economy" | "undercoverage" | "process_loss" | "balanced" | "insufficient";
  headline: string;
  narrative: string;
  requestedQty: number | null;
  servedQty: number | null;
  cancelledQty: number | null;
  executionLossQty: number | null;
  downstreamLossQty: number | null;
  unservedDemandQty: number | null;
  budgetMandays: number | null;
  actualMandays: number | null;
  mandaysDelta: number | null;
  costToServeMdPerThousand: number | null;
  previousCostToServeMdPerThousand: number | null;
  costToServeDeltaPct: number | null;
  serviceAdjustedProductivity: number | null;
  capacityHeadroomPct: number | null;
  evidence: string[];
  guardrails: string[];
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

/* ---------------------------------------------------------------------------
   Floor layer — the physical stations between a vendor truck and a hub receipt.
   The KPI layer above answers "is the warehouse healthy". This layer answers
   "which bench, lane, or desk is producing that number, and what would a
   supervisor look at when standing in front of it".
--------------------------------------------------------------------------- */

export type FloorStationState = "controlled" | "pressured" | "breached" | "partial" | "unmeasured";

export interface FloorSignal {
  key: string;
  label: string;
  value: number | null;
  target: number | null;
  unit: MetricReading["unit"];
  severity: Severity;
  coverage: number;
  /** How to read this number while standing at the station, not its formula. */
  floorNote: string;
}

export interface FloorFailureMode {
  id: string;
  title: string;
  /** What it looks like on the floor before any report is opened. */
  floorSymptom: string;
  /** The shape it takes in the source sheet. */
  dataSignature: string;
  rootCauses: string[];
  /** Action that fits inside the running shift. */
  containment: string;
  /** Action that removes the cause, for the next shift or the next week. */
  correction: string;
  owner: string;
  /** True when the current window's numbers satisfy this mode's trigger. */
  active: boolean;
  /** The numeric condition, stated so it can be argued with. */
  trigger: string;
  /** Resolved figures behind `active`; empty when the mode is dormant. */
  evidence: string[];
}

export type FloorStage = "Perencanaan" | "Inbound" | "Inventory" | "Outbound" | "Dispatch" | "Mutu";

export interface FloorStation {
  id: string;
  sequence: number;
  stage: FloorStage;
  title: string;
  /** Where this sits in the working day. Protocol, not a measured timestamp. */
  shiftMoment: string;
  owner: string;
  purpose: string;
  /** The WMS transactions the station actually executes, in order. */
  wmsSteps: string[];
  /** What to inspect physically. Written to be usable while walking. */
  gembaChecks: string[];
  /** What breaks at the handover into the next station. */
  handoffRisk: string;
  score: number | null;
  state: FloorStationState;
  reading: string;
  signals: FloorSignal[];
  failureModes: FloorFailureMode[];
  /** What this station cannot prove from the source yet. */
  unmeasured: string[];
}

export interface FloorBriefing {
  /** Station carrying the tightest constraint in the active window. */
  constraintStationId: string | null;
  headline: string;
  narrative: string;
  breachedCount: number;
  pressuredCount: number;
  unmeasuredCount: number;
  measuredStations: number;
  totalStations: number;
  /** Ordered walk for this shift: which bench to stand at, and why. */
  walkOrder: Array<{ stationId: string; title: string; reason: string; action: string }>;
}

/* ---------------------------------------------------------------------------
   Operational statistics. Definitions live in lib/analysis/operations-math.ts;
   these are the shapes the payload carries.
--------------------------------------------------------------------------- */

export interface OperationsStatistics {
  outboundForecast: import("@/lib/analysis/operations-math").ForecastQuality;
  inboundForecast: import("@/lib/analysis/operations-math").ForecastQuality;
  demandVariability: import("@/lib/analysis/operations-math").Variability;
  controlCharts: import("@/lib/analysis/operations-math").ControlChart[];
  proportions: import("@/lib/analysis/operations-math").ProportionEstimate[];
  manpower: import("@/lib/analysis/operations-math").ManpowerRequirement[];
  yieldChain: import("@/lib/analysis/operations-math").YieldStage[];
  /** Plain-language reading of the four questions the math answers. */
  readouts: Array<{ id: string; question: string; answer: string; method: string; caveat: string | null }>;
}

export interface KnowledgeArticle {
  id: string;
  group: "Proses" | "Rumus" | "Aturan";
  domain: string;
  title: string;
  /** One sentence a new supervisor can act on. */
  summary: string;
  body: string[];
  /** Stated formula, when the article defines a number. */
  formula: string | null;
  /** Where the threshold or definition comes from. */
  basis: string | null;
  relatedStationIds: string[];
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
  demandFillChange: number;
  utilizationChange: number;
  mandaysGapChange: number;
  notes: string[];
}
