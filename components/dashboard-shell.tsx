"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Database,
  FlaskConical,
  GitBranch,
  Info,
  LayoutDashboard,
  Lightbulb,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  TableProperties,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  CapacityHistoryChart,
  DriverChart,
  FulfillmentFunnelChart,
  HealthGauge,
  InitiativePriorityChart,
  LaborBalanceChart,
  RelationshipChart,
  RiskHeatmapChart,
  SimulationImpactChart,
  TrendChart,
  VolumeFlowChart,
  WarehouseComparisonChart,
} from "@/components/analysis-charts";
import { KpiCard } from "@/components/kpi-card";
import { OperationsFlow } from "@/components/operations-flow";
import { runSimulation } from "@/lib/analysis/simulation";
import type { AnalysisPayload, DecisionInsight, Period, SimulationInputs, WarehouseCode } from "@/lib/types";
import { PRIORITY_WAREHOUSES } from "@/lib/types";

type View = "overview" | "flow" | "relationships" | "simulation" | "initiatives" | "data";

const nav = [
  { id: "overview" as const, label: "Cockpit eksekutif", short: "Cockpit", icon: LayoutDashboard },
  { id: "flow" as const, label: "Demand & flow", short: "Flow", icon: TrendingUp },
  { id: "relationships" as const, label: "Lab hubungan", short: "Relasi", icon: GitBranch },
  { id: "simulation" as const, label: "Studio skenario", short: "Skenario", icon: FlaskConical },
  { id: "initiatives" as const, label: "Portofolio inisiatif", short: "Project", icon: Lightbulb },
  { id: "data" as const, label: "Registry metric", short: "Metric", icon: Database },
];

const periodLabels: Record<Period, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

function fmtDate(date: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00`));
}

function fmtSigned(value: number, suffix = "%") {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
}

function fmtMetric(value: number | null, unit: AnalysisPayload["pivotRows"][number]["unit"]) {
  if (value === null) return "—";
  if (unit === "percent") return `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
  if (unit === "currency") return new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return value.toLocaleString("id-ID", { maximumFractionDigits: unit === "ratio" ? 1 : 0 });
}

function FilterSelect({ label, value, onChange, children, disabled = false }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={`filter-select${disabled ? " is-disabled" : ""}`}>
      <span>{label}</span>
      <div><select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{children}</select><ChevronDown size={14} /></div>
    </label>
  );
}

function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="section-header">
      <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>
      {action}
    </div>
  );
}

function PageIntro({ eyebrow, title, description, meta }: { eyebrow: string; title: string; description: string; meta: string }) {
  return (
    <header className="page-intro">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      <span className="page-intro__meta"><CalendarDays size={14} />{meta}</span>
    </header>
  );
}

function Skeleton() {
  return <div className="loading-grid" aria-label="Memuat analisis"><div className="skeleton skeleton--hero" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton skeleton--wide" /></div>;
}

function InsightCard({ insight, index }: { insight: DecisionInsight; index: number }) {
  return (
    <article className={`insight-card insight-card--${insight.priority}`}>
      <header><span>0{index + 1}</span><div><small>{insight.domain}</small><h3>{insight.title}</h3></div><b>{insight.priority}</b></header>
      <p>{insight.observation}</p>
      <div className="insight-implication"><strong>Why it matters</strong><span>{insight.implication}</span></div>
      <div className="insight-action"><ArrowRight size={15} /><span>{insight.recommendedAction}</span></div>
      <footer><span>{insight.confidence} confidence</span><span>{insight.evidence.length} evidence points</span></footer>
    </article>
  );
}

