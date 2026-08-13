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
  PanelLeftClose,
  PanelLeftOpen,
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
  { id: "overview" as const, label: "Cockpit operasi", short: "Cockpit", icon: LayoutDashboard },
  { id: "flow" as const, label: "Alur demand", short: "Alur", icon: TrendingUp },
  { id: "relationships" as const, label: "Hubungan driver", short: "Driver", icon: GitBranch },
  { id: "simulation" as const, label: "Simulasi keputusan", short: "Simulasi", icon: FlaskConical },
  { id: "initiatives" as const, label: "Inisiatif prioritas", short: "Inisiatif", icon: Lightbulb },
  { id: "data" as const, label: "Data & kualitas", short: "Data", icon: Database },
];

const periodLabels: Record<Period, string> = { daily: "Harian", weekly: "Mingguan", monthly: "Bulanan", custom: "Kustom" };
const presetPeriods: Period[] = ["daily", "weekly", "monthly"];

type ModuleStatus = AnalysisPayload["functionalModules"][number]["status"];

// Status is spelled out next to the bar rather than carried by the bar colour
// alone. "No data" is deliberately neutral: an unavailable pillar is a missing
// measurement, not a passing or failing one.
const moduleStatusLabel: Record<ModuleStatus, string> = { controlled: "Terkendali", watch: "Waspada", critical: "Kritis", unavailable: "Tidak ada data" };
const moduleTone = (status: ModuleStatus) => (status === "controlled" ? "good" : status === "unavailable" ? "neutral" : status);
const evidenceStateLabel: Record<AnalysisPayload["causalChains"][number]["state"], string> = {
  verified: "Fakta terukur",
  supported: "Didukung data",
  hypothesis: "Hipotesis terarah",
  blocked: "Bukti belum cukup",
};
const readinessLabel: Record<AnalysisPayload["metricCatalog"][number]["readiness"], string> = {
  decision_ready: "Siap keputusan",
  diagnostic_only: "Diagnostik",
  observational: "Observasi",
  unconfirmed: "Belum terkonfirmasi",
};

function fmtDate(date: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00`));
}

function fmtSigned(value: number, suffix = "%") {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
}

function fmtNumber(value: number | null, maximumFractionDigits = 1) {
  return value === null ? "—" : value.toLocaleString("id-ID", { maximumFractionDigits });
}

function syncLabel(data: AnalysisPayload | null, error: string | null) {
  if (error) return { label: "Koneksi bermasalah", tone: "error" };
  if (!data) return { label: "Menghubungkan data", tone: "loading" };
  const { sync } = data.context;
  if (sync.isStale) return { label: "Data perlu diperbarui", tone: "stale" };
  if (sync.state === "fallback") return { label: "Fallback aktif", tone: "stale" };
  if (sync.state === "cached") return { label: "Cache cepat", tone: "cached" };
  return { label: sync.provider === "google" ? "Google Sheets live" : "Sumber lokal siap", tone: "live" };
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

function DateField({ label, value, onChange, minimum, maximum, disabled = false }: { label: string; value: string; onChange: (value: string) => void; minimum?: string; maximum?: string; disabled?: boolean }) {
  return <label className={`date-field${disabled ? " is-disabled" : ""}`}><span>{label}</span><div><CalendarDays size={15} /><input type="date" value={value} min={minimum} max={maximum} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></div></label>;
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
      <div className="insight-implication"><strong>Mengapa penting</strong><span>{insight.implication}</span></div>
      <div className="insight-action"><ArrowRight size={15} /><span>{insight.recommendedAction}</span></div>
      <footer><span>Keyakinan {insight.confidence}</span><span>{insight.evidence.length} bukti</span></footer>
    </article>
  );
}

function EconomicsBrief({ data }: { data: AnalysisPayload }) {
  const item = data.economics;
  const verdictLabel: Record<typeof item.verdict, string> = {
    validated_saving: "Efisiensi tervalidasi",
    false_economy: "Penghematan semu",
    undercoverage: "Risiko kekurangan MP",
    process_loss: "Process loss",
    balanced: "Seimbang",
    insufficient: "Data belum cukup",
  };
  return (
    <section className={`economics-brief economics-brief--${item.verdict}`} aria-label="Ringkasan ekonomi operasi">
      <div className="economics-brief__copy">
        <span className="eyebrow">Keputusan biaya & layanan</span>
        <div className="economics-title-row"><h2>{item.headline}</h2><b>{verdictLabel[item.verdict]}</b></div>
        <p>{item.narrative}</p>
        <small>Proksi biaya memakai mandays per 1.000 unit terlayani, bukan nilai rupiah.</small>
      </div>
      <div className="economics-metrics">
        <div><span>Intensitas tenaga</span><strong>{fmtNumber(item.costToServeMdPerThousand, 2)}</strong><small>MD / 1.000 unit</small></div>
        <div><span>Perubahan</span><strong>{item.costToServeDeltaPct === null ? "—" : fmtSigned(item.costToServeDeltaPct)}</strong><small>vs periode setara</small></div>
        <div><span>Produktivitas terjaga</span><strong>{item.serviceAdjustedProductivity === null ? "—" : `${fmtNumber(item.serviceAdjustedProductivity)}%`}</strong><small>setelah guardrail service</small></div>
        <div><span>Demand tak terlayani</span><strong>{fmtNumber(item.unservedDemandQty, 0)}</strong><small>unit dari demand awal</small></div>
      </div>
    </section>
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
          <div className="hero-score-compact"><span>Kesehatan sistem</span><strong>{data.health.score}</strong></div>
          <h1 id="cockpit-title">Sistem operasi {data.context.warehouse} <em>{data.health.status === "controlled" ? "terkendali" : "sedang tertekan"}</em></h1>
          <p>{data.health.narrative}</p>
          <div className="hero-meta"><span><CalendarDays size={14} />{fmtDate(data.context.rangeStart)} — {fmtDate(data.context.rangeEnd)}</span><span><Database size={14} />{data.health.confidence}% coverage analisis</span></div>
        </div>
        <div className="health-gauge"><HealthGauge score={data.health.score} /></div>
      </section>

      <EconomicsBrief data={data} />

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
        <SectionHeader eyebrow="Ringkasan keputusan" title="Keputusan berikut yang perlu diambil" description="Prioritas mempertimbangkan volume, mandays, SLA, kapasitas, cancel, dan kontrol inventory secara bersamaan." />
        <div className="insight-grid">{data.decisionInsights.slice(0, 3).map((insight, index) => <InsightCard insight={insight} index={index} key={insight.id} />)}</div>
      </section>

      <section className="split-grid split-grid--wide-left">
        <div className="panel chart-panel">
          <SectionHeader eyebrow="Kontrol 8 minggu" title="Perpindahan risiko antar fungsi" description="Semakin merah, semakin besar tekanan operasi pada minggu tersebut." />
          <RiskHeatmapChart matrix={data.riskMatrix} />
          <div className="chart-legend"><span><i className="legend-low" />Controlled</span><span><i className="legend-watch" />Watch</span><span><i className="legend-high" />High risk</span></div>
        </div>
        <div className="panel">
          <SectionHeader eyebrow="Urutan perhatian" title="Kesehatan driver saat ini" description="Skor di bawah 65 menjadi prioritas pemeriksaan." />
          <DriverChart drivers={data.drivers} />
        </div>
      </section>

      <section className="panel flow-panel">
        <SectionHeader eyebrow="Inti operasi terhubung" title="Satu alur, dampak saling terkait" description="People dan planning menggerakkan inbound, inventory, outbound, dan fleet sebagai satu sistem." />
        <OperationsFlow modules={data.functionalModules} />
      </section>

      <section className="function-score-grid" aria-label="Functional operations health">
        {data.functionalModules.map((module) => (
          <article className={`function-score function-score--${module.status}`} key={module.division}>
            <div className="function-score__head"><span>{module.division}</span><strong>{module.status === "unavailable" ? "—" : module.score}</strong></div>
            <p>{module.headline}</p>
            <div className="function-score__bar"><i style={{ width: `${module.status === "unavailable" ? 0 : module.score}%` }} /></div>
            <span className={`status-pill status-pill--${moduleTone(module.status)}`}>{moduleStatusLabel[module.status]}</span>
          </article>
        ))}
      </section>

      <section className="split-grid">
        <div className="panel chart-panel">
          <SectionHeader eyebrow={`${data.trends[0]?.values.length ?? 0}-hari`} title="Pergerakan sistem operasi" description="Celah pada grafik berarti data kosong atau tidak valid." />
          <TrendChart series={data.trends.slice(0, 4)} />
        </div>
        <div className="panel panel--ink portfolio-callout">
          <SectionHeader eyebrow="Inisiatif teratas" title={data.initiatives[0]?.title ?? "Validasi baseline operasi"} />
          <div className="portfolio-score"><strong>{data.initiatives[0]?.priorityScore ?? 0}</strong><span>priority<br/>score</span></div>
          <p>{data.initiatives[0]?.intervention}</p>
          <div className="impact-box"><Sparkles size={18} /><div><span>Dampak yang dituju</span><strong>{data.initiatives[0]?.expectedImpact}</strong></div></div>
          <button className="text-button" onClick={openInitiatives}>Buka daftar inisiatif <ChevronRight size={15} /></button>
        </div>
      </section>

      <section className="panel comparison-panel">
        <SectionHeader eyebrow="Network benchmark" title={`PGS · SRG · BIT · STR pada cut-off ${fmtDate(data.warehouseComparison.find((row) => row.asOf)?.asOf ?? data.context.asOf)}`} description="Skor dihitung fungsi yang sama dengan gauge cockpit, atas basket KPI dan tanggal yang sama. Baris bertanda ⚠ kekurangan pilar yang dilaporkan warehouse lain—peringkatnya tidak setara." />
        <div className="comparison-layout">
          <WarehouseComparisonChart rows={data.warehouseComparison} />
          {/* The not-comparable marker is a disclosure, so it carries a text
              equivalent rather than living only in a bare glyph. */}
          <div className="comparison-scoreboard">{[...data.warehouseComparison].sort((a, b) => b.healthScore - a.healthScore).map((row, index) => <div key={row.warehouse}><span>#{index + 1}</span><strong>{row.warehouse}{row.comparable ? "" : <em className="not-comparable" role="img" aria-label="Tidak setara: pilar yang dilaporkan lebih sedikit" title={`Hanya ${row.pillarsAvailable} dari ${row.pillarsTotal} pilar tersedia — peringkat tidak setara`}>⚠</em>}</strong><b>{row.healthScore}</b><small>{row.comparable ? `${row.dataConfidence}% coverage` : `${row.pillarsAvailable}/${row.pillarsTotal} pilar`}</small></div>)}</div>
        </div>
      </section>
    </>
  );
}

function FlowIntelligence({ data }: { data: AnalysisPayload }) {
  const [mode, setMode] = useState<"inbound" | "outbound">("outbound");
  return (
    <>
      <PageIntro eyebrow="Kontrol demand ke layanan" title="Ikuti setiap unit sampai selesai dilayani" description="Bandingkan forecast, aktual, cancel, RTS, penerimaan hub, manpower, dan kapasitas zona dalam satu alur." meta={`${periodLabels[data.context.period]} · ${fmtDate(data.context.rangeStart)} — ${fmtDate(data.context.rangeEnd)}`} />
      <section className="panel chart-panel">
        <SectionHeader eyebrow={`${data.volumeFlow.length}-hari volume`} title={mode === "outbound" ? "Forecast → request → RTS → hub" : "Forecast → aktual inbound"} description="Barang aktual menjadi dasar produktivitas; forecast menjadi acuan rencana." action={<div className="segmented-control"><button className={mode === "inbound" ? "active" : ""} onClick={() => setMode("inbound")}>Inbound</button><button className={mode === "outbound" ? "active" : ""} onClick={() => setMode("outbound")}>Outbound</button></div>} />
        <VolumeFlowChart points={data.volumeFlow} mode={mode} />
      </section>

      <section className="split-grid split-grid--wide-left">
        <div className="panel chart-panel">
          <SectionHeader eyebrow="Loss tree fulfillment" title="Di mana volume outbound berkurang" description="Tahap konversi memisahkan selisih demand, cancel, eksekusi warehouse, dan penerimaan downstream." />
          <FulfillmentFunnelChart stages={data.fulfillmentFunnel} />
          <div className="funnel-stage-strip">{data.fulfillmentFunnel.slice(1).map((stage) => <div key={stage.key}><span>{stage.label}</span><strong>{stage.conversionPct === null ? "—" : `${stage.conversionPct.toFixed(1)}%`}</strong><small>{stage.lossQty === null ? "No comparable stage" : `${stage.lossQty.toLocaleString("id-ID")} qty step loss`}</small></div>)}</div>
        </div>
        <div className="panel decision-sidebar">
          <SectionHeader eyebrow="Keputusan alur" title="Tindak constraint utama" />
          {data.decisionInsights.filter((item) => ["Planning", "Outbound", "Labor economics"].includes(item.domain)).slice(0, 3).map((item) => <article key={item.id}><span>{item.domain}</span><strong>{item.title}</strong><p>{item.recommendedAction}</p></article>)}
          {!data.decisionInsights.some((item) => ["Planning", "Outbound", "Labor economics"].includes(item.domain)) && <div className="empty-state"><CheckCircle2 size={18} /><p>Tidak ada flow breach besar pada cut aktif. Pertahankan guardrail dan pantau perubahan harian.</p></div>}
        </div>
      </section>

      <section className="panel chart-panel">
        <SectionHeader eyebrow="Ekonomi manpower" title="Budget mandays, actual mandays, dan output" description="Actual MD di bawah budget hanya disebut efisien jika demand, produktivitas, dan SLA tetap aman." />
        <LaborBalanceChart points={data.laborBalance} />
      </section>

      <section className="panel chart-panel">
        <SectionHeader eyebrow="Kapasitas zona" title="Batas operasi ambient, chiller, dan frozen" description="Waspada di 85%, kritis di 92%; hari kosong tidak diisi dengan angka buatan." />
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
      <PageIntro eyebrow="Diagnosis lintas fungsi" title="Bedakan hubungan data dari penyebab nyata" description="Hubungan 84 hari menjadi petunjuk investigasi, bukan bukti sebab-akibat. Sampel, jeda, keyakinan, dan arah hipotesis selalu ditampilkan." meta={`Riwayat 84 hari · sampai ${fmtDate(data.context.asOf)}`} />
      <section className="section-block causal-section">
        <SectionHeader eyebrow="Operating logic" title="Jejak sebab-akibat yang dapat diaudit" description="Urutan dibangun dari definisi operasi, loss tree aktual, recurrent pain, dan hubungan statistik. Fakta, dukungan, hipotesis, serta bukti yang masih hilang dipisahkan secara eksplisit." />
        <div className="causal-chain-grid">
          {data.causalChains.map((chain) => (
            <article className={`causal-card causal-card--${chain.state}`} key={chain.id}>
              <header>
                <div><span>{chain.domain}</span><h3>{chain.title}</h3></div>
                <div className="causal-score"><strong>{chain.priorityScore}</strong><small>priority</small></div>
              </header>
              <div className="causal-badges"><span>{evidenceStateLabel[chain.state]}</span><span>Keyakinan {chain.confidence}</span>{chain.linkedPainIds.length > 0 && <span>{chain.linkedPainIds.length} pain terkait</span>}</div>
              <p className="causal-cause">{chain.cause}</p>
              <ol className="causal-mechanism">{chain.mechanism.map((step) => <li key={step}>{step}</li>)}</ol>
              <div className="causal-outcome"><strong>Dampak sistem</strong><p>{chain.outcome}</p></div>
              <div className="causal-evidence"><strong>Bukti aktif</strong>{chain.evidence.map((item) => <span key={item}><CheckCircle2 size={13} />{item}</span>)}</div>
              {chain.counterEvidence.length > 0 && <div className="causal-counter"><strong>Bukti penyeimbang</strong>{chain.counterEvidence.map((item) => <span key={item}>{item}</span>)}</div>}
              <details className="causal-missing"><summary>Bukti berikut yang perlu dikumpulkan</summary>{chain.missingEvidence.map((item) => <span key={item}>{item}</span>)}</details>
              <footer><ArrowRight size={15} /><strong>{chain.recommendedAction}</strong></footer>
            </article>
          ))}
        </div>
      </section>
      <section className="split-grid split-grid--wide-left">
        <div className="panel chart-panel">
          <SectionHeader eyebrow="Peta hubungan" title="Driver yang bergerak bersama outcome" description="Pearson r: biru searah hipotesis, emas berlawanan, abu-abu belum meyakinkan." />
          <RelationshipChart signals={data.relationshipSignals} />
        </div>
        <div className="panel relationship-notice">
          <Info size={20} />
          <div><strong>Cara memakai halaman ini</strong><p>Mulai dari hubungan sedang/kuat dengan sampel memadai. Validasi per shift, weekday, volume band, dan observasi floor sebelum membuat kebijakan.</p></div>
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
  const baseline = { productivityAttainment: find("productivity_attainment", 90), sla: find("sla_checker_inbound", 95), demandFill: find("demand_fill_rate", 97), utilization: find("capacity_utilization", 75), mandaysGap: find("mandays_variance", 0) };
  const result = runSimulation(baseline, inputs);
  const controls: Array<{ key: keyof SimulationInputs; label: string; hint: string; min: number; max: number }> = [
    { key: "forecastChange", label: "Actual volume vs baseline", hint: "Perubahan workload yang benar-benar masuk", min: -30, max: 35 },
    { key: "attendanceChange", label: "Attendance / actual mandays", hint: "Perubahan manpower tersedia", min: -20, max: 20 },
    { key: "cancelChange", label: "Cancel rate change", hint: "Negatif = request cancelled berkurang", min: -10, max: 10 },
    { key: "processGain", label: "Process efficiency gain", hint: "Perbaikan pickface, travel, rework, atau system", min: 0, max: 20 },
  ];
  return (
    <>
      <PageIntro eyebrow="Simulasi transparan" title="Uji keputusan sebelum diterapkan di floor" description="Lihat dampak arah perubahan volume, manpower, cancel, produktivitas, SLA, fulfillment, dan kapasitas." meta={`${data.context.warehouse} baseline · ${periodLabels[data.context.period]}`} />
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
      <section className="baseline-grid"><div><span>Productivity</span><strong>{baseline.productivityAttainment.toFixed(1)}%</strong></div><div><span>Inbound SLA</span><strong>{baseline.sla.toFixed(1)}%</strong></div><div><span>Demand fill</span><strong>{baseline.demandFill.toFixed(1)}%</strong></div><div><span>Peak capacity</span><strong>{baseline.utilization.toFixed(1)}%</strong></div><div><span>Mandays gap</span><strong>{fmtSigned(baseline.mandaysGap)}</strong></div></section>
      <section className="panel assumption-panel"><Target size={19} /><div><strong>Model mechanics and boundary</strong><p>Volume memengaruhi output per fixed manday; attendance menambah SLA buffer tetapi dapat menurunkan productivity; process gain menaikkan throughput; return dilunakkan saat capacity melewati 88%. Gunakan hasil untuk memilih pilot, bukan sebagai forecast finansial.</p></div></section>
    </>
  );
}

function InitiativePortfolio({ data }: { data: AnalysisPayload }) {
  return (
    <>
      <PageIntro eyebrow="Portofolio eksekusi" title="Ubah masalah berulang menjadi inisiatif terukur" description="Setiap inisiatif memiliki owner, usaha, target waktu, bukti, guardrail, dan langkah awal." meta={`${data.initiatives.length} inisiatif · ${data.context.warehouse}`} />
      <section className="portfolio-overview">
        <div className="panel chart-panel"><SectionHeader eyebrow="Prioritas vs usaha" title="Kerjakan yang paling bernilai lebih dulu" description="Ukuran titik menunjukkan target waktu; garis 65 adalah ambang tindakan." /><InitiativePriorityChart initiatives={data.initiatives} /></div>
        <div className="portfolio-summary">
          <article><Users size={17} /><span>Owner utama</span><strong>{new Set(data.initiatives.map((item) => item.owner)).size}</strong></article>
          <article><Target size={17} /><span>Keyakinan tinggi</span><strong>{data.initiatives.filter((item) => item.confidence === "high").length}</strong></article>
          <article><CalendarDays size={17} /><span>Target tercepat</span><strong>{Math.min(...data.initiatives.map((item) => item.horizonDays))}h</strong></article>
          <article><Sparkles size={17} /><span>Prioritas tertinggi</span><strong>{Math.max(...data.initiatives.map((item) => item.priorityScore))}</strong></article>
        </div>
      </section>
      <section className="initiative-grid">
        {data.initiatives.map((initiative, index) => (
          <article className="initiative-card" key={initiative.id}>
            <header><span className="initiative-number">0{index + 1}</span><div><div className="tag-row"><span>{initiative.type}</span><span>keyakinan {initiative.confidence}</span><span>prioritas {initiative.priorityScore}</span></div><h3>{initiative.title}</h3><div className="initiative-meta"><span><Users size={13} />{initiative.owner}</span><span><BarChart3 size={13} />usaha {initiative.effort}</span><span><CalendarDays size={13} />{initiative.horizonDays} hari</span></div></div></header>
            <div className="initiative-adaptive"><div><span>Mengapa sekarang</span><strong>{initiative.whyNow}</strong></div><div><span>Trigger eksekusi</span><strong>{initiative.trigger}</strong></div><small>Playbook adaptif · {initiative.adaptiveVariant.replaceAll("-", " ")}{initiative.linkedChainIds.length ? ` · ${initiative.linkedChainIds.length} causal chain` : ""}</small></div>
            <div className="initiative-section"><span>Masalah</span><p>{initiative.problem}</p></div><div className="initiative-section"><span>Intervensi</span><p>{initiative.intervention}</p></div><div className="initiative-section initiative-section--impact"><span>Dampak yang dituju</span><p>{initiative.expectedImpact}</p></div>
            <div className="initiative-decision-gates"><div><span>Berhasil bila</span><strong>{initiative.successGate}</strong></div><div><span>Stop-loss</span><strong>{initiative.stopLoss}</strong></div><div className="priority-breakdown"><span>Dasar prioritas</span><p><b>{initiative.priorityBreakdown.impact}</b> dampak · <b>{initiative.priorityBreakdown.recurrence}</b> berulang · <b>{initiative.priorityBreakdown.evidence}</b> bukti · <b>{initiative.priorityBreakdown.feasibility}</b> kelayakan</p></div></div>
            <div className="initiative-evidence"><strong>Bukti yang dipakai</strong>{initiative.evidence.map((item) => <span key={item}>{item}</span>)}</div>
            <div className="initiative-columns"><div><strong>Ukuran & guardrail</strong>{initiative.measurement.map((item) => <p key={item}><CheckCircle2 size={13} />{item}</p>)}</div><div><strong>14 hari pertama</strong>{initiative.first14Days.map((item) => <p key={item}><ChevronRight size={13} />{item}</p>)}</div></div>
          </article>
        ))}
      </section>
    </>
  );
}

function MetricRegistry({ data }: { data: AnalysisPayload }) {
  const [query, setQuery] = useState("");
  const [readiness, setReadiness] = useState<"all" | AnalysisPayload["metricCatalog"][number]["readiness"]>("all");
  const filtered = useMemo(() => data.pivotRows.filter((item) => `${item.division} ${item.role} ${item.metric} ${item.detail}`.toLowerCase().includes(query.toLowerCase())), [data.pivotRows, query]);
  const filteredSemantics = useMemo(() => data.metricCatalog.filter((item) => {
    const matchesQuery = `${item.division} ${item.role} ${item.remarks} ${item.metric} ${item.definition} ${item.decisionUse} ${item.caveat ?? ""}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (readiness === "all" || item.readiness === readiness);
  }), [data.metricCatalog, query, readiness]);
  return (
    <>
      <PageIntro eyebrow="Data & semantic control" title="Telusuri angka, definisi, dan kelayakan keputusannya" description="Setiap metric dipisahkan sebagai outcome, driver, guardrail, atau konteks—serta diberi status apakah siap untuk keputusan, hanya diagnostik, observasi, atau belum terkonfirmasi." meta={`${data.pivotRows.length} metric · ${data.metricCatalog.length} definisi`} />
      <section className="semantic-summary" aria-label="Ringkasan semantic layer">
        <article><span>Metric sumber</span><strong>{data.intelligence.sourceMetrics}</strong><small>{data.intelligence.activeMetrics} aktif pada window</small></article>
        <article><span>Siap keputusan</span><strong>{data.intelligence.decisionReadyMetrics}</strong><small>terhubung ke logic engine</small></article>
        <article><span>Diagnostik</span><strong>{data.intelligence.diagnosticMetrics}</strong><small>perlu bukti pendamping</small></article>
        <article><span>Observasi</span><strong>{data.intelligence.observationalMetrics}</strong><small>konteks, volume, atau plan</small></article>
        <article className={data.intelligence.unconfirmedMetrics ? "semantic-summary--warning" : ""}><span>Belum terkonfirmasi</span><strong>{data.intelligence.unconfirmedMetrics}</strong><small>tidak memicu rekomendasi</small></article>
        <article><span>Cakupan makna</span><strong>{data.intelligence.semanticCoveragePct}%</strong><small>punya konteks yang dapat dipakai</small></article>
      </section>
      <section className="panel domain-coverage-panel">
        <SectionHeader eyebrow="Coverage by function" title="Fungsi mana yang cukup terukur untuk keputusan" description="Active coverage menghitung keterisian metric pada window aktif; metric kosong tidak dianggap sehat." />
        <div className="domain-coverage-grid">{data.intelligence.domains.map((item) => <article key={item.domain}><header><strong>{item.domain}</strong><b>{item.activeCoveragePct}%</b></header><div><i style={{ width: `${item.activeCoveragePct}%` }} /></div><footer><span>{item.activeMetrics}/{item.totalMetrics} aktif</span><span>{item.decisionReadyMetrics} siap keputusan</span></footer></article>)}</div>
      </section>
      <section className="data-quality-strip"><div><span>Sumber</span><strong>{data.context.sourceName}</strong></div><div><span>Status sinkron</span><strong>{syncLabel(data, null).label}</strong></div><div><span>Berhasil dibaca</span><strong>{new Date(data.context.sync.lastSuccessAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</strong></div><div><span>Rentang aktif</span><strong>{fmtDate(data.context.rangeStart)} – {fmtDate(data.context.rangeEnd)}</strong></div><div><span>Perbandingan</span><strong>{fmtDate(data.context.comparisonStart)} – {fmtDate(data.context.comparisonEnd)}</strong></div><div><span>Coverage KPI</span><strong>{data.health.confidence}%</strong></div></section>
      <section className={`sync-detail sync-detail--${data.context.sync.state}`}><Activity size={17} /><div><strong>{data.context.sync.message}</strong><p>{data.context.sync.rangesLoaded ? `${data.context.sync.rangesLoaded} rentang dibaca` : "Jumlah rentang tidak tercatat"} · {data.context.sync.latencyMs === null ? "durasi tidak tersedia" : `${data.context.sync.latencyMs.toLocaleString("id-ID")} ms`} · stale setelah {Math.round(data.context.sync.staleAfterSeconds / 60)} menit.</p></div></section>
      {data.health.dataWarnings.length > 0 && <section className="warning-panel"><AlertTriangle size={20} /><div><strong>Guardrail kualitas aktif</strong>{data.health.dataWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div></section>}
      <section className="section-block operating-contract">
        <SectionHeader eyebrow="Operations semantic contract" title="Aturan yang menjaga insight tetap masuk akal" description="Aturan ini mengikat metric yang saling tarik-menarik, sehingga satu KPI tidak dioptimalkan dengan mengorbankan service, quality, capacity, atau cost." />
        <div className="operating-rule-grid">{data.intelligence.operatingRules.map((rule, index) => <details key={rule.id} open={index < 2}><summary><span>0{index + 1}</span><strong>{rule.title}</strong><ChevronDown size={15} /></summary><p>{rule.principle}</p><div><Target size={14} /><span>{rule.decisionGuardrail}</span></div></details>)}</div>
      </section>
      <section className="panel semantic-registry">
        <SectionHeader eyebrow="Metric dictionary" title="Definisi dan status penggunaan metric" description="Belum terkonfirmasi berarti metric tetap terlihat, tetapi tidak boleh memicu scoring atau inisiatif sampai definisinya disepakati." action={<div className="segmented-control semantic-filter" aria-label="Filter kesiapan metric"><button className={readiness === "all" ? "active" : ""} onClick={() => setReadiness("all")}>Semua</button><button className={readiness === "decision_ready" ? "active" : ""} onClick={() => setReadiness("decision_ready")}>Siap</button><button className={readiness === "diagnostic_only" ? "active" : ""} onClick={() => setReadiness("diagnostic_only")}>Diagnostik</button><button className={readiness === "observational" ? "active" : ""} onClick={() => setReadiness("observational")}>Observasi</button><button className={readiness === "unconfirmed" ? "active" : ""} onClick={() => setReadiness("unconfirmed")}>Belum pasti</button></div>} />
        <div className="semantic-toolbar"><div className="search-box"><Search size={17} /><input aria-label="Cari definisi metric" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari metric, definisi, fungsi, atau caveat" /><span>{filteredSemantics.length}</span></div><small>{filteredSemantics.filter((item) => item.activeCoverage > 0).length} metric aktif pada rentang ini</small></div>
        <div className="semantic-list">
          {filteredSemantics.slice(0, 160).map((item) => <details className={`semantic-item semantic-item--${item.readiness}`} key={item.id}><summary><div><span>{item.division} · {item.role}{item.remarks ? ` · ${item.remarks}` : ""}</span><strong>{item.metric}</strong></div><div><b>{readinessLabel[item.readiness]}</b><small>{Math.round(item.activeCoverage * 100)}% coverage</small><ChevronDown size={15} /></div></summary><div className="semantic-item__body"><section><span>Definisi</span><p>{item.definition}</p></section><section><span>Dipakai untuk</span><p>{item.decisionUse}</p></section><section><span>Posisi metric</span><p>{item.decisionRole} · {item.family} · {item.polarity.replaceAll("_", " ")}{item.remarks ? ` · ${item.remarks}` : ""}</p></section><section><span>Harus dibaca bersama</span><p>{item.relatedMetrics.join(" · ")}</p></section>{item.caveat && <div className="semantic-caveat"><AlertTriangle size={14} /><p>{item.caveat}</p></div>}</div></details>)}
          {!filteredSemantics.length && <div className="empty-state"><Info size={18} /><p>Tidak ada metric yang cocok dengan filter ini.</p></div>}
        </div>
      </section>
      <section className="panel metric-panel">
        <div className="table-toolbar"><div><TableProperties size={17} /><span>Pivot periode · saat ini vs sebelumnya</span></div><div className="search-box"><Search size={17} /><input aria-label="Cari metric" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari metric, peran, atau fungsi" /><span>{filtered.length}</span></div></div>
        {/* Cell roles are not optional here: role="table" with rows but no cells
            announces as an empty table, which is worse than no roles at all. */}
        <div className="metric-table" role="table" aria-label="Metric pivot">
          <div className="metric-row metric-row--pivot metric-row--head" role="row">
            {["Fungsi / peran", "Metric", "Agregasi", "Saat ini", "Sebelumnya", "Delta", "Coverage"].map((heading) => <span role="columnheader" key={heading}>{heading}</span>)}
          </div>
          {filtered.slice(0, 250).map((item) => (
            <div className="metric-row metric-row--pivot" role="row" key={item.id}>
              <span role="cell"><b>{item.division}</b><small>{item.role}</small></span>
              <strong role="cell" title={item.detail}>{item.metric}</strong>
              <span role="cell" className="aggregation-pill">{item.aggregation}</span>
              <b role="cell">{fmtMetric(item.current, item.unit)}</b>
              <span role="cell">{fmtMetric(item.previous, item.unit)}</span>
              <span role="cell" className={`movement movement--${item.movement}`}>{item.deltaPct === null ? "—" : fmtSigned(item.deltaPct)}</span>
              <span role="cell">{Math.round(item.coverage * 100)}%</span>
            </div>
          ))}
        </div>
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
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState<AnalysisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);

  const toggleNavigation = () => {
    setNavCollapsed((current) => !current);
  };

  const selectView = (nextView: View) => {
    setView(nextView);
    window.requestAnimationFrame(() => {
      workspaceRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  };

  const refresh = useCallback(async (quiet = false, force = false) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const sequence = ++requestSequence.current;
    if (!quiet) setLoading(true);
    try {
      const queryPeriod = startDate && endDate ? "custom" : period === "custom" ? "weekly" : period;
      const query = new URLSearchParams({ warehouse, period: queryPeriod, division, role });
      if (startDate && endDate) {
        query.set("period", "custom");
        query.set("startDate", startDate);
        query.set("endDate", endDate);
      }
      if (force) query.set("refresh", "1");
      const response = await fetch(`/api/analysis?${query.toString()}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json() as AnalysisPayload & { error?: string; detail?: string; remediation?: string };
      if (!response.ok) throw new Error([payload.error, payload.detail, payload.remediation].filter(Boolean).join(" — "));
      if (sequence !== requestSequence.current) return;
      setData(payload);
      setError(null);
      setLastRefresh(new Date());
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (sequence !== requestSequence.current) return;
      setError(reason instanceof Error ? reason.message : "Gagal membaca source");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [warehouse, period, division, role, startDate, endDate]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void refresh(true);
    }, 30_000);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); activeRequest.current?.abort(); };
  }, [refresh]);

  const choosePreset = (nextPeriod: Period) => {
    setStartDate("");
    setEndDate("");
    setPeriod(nextPeriod);
  };

  const changeStartDate = (value: string) => {
    setStartDate(value);
    setEndDate((current) => current || data?.context.rangeEnd || value);
    setPeriod("custom");
  };

  const changeEndDate = (value: string) => {
    setEndDate(value);
    setStartDate((current) => current || data?.context.rangeStart || value);
    setPeriod("custom");
  };

  const sourceState = syncLabel(data, error);
  const visibleStart = startDate || data?.context.rangeStart || "";
  const visibleEnd = endDate || data?.context.rangeEnd || "";

  return (
    <div className={`app-shell${navCollapsed ? " app-shell--nav-collapsed" : ""}`}>
      <a className="skip-link" href="#workspace-content">Lewati ke analisis utama</a>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><BarChart3 size={19} /></div><div className="brand-copy"><strong>NEXUS</strong><span>Excellence Analysis</span></div></div>
        <nav aria-label="Workspace utama"><span className="nav-caption">Decision workspaces</span>{nav.map((item) => { const Icon = item.icon; return <button type="button" data-view={item.id} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} key={item.id} onClick={() => selectView(item.id)} title={item.label}><Icon size={18} /><span className="nav-label-long">{item.label}</span><span className="nav-label-short">{item.short}</span>{item.id === "initiatives" && data && <b>{data.initiatives.length}</b>}</button>; })}</nav>
        <div className={`sidebar-status sidebar-status--${sourceState.tone}`}><div className="live-dot" /><div><strong>Monitor data</strong><span>{error ? "Perlu diperiksa" : "Refresh otomatis · 30 detik"}</span></div></div>
        <div className="sidebar-footer"><span>FIT Operations Intelligence</span><small>v0.3 · connected decision system</small></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="topbar-leading"><button type="button" className="menu-toggle" onClick={toggleNavigation} aria-label={navCollapsed ? "Tampilkan panel menu" : "Sembunyikan panel menu"} aria-expanded={!navCollapsed}>{navCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><div className="breadcrumb"><span>FIT Ops Intelligence</span><ChevronRight size={14} /><strong>{nav.find((item) => item.id === view)?.label}</strong></div></div><div className="topbar-actions"><div className={`source-chip source-chip--${sourceState.tone}`} title={data?.context.sync.message}><Activity size={14} /><span>{sourceState.label}</span></div><button className="refresh-button" onClick={() => void refresh(false, true)} aria-label="Sinkronkan data sekarang"><RefreshCw className={loading ? "spinning" : ""} size={16} /><span>Sinkronkan</span></button></div></header>

        <div className="content-area">
          <div className="context-line"><span>{warehouse} · Analisis {periodLabels[period].toLowerCase()}</span><span>{lastRefresh ? `Diperbarui ${lastRefresh.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}` : "Menghubungkan ke sumber data"}</span></div>
          <section className={`filter-console${filtersOpen ? " is-open" : ""}`} aria-label="Filter analisis">
            <div className="filter-console__title"><SlidersHorizontal size={18} /><div><strong>Filter analisis</strong><span>Satu rentang untuk seluruh halaman</span></div><div className="filter-summary" aria-label="Filter aktif"><span>{warehouse}</span><span>{periodLabels[period]}</span><span>{division === "All" ? "Semua fungsi" : division}</span></div><button type="button" className="filter-toggle" aria-expanded={filtersOpen} aria-controls="filter-console-body" onClick={() => setFiltersOpen((current) => !current)}>{filtersOpen ? "Tutup" : "Ubah"}<ChevronDown size={16} /></button></div>
            <div className="filter-console__body" id="filter-console-body">
              <div className="filter-console__fields">
              <FilterSelect label="Warehouse" value={warehouse} onChange={(value) => { setWarehouse(value as WarehouseCode); setDivision("All"); setRole("All"); setStartDate(""); setEndDate(""); setPeriod("weekly"); }}>{PRIORITY_WAREHOUSES.map((item) => <option value={item} key={item}>{item}</option>)}</FilterSelect>
              <FilterSelect label="Fungsi" value={division} onChange={(value) => { setDivision(value); setRole("All"); }}><option value="All">Semua fungsi</option>{(data?.filters.divisions ?? []).map((item) => <option value={item} key={item}>{item}</option>)}</FilterSelect>
              <FilterSelect label="Peran" value={role} onChange={setRole} disabled={!data}><option value="All">Semua peran</option>{(data?.filters.rolesByDivision[division] ?? data?.filters.rolesByDivision.All ?? []).map((item) => <option value={item} key={item}>{item}</option>)}</FilterSelect>
              <DateField label="Mulai" value={visibleStart} onChange={changeStartDate} minimum={data?.filters.minimumDate} maximum={visibleEnd || data?.filters.maximumDate} disabled={!data} />
              <DateField label="Selesai" value={visibleEnd} onChange={changeEndDate} minimum={visibleStart || data?.filters.minimumDate} maximum={data?.filters.maximumDate} disabled={!data} />
              </div>
              <div className="period-control"><span>Rentang cepat</span><div className="period-switcher" aria-label="Pilih rentang cepat">{presetPeriods.map((key) => <button type="button" className={period === key && !startDate ? "active" : ""} aria-pressed={period === key && !startDate} onClick={() => choosePreset(key)} key={key}>{key === "daily" ? "1 hari" : key === "weekly" ? "7 hari" : "30 hari"}</button>)}</div></div>
            </div>
          </section>

          <div id="workspace-content" className="workspace-content" ref={workspaceRef} tabIndex={-1} aria-live="polite" aria-label={nav.find((item) => item.id === view)?.label}>
          {error ? <section className="source-error"><AlertTriangle size={24} /><div><h2>Data belum dapat dibaca</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw size={15} />Coba lagi</button></div></section> : loading && !data ? <Skeleton /> : data ? <>
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