function ExecutiveCockpit({ data, openInitiatives }: { data: AnalysisPayload; openInitiatives: () => void }) {
  // fulfillment_rate and demand_fill_rate sit side by side on purpose: the first is
  // measured after cancellation and the second before it, and the gap between them
  // is the share of demand that was dropped rather than served.
  const priority = data.kpis.filter((item) => ["forecast_accuracy", "productivity_attainment", "fulfillment_rate", "demand_fill_rate", "cancel_rate", "mandays_variance", "capacity_utilization"].includes(item.key));
  const breaching = data.kpis.filter((item) => data.health.criticalKpis.includes(item.key));
  return (
    <>
      <section className="intelligence-hero intelligence-hero--executive" aria-labelledby="cockpit-title">
        <div className="hero-copy">
          <span className={`status-label status-label--${data.health.status}`}><CircleDot size={13} />{data.health.headline}</span>
          <div className="hero-score-compact"><span>System health</span><strong>{data.health.score}</strong></div>
          <h1 id="cockpit-title">Sistem operasi {data.context.warehouse} <em>{data.health.status === "controlled" ? "terkendali" : "sedang tertekan"}</em></h1>
          <p>{data.health.narrative}</p>
          <div className="hero-meta"><span><CalendarDays size={14} />{fmtDate(data.context.rangeStart)} — {fmtDate(data.context.rangeEnd)}</span><span><Database size={14} />{data.health.confidence}% analytical confidence</span></div>
        </div>
        <div className="health-gauge"><HealthGauge score={data.health.score} /></div>
      </section>

      <div className="kpi-rail-header"><div><span>Guardrail utama</span><strong>Signal yang membentuk system health</strong></div><small>Geser untuk melihat seluruh KPI</small></div>
      <section className="kpi-strip" aria-label="KPI guardrail utama">{priority.map((metric) => <KpiCard key={metric.key} metric={metric} />)}</section>

      {breaching.length > 0 && (
        <section className="panel guardrail-banner">
          <AlertTriangle size={18} />
          <div>
            <strong>{breaching.length} KPI menembus guardrail</strong>
            <p>{breaching.map((item) => `${item.label} ${item.value === null ? "n/a" : `${item.value.toFixed(1)}%`} (target ${item.target}%)`).join(" · ")}. Selama masih ada breach, status tertinggi yang diizinkan adalah <em>watch</em>—skor agregat tidak boleh menutupinya.</p>
          </div>
        </section>
      )}

      <section className="section-block">
        <SectionHeader eyebrow="Decision brief" title="What the operating review should decide next" description="Prioritas dibentuk dari trade-off volume, mandays, SLA, capacity, cancel, dan inventory control—not a single KPI breach." />
        <div className="insight-grid">{data.decisionInsights.slice(0, 3).map((insight, index) => <InsightCard insight={insight} index={index} key={insight.id} />)}</div>
      </section>

      <section className="split-grid split-grid--wide-left">
        <div className="panel chart-panel">
          <SectionHeader eyebrow="8-week control surface" title="Risk migrates across functions" description="Health score dibalik menjadi risk: semakin merah, semakin besar pressure pada minggu tersebut." />
          <RiskHeatmapChart matrix={data.riskMatrix} />
          <div className="chart-legend"><span><i className="legend-low" />Controlled</span><span><i className="legend-watch" />Watch</span><span><i className="legend-high" />High risk</span></div>
        </div>
        <div className="panel">
          <SectionHeader eyebrow="Attention order" title="Current driver health" description="Skor di bawah 65 menjadi prioritas diagnostic." />
          <DriverChart drivers={data.drivers} />
        </div>
      </section>

      <section className="panel flow-panel">
        <SectionHeader eyebrow="Connected operations core" title="One flow, shared consequences" description="People dan planning menggerakkan inbound, inventory, outbound, dan fleet sebagai satu sistem." />
        <OperationsFlow modules={data.functionalModules} />
      </section>

      <section className="function-score-grid" aria-label="Functional operations health">
        {data.functionalModules.map((module) => (
          <article className={`function-score function-score--${module.status}`} key={module.division}>
            <div><span>{module.division}</span><strong>{module.status === "unavailable" ? "—" : module.score}</strong></div><p>{module.headline}</p><div className="function-score__bar"><i style={{ width: `${module.score}%` }} /></div>
          </article>
        ))}
      </section>

      <section className="split-grid">
        <div className="panel chart-panel">
          <SectionHeader eyebrow="28-day signal" title="Operating system movement" description="Gaps menandakan data belum tersedia atau invalid." />
          <TrendChart series={data.trends.slice(0, 4)} />
        </div>
        <div className="panel panel--ink portfolio-callout">
          <SectionHeader eyebrow="Highest-priority project" title={data.initiatives[0]?.title ?? "Validate operating baseline"} />
          <div className="portfolio-score"><strong>{data.initiatives[0]?.priorityScore ?? 0}</strong><span>priority<br/>score</span></div>
          <p>{data.initiatives[0]?.intervention}</p>
          <div className="impact-box"><Sparkles size={18} /><div><span>Expected impact</span><strong>{data.initiatives[0]?.expectedImpact}</strong></div></div>
          <button className="text-button" onClick={openInitiatives}>Open project portfolio <ChevronRight size={15} /></button>
        </div>
      </section>

      <section className="panel comparison-panel">
        <SectionHeader eyebrow="Network benchmark" title={`PGS · SRG · BIT · STR pada cut-off ${fmtDate(data.warehouseComparison.find((row) => row.asOf)?.asOf ?? data.context.asOf)}`} description="Skor dihitung fungsi yang sama dengan gauge cockpit, atas basket KPI dan tanggal yang sama. Baris bertanda ⚠ kekurangan pilar yang dilaporkan warehouse lain—peringkatnya tidak setara." />
        <div className="comparison-layout">
          <WarehouseComparisonChart rows={data.warehouseComparison} />
          <div className="comparison-scoreboard">{[...data.warehouseComparison].sort((a, b) => b.healthScore - a.healthScore).map((row, index) => <div key={row.warehouse}><span>#{index + 1}</span><strong>{row.warehouse}{row.comparable ? "" : " ⚠"}</strong><b>{row.healthScore}</b><small>{row.comparable ? `${row.dataConfidence}% coverage` : `${row.pillarsAvailable}/${row.pillarsTotal} pilar`}</small></div>)}</div>
        </div>
      </section>
    </>
  );
}

function FlowIntelligence({ data }: { data: AnalysisPayload }) {
  const [mode, setMode] = useState<"inbound" | "outbound">("outbound");
  return (
    <>
      <PageIntro eyebrow="Demand-to-service control" title="Ikuti setiap unit hingga layanan selesai" description="Bandingkan forecast, actual, cancel, RTS, hub received, labor, dan zonal capacity dalam satu aliran keputusan." meta={`${periodLabels[data.context.period]} · ${fmtDate(data.context.rangeStart)} — ${fmtDate(data.context.rangeEnd)}`} />
      <section className="panel chart-panel">
        <SectionHeader eyebrow="28-day volume truth" title={mode === "outbound" ? "Forecast → request → RTS → hub" : "Forecast → actual inbound"} description="Actual goods menjadi basis productivity; forecast dipakai sebagai planning reference." action={<div className="segmented-control"><button className={mode === "inbound" ? "active" : ""} onClick={() => setMode("inbound")}>Inbound</button><button className={mode === "outbound" ? "active" : ""} onClick={() => setMode("outbound")}>Outbound</button></div>} />
        <VolumeFlowChart points={data.volumeFlow} mode={mode} />
      </section>

      <section className="split-grid split-grid--wide-left">
        <div className="panel chart-panel">
          <SectionHeader eyebrow="Fulfillment loss tree" title="Where outbound volume falls away" description="Step conversion membedakan demand variance, cancel, warehouse execution, dan downstream receipt." />
          <FulfillmentFunnelChart stages={data.fulfillmentFunnel} />
          <div className="funnel-stage-strip">{data.fulfillmentFunnel.slice(1).map((stage) => <div key={stage.key}><span>{stage.label}</span><strong>{stage.conversionPct === null ? "—" : `${stage.conversionPct.toFixed(1)}%`}</strong><small>{stage.lossQty === null ? "No comparable stage" : `${stage.lossQty.toLocaleString("id-ID")} qty step loss`}</small></div>)}</div>
        </div>
        <div className="panel decision-sidebar">
          <SectionHeader eyebrow="Flow decisions" title="Act on the constraint" />
          {data.decisionInsights.filter((item) => ["Planning", "Outbound", "Labor economics"].includes(item.domain)).slice(0, 3).map((item) => <article key={item.id}><span>{item.domain}</span><strong>{item.title}</strong><p>{item.recommendedAction}</p></article>)}
          {!data.decisionInsights.some((item) => ["Planning", "Outbound", "Labor economics"].includes(item.domain)) && <div className="empty-state"><CheckCircle2 size={18} /><p>Tidak ada flow breach besar pada cut aktif. Pertahankan guardrail dan pantau perubahan harian.</p></div>}
        </div>
      </section>

      <section className="panel chart-panel">
        <SectionHeader eyebrow="Labor economics" title="Budget mandays, actual mandays, and output per manday" description="Actual MD di bawah budget hanya dianggap saving bila productivity dan SLA tetap sehat." />
        <LaborBalanceChart points={data.laborBalance} />
      </section>

      <section className="panel chart-panel">
        <SectionHeader eyebrow="Zonal capacity" title="Ambient, chiller, and frozen operating envelope" description="Warning 85% dan critical 92%; nilai harian tidak diisi secara artifisial saat source kosong." />
        <CapacityHistoryChart points={data.capacityHistory} />
        <div className="capacity-grid capacity-grid--attached">{data.capacityZones.map((zone) => <article className={`capacity-zone capacity-zone--${zone.status}`} key={zone.zone}><header><div><span>{zone.zone}</span><strong>{zone.utilization === null ? "—" : `${zone.utilization.toFixed(1)}%`}</strong></div><b>{zone.status}</b></header><div className="capacity-track"><i style={{ width: `${Math.min(100, zone.utilization ?? 0)}%` }} /></div><footer><span>Actual <b>{zone.actual?.toLocaleString("id-ID") ?? "—"}</b></span><span>Max <b>{zone.maximum?.toLocaleString("id-ID") ?? "—"}</b></span></footer>{zone.note && <p className="zone-note"><AlertTriangle size={13} />{zone.note}</p>}</article>)}</div>
      </section>
    </>
  );
}

function RelationshipLab({ data }: { data: AnalysisPayload }) {
  const [signalFilter, setSignalFilter] = useState<"all" | "actionable" | "validate">("all");
  const visibleSignals = data.relationshipSignals.filter((signal) => {
    const actionable = signal.survivesMultiplicity && !signal.sharedTerm && signal.alignment !== "inconclusive";
    if (signalFilter === "actionable") return actionable;
    if (signalFilter === "validate") return !actionable;
    return true;
  });
  return (
    <>
      <PageIntro eyebrow="Cross-functional diagnostic" title="Bedakan korelasi dari fakta operasional" description="Hubungan 84 hari dipakai sebagai signal untuk investigasi, bukan klaim kausal. Sample size, lag, confidence, dan arah hipotesis selalu terlihat." meta={`84-day lookback · as of ${fmtDate(data.context.asOf)}`} />
      <section className="split-grid split-grid--wide-left">
        <div className="panel chart-panel">
          <SectionHeader eyebrow="Association map" title="Which levers move with which outcomes" description="Koefisien Pearson r: biru mendukung arah hipotesis, emas berlawanan, abu-abu belum konklusif." />
          <RelationshipChart signals={data.relationshipSignals} />
        </div>
        <div className="panel relationship-notice">
          <Info size={20} />
          <div><strong>How to use this page</strong><p>Mulai dari hubungan moderate/strong dengan sample memadai. Validasi lewat shift, weekday, volume band, dan floor observation sebelum membuat kebijakan.</p></div>
          <div className="relationship-stats"><span><b>{data.relationshipSignals.filter((item) => item.survivesMultiplicity).length}</b> lolos koreksi</span><span><b>{data.relationshipSignals.filter((item) => item.sharedTerm).length}</b> confounded</span><span><b>{data.relationshipSignals.filter((item) => item.alignment === "inconclusive").length}</b> inconclusive</span></div>
        </div>
      </section>

      <section className="section-block relationship-evidence">
        <SectionHeader eyebrow="Evidence queue" title="Pilih signal yang siap ditindaklanjuti" description="Actionable telah lolos koreksi statistik dan tidak berbagi formula; Validate masih membutuhkan slicing atau observasi floor." action={<div className="segmented-control signal-filter" aria-label="Filter relationship signals"><button className={signalFilter === "all" ? "active" : ""} onClick={() => setSignalFilter("all")}>Semua</button><button className={signalFilter === "actionable" ? "active" : ""} onClick={() => setSignalFilter("actionable")}>Actionable</button><button className={signalFilter === "validate" ? "active" : ""} onClick={() => setSignalFilter("validate")}>Validate</button></div>} />
        <div className="relationship-card-grid">
        {visibleSignals.map((signal) => (
          <article className={`relationship-card relationship-card--${signal.alignment}`} key={signal.id}>
            <header><span>{signal.driverDomain} → {signal.outcomeDomain}</span><b>{signal.coefficient === null ? "n/a" : `r ${signal.coefficient.toFixed(2)}`}</b></header>
            <h3>{signal.driverLabel} → {signal.outcomeLabel}</h3><p>{signal.narrative}</p>
            {signal.sharedTerm && <p className="relationship-confound"><AlertTriangle size={13} />Confounded: kedua sisi berbagi {signal.sharedTerm}.</p>}
            <div><span>{signal.strength}</span><span>n {signal.sampleSize}</span><span>lag {signal.lagDays}d</span><span>p {signal.pValue === null ? "n/a" : signal.pValue < 0.0001 ? "<0,0001" : signal.pValue.toFixed(4)}</span><span>{signal.confidence} confidence</span></div>
            <footer><ArrowRight size={14} /><span>{signal.decision}</span></footer>
          </article>
        ))}
        {!visibleSignals.length && <div className="panel empty-state"><Info size={20} /><p>Tidak ada signal pada filter ini untuk cut-off aktif.</p></div>}
        </div>
      </section>

      <section className="section-block">
        <SectionHeader eyebrow="Recurring evidence" title="Historical pain that survives weekly review" description="Metric breach dan highlight Sheet disatukan; source dan impact score tetap transparan." />
        <div className="diagnostic-grid">
          {data.painPoints.length ? data.painPoints.map((pain, index) => <article className="diagnostic-card" key={pain.id}><div className="diagnostic-card__index">0{index + 1}</div><div className="diagnostic-card__body"><div className="tag-row"><span>{pain.domain}</span><span>{pain.recurrenceWeeks}/8 weeks</span><span>{pain.source} evidence</span><span>impact {pain.impactScore}</span></div><h3>{pain.title}</h3><p>{pain.hypothesis}</p><div className="evidence-box"><strong>Observed evidence</strong>{pain.evidence.map((item) => <span key={item}>{item}</span>)}</div></div></article>) : <div className="panel empty-state"><Info size={20} /><p>Belum ada recurrent breach yang memenuhi threshold. Sistem tetap mempertahankan validation initiative.</p></div>}
        </div>
      </section>

      <section className="panel">
        <SectionHeader eyebrow="Guardrail matrix" title="Trade-offs every review must protect" />
        <div className="guardrail-grid"><div><strong>Volume ↓, MP tetap</strong><span>Productivity dapat turun tanpa process failure.</span></div><div><strong>MP ↑</strong><span>SLA seharusnya membaik; output per manday dapat terdilusi.</span></div><div><strong>Actual MD &lt; budget</strong><span>Saving valid hanya bila SLA dan productivity sehat.</span></div><div><strong>Cancel ↑</strong><span>Harus dibuktikan dengan capacity, remaining hours, dan run-rate.</span></div><div><strong>DCC ↓</strong><span>Telusuri SLOC, replenish, troubleshoot, Pick-to-PF, lalu picker.</span></div><div><strong>Capacity ≥ 92%</strong><span>Tambahan volume atau MP berisiko congestion dan queue.</span></div></div>
      </section>
    </>
  );
}

function ScenarioStudio({ data }: { data: AnalysisPayload }) {
  const [inputs, setInputs] = useState<SimulationInputs>({ forecastChange: 0, attendanceChange: 0, cancelChange: 0, processGain: 0 });
  const find = (key: string, fallback: number) => data.kpis.find((item) => item.key === key)?.value ?? fallback;
  const baseline = { productivityAttainment: find("productivity_attainment", 90), sla: find("sla_checker_inbound", 95), fulfillment: find("fulfillment_rate", 97), utilization: find("capacity_utilization", 75), mandaysGap: find("mandays_variance", 0) };
  const result = runSimulation(baseline, inputs);
  const controls: Array<{ key: keyof SimulationInputs; label: string; hint: string; min: number; max: number }> = [
    { key: "forecastChange", label: "Actual volume vs baseline", hint: "Perubahan workload yang benar-benar masuk", min: -30, max: 35 },
    { key: "attendanceChange", label: "Attendance / actual mandays", hint: "Perubahan manpower tersedia", min: -20, max: 20 },
    { key: "cancelChange", label: "Cancel rate change", hint: "Negatif = request cancelled berkurang", min: -10, max: 10 },
    { key: "processGain", label: "Process efficiency gain", hint: "Perbaikan pickface, travel, rework, atau system", min: 0, max: 20 },
  ];
  return (
    <>
      <PageIntro eyebrow="Transparent what-if model" title="Uji keputusan sebelum berdampak ke floor" description="Simulator directional untuk melihat tarik-menarik volume, manpower, cancel, productivity, SLA, fulfillment, dan capacity." meta={`${data.context.warehouse} baseline · ${periodLabels[data.context.period]}`} />
      <section className="simulation-layout">
        <div className="panel controls-panel">
          <div className="simulation-baseline"><SlidersHorizontal size={18} /><div><strong>{data.context.warehouse} observed baseline</strong><span>Cut-off {fmtDate(data.context.asOf)}</span></div></div>
          {controls.map((control) => <label className="range-control" key={control.key}><div><span>{control.label}</span><output>{fmtSigned(inputs[control.key])}</output></div><p>{control.hint}</p><input type="range" min={control.min} max={control.max} step="1" value={inputs[control.key]} onChange={(event) => setInputs((current) => ({ ...current, [control.key]: Number(event.target.value) }))} /><div className="range-bounds"><span>{control.min}%</span><span>{control.max}%</span></div></label>)}
          <button className="secondary-button" onClick={() => setInputs({ forecastChange: 0, attendanceChange: 0, cancelChange: 0, processGain: 0 })}>Reset scenario</button>
        </div>
        <div className="panel chart-panel simulation-chart-panel">
          <SectionHeader eyebrow="Projected movement" title="Directional impact versus baseline" description="Positive/negative berarti perubahan poin terhadap baseline, bukan level absolut baru." />
          <SimulationImpactChart result={result} />
          <div className="model-notes model-notes--light"><strong>Model interpretation</strong>{result.notes.map((note) => <p key={note}><Info size={14} />{note}</p>)}</div>
        </div>
      </section>
      <section className="baseline-grid"><div><span>Productivity</span><strong>{baseline.productivityAttainment.toFixed(1)}%</strong></div><div><span>Inbound SLA</span><strong>{baseline.sla.toFixed(1)}%</strong></div><div><span>Fulfillment</span><strong>{baseline.fulfillment.toFixed(1)}%</strong></div><div><span>Peak capacity</span><strong>{baseline.utilization.toFixed(1)}%</strong></div><div><span>Mandays gap</span><strong>{fmtSigned(baseline.mandaysGap)}</strong></div></section>
      <section className="panel assumption-panel"><Target size={19} /><div><strong>Model mechanics and boundary</strong><p>Volume memengaruhi output per fixed manday; attendance menambah SLA buffer tetapi dapat menurunkan productivity; process gain menaikkan throughput; return dilunakkan saat capacity melewati 88%. Gunakan hasil untuk memilih pilot, bukan sebagai forecast finansial.</p></div></section>
    </>
  );
}

function InitiativePortfolio({ data }: { data: AnalysisPayload }) {
  return (
    <>
      <PageIntro eyebrow="Execution portfolio" title="Ubah pain berulang menjadi project terukur" description="Setiap project memiliki owner, effort, horizon, evidence, outcome, guardrail, dan langkah pertama—bukan sekadar generic recommendation." meta={`${data.initiatives.length} projects · ${data.context.warehouse}`} />
      <section className="portfolio-overview">
        <div className="panel chart-panel"><SectionHeader eyebrow="Priority vs effort" title="Fund the right work first" description="Ukuran titik menunjukkan horizon; garis 65 adalah action threshold." /><InitiativePriorityChart initiatives={data.initiatives} /></div>
        <div className="portfolio-summary">
          <article><Users size={17} /><span>Primary owners</span><strong>{new Set(data.initiatives.map((item) => item.owner)).size}</strong></article>
          <article><Target size={17} /><span>High-confidence</span><strong>{data.initiatives.filter((item) => item.confidence === "high").length}</strong></article>
          <article><CalendarDays size={17} /><span>Fastest horizon</span><strong>{Math.min(...data.initiatives.map((item) => item.horizonDays))}d</strong></article>
          <article><Sparkles size={17} /><span>Top priority</span><strong>{Math.max(...data.initiatives.map((item) => item.priorityScore))}</strong></article>
        </div>
      </section>
      <section className="initiative-grid">
        {data.initiatives.map((initiative, index) => (
          <article className="initiative-card" key={initiative.id}>
            <header><span className="initiative-number">0{index + 1}</span><div><div className="tag-row"><span>{initiative.type}</span><span>{initiative.confidence} confidence</span><span>priority {initiative.priorityScore}</span></div><h3>{initiative.title}</h3><div className="initiative-meta"><span><Users size={13} />{initiative.owner}</span><span><BarChart3 size={13} />{initiative.effort} effort</span><span><CalendarDays size={13} />{initiative.horizonDays} days</span></div></div></header>
            <div className="initiative-section"><span>Problem</span><p>{initiative.problem}</p></div><div className="initiative-section"><span>Intervention</span><p>{initiative.intervention}</p></div><div className="initiative-section initiative-section--impact"><span>Expected impact</span><p>{initiative.expectedImpact}</p></div>
            <div className="initiative-evidence"><strong>Evidence used</strong>{initiative.evidence.map((item) => <span key={item}>{item}</span>)}</div>
            <div className="initiative-columns"><div><strong>Measure & guardrail</strong>{initiative.measurement.map((item) => <p key={item}><CheckCircle2 size={13} />{item}</p>)}</div><div><strong>First 14 days</strong>{initiative.first14Days.map((item) => <p key={item}><ChevronRight size={13} />{item}</p>)}</div></div>
          </article>
        ))}
      </section>
    </>
  );
}

function MetricRegistry({ data }: { data: AnalysisPayload }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => data.pivotRows.filter((item) => `${item.division} ${item.role} ${item.metric} ${item.detail}`.toLowerCase().includes(query.toLowerCase())), [data.pivotRows, query]);
  return (
    <>
      <PageIntro eyebrow="Metric registry & QA" title="Telusuri setiap angka sampai konteks operasinya" description="Pivot mempertahankan function, role, metric, detail, aggregation, comparison window, coverage, dan movement direction." meta={`${data.pivotRows.length} metrics · ${data.metricCatalog.length} catalog entries`} />
      <section className="data-quality-strip"><div><span>Source</span><strong>{data.context.sourceName}</strong></div><div><span>Read mode</span><strong>{data.context.sourceMode === "google" ? "Google batch API" : data.context.sourceMode === "snapshot" ? "Optimized snapshot" : "Local workbook"}</strong></div><div><span>Latest actual</span><strong>{fmtDate(data.context.asOf)}</strong></div><div><span>Confidence</span><strong>{data.health.confidence}%</strong></div></section>
      {data.health.dataWarnings.length > 0 && <section className="warning-panel"><AlertTriangle size={20} /><div><strong>Quality guardrails active</strong>{data.health.dataWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div></section>}
      <section className="panel metric-panel">
        <div className="table-toolbar"><div><TableProperties size={17} /><span>Period pivot · current vs previous</span></div><div className="search-box"><Search size={17} /><input aria-label="Cari metric" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search metric, role, or function" /><span>{filtered.length}</span></div></div>
        <div className="metric-table" role="table" aria-label="Metric pivot"><div className="metric-row metric-row--pivot metric-row--head" role="row"><span>Function / role</span><span>Metric</span><span>Aggregation</span><span>Current</span><span>Previous</span><span>Delta</span><span>Coverage</span></div>{filtered.slice(0, 250).map((item) => <div className="metric-row metric-row--pivot" role="row" key={item.id}><span><b>{item.division}</b><small>{item.role}</small></span><strong title={item.detail}>{item.metric}</strong><span className="aggregation-pill">{item.aggregation}</span><b>{fmtMetric(item.current, item.unit)}</b><span>{fmtMetric(item.previous, item.unit)}</span><span className={`movement movement--${item.movement}`}>{item.deltaPct === null ? "—" : fmtSigned(item.deltaPct)}</span><span>{Math.round(item.coverage * 100)}%</span></div>)}</div>
        <div className="metric-mobile-list" aria-label="Daftar metric mobile">{filtered.slice(0, 80).map((item) => <article className="metric-mobile-card" key={item.id}><header><div><span>{item.division}</span><small>{item.role}</small></div><b>{fmtMetric(item.current, item.unit)}</b></header><h3>{item.metric}</h3><p>{item.detail}</p><footer><span>{item.aggregation}</span><span className={`movement movement--${item.movement}`}>{item.deltaPct === null ? "—" : fmtSigned(item.deltaPct)}</span><span>{Math.round(item.coverage * 100)}% coverage</span></footer></article>)}</div>
      </section>
    </>
  );
}

export function DashboardShell() {
  const [view, setView] = useState<View>("overview");
  const [warehouse, setWarehouse] = useState<WarehouseCode>("PGS");
  const [period, setPeriod] = useState<Period>("weekly");
  const [division, setDivision] = useState("All");
  const [role, setRole] = useState("All");
  const [asOf, setAsOf] = useState("");
  const [data, setData] = useState<AnalysisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const selectView = (nextView: View) => {
    setView(nextView);
    window.requestAnimationFrame(() => {
      workspaceRef.current?.focus();
    });
  };

  const refresh = useCallback(async (quiet = false, force = false) => {
    if (!quiet) setLoading(true);
    try {
      const query = new URLSearchParams({ warehouse, period, division, role });
      if (asOf) query.set("asOf", asOf);
      if (force) query.set("refresh", "1");
      const response = await fetch(`/api/analysis?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json() as AnalysisPayload & { error?: string; detail?: string; remediation?: string };
      if (!response.ok) throw new Error([payload.error, payload.detail, payload.remediation].filter(Boolean).join(" — "));
      setData(payload); setError(null); setLastRefresh(new Date());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gagal membaca source");
    } finally {
      setLoading(false);
    }
  }, [warehouse, period, division, role, asOf]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(true), 60_000);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, [refresh]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">Lewati ke analisis utama</a>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><BarChart3 size={19} /></div><div><strong>NEXUS</strong><span>Excellence Analysis</span></div></div>
        <nav aria-label="Workspace utama"><span className="nav-caption">Decision workspaces</span>{nav.map((item) => { const Icon = item.icon; return <button type="button" data-view={item.id} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} key={item.id} onClick={() => selectView(item.id)} title={item.label}><Icon size={18} /><span className="nav-label-long">{item.label}</span><span className="nav-label-short">{item.short}</span>{item.id === "initiatives" && data && <b>{data.initiatives.length}</b>}</button>; })}</nav>
        <div className="sidebar-status"><div className="live-dot" /><div><strong>Source monitor</strong><span>{error ? "Connection needs attention" : "Auto-refresh · 60 sec"}</span></div></div>
        <div className="sidebar-footer"><span>FIT Operations Intelligence</span><small>v0.3 · connected decision system</small></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="breadcrumb"><span>FIT Ops Intelligence</span><ChevronRight size={14} /><strong>{nav.find((item) => item.id === view)?.label}</strong></div><div className="topbar-actions"><div className={`source-chip source-chip--${error ? "error" : "live"}`}><Activity size={14} /><span>{data?.context.sourceMode === "google" ? "Google live" : data?.context.sourceMode === "snapshot" ? "Snapshot fast-path" : "Local source"}</span></div><button className="refresh-button" onClick={() => void refresh(false, true)} aria-label="Refresh source"><RefreshCw className={loading ? "spinning" : ""} size={16} /><span>Sync now</span></button></div></header>

        <div className="content-area">
          <div className="context-line"><span>{warehouse} · {periodLabels[period]} intelligence</span><span>{lastRefresh ? `Refreshed ${lastRefresh.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}` : "Connecting to source"}</span></div>
          <section className={`filter-console${filtersOpen ? " is-open" : ""}`} aria-label="Filter analisis">
            <div className="filter-console__title"><SlidersHorizontal size={18} /><div><strong>Ruang lingkup analisis</strong><span>Semua halaman memakai satu cut-off</span></div><div className="filter-summary" aria-label="Filter aktif"><span>{warehouse}</span><span>{periodLabels[period]}</span><span>{division === "All" ? "Semua fungsi" : division}</span></div><button type="button" className="filter-toggle" aria-expanded={filtersOpen} aria-controls="filter-console-body" onClick={() => setFiltersOpen((current) => !current)}>{filtersOpen ? "Tutup" : "Ubah"}<ChevronDown size={16} /></button></div>
            <div className="filter-console__body" id="filter-console-body">
              <div className="filter-console__fields">
              <FilterSelect label="Warehouse" value={warehouse} onChange={(value) => { setWarehouse(value as WarehouseCode); setDivision("All"); setRole("All"); setAsOf(""); }}>{PRIORITY_WAREHOUSES.map((item) => <option value={item} key={item}>{item}</option>)}</FilterSelect>
              <FilterSelect label="Function" value={division} onChange={(value) => { setDivision(value); setRole("All"); }}><option value="All">All functions</option>{(data?.filters.divisions ?? []).map((item) => <option value={item} key={item}>{item}</option>)}</FilterSelect>
              <FilterSelect label="Role" value={role} onChange={setRole} disabled={!data}><option value="All">All roles</option>{(data?.filters.rolesByDivision[division] ?? data?.filters.rolesByDivision.All ?? []).map((item) => <option value={item} key={item}>{item}</option>)}</FilterSelect>
              <FilterSelect label="Data cut-off" value={asOf} onChange={setAsOf} disabled={!data}><option value="">Latest actual</option>{(data?.filters.availableDates ?? []).map((item) => <option value={item} key={item}>{fmtDate(item)}</option>)}</FilterSelect>
              </div>
              <div className="period-control"><span>View</span><div className="period-switcher" aria-label="Period">{Object.entries(periodLabels).map(([key, label]) => <button type="button" className={period === key ? "active" : ""} aria-pressed={period === key} onClick={() => setPeriod(key as Period)} key={key}>{label}</button>)}</div></div>
            </div>
          </section>

          <div id="workspace-content" className="workspace-content" ref={workspaceRef} tabIndex={-1} aria-live="polite" aria-label={nav.find((item) => item.id === view)?.label}>
          {error ? <section className="source-error"><AlertTriangle size={24} /><div><h2>Live source belum terhubung</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw size={15} />Retry connection</button></div></section> : loading && !data ? <Skeleton /> : data ? <>
            {view === "overview" && <ExecutiveCockpit data={data} openInitiatives={() => selectView("initiatives")} />}
            {view === "flow" && <FlowIntelligence data={data} />}
            {view === "relationships" && <RelationshipLab data={data} />}
            {view === "simulation" && <ScenarioStudio data={data} />}
            {view === "initiatives" && <InitiativePortfolio data={data} />}
            {view === "data" && <MetricRegistry data={data} />}
          </> : <Skeleton />}
          </div>
        </div>
      </main>
    </div>
  );
}
