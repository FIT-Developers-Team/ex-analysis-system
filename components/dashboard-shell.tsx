"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Database,
  Eye,
  FlaskConical,
  Footprints,
  GitBranch,
  Info,
  LayoutDashboard,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ScanLine,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  TableProperties,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  CapacityHistoryChart,
  ControlChartView,
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
import type { AnalysisPayload, DecisionInsight, FloorSignal, FloorStation, Period, SimulationInputs, WarehouseCode } from "@/lib/types";
import { PRIORITY_WAREHOUSES } from "@/lib/types";

type View = "overview" | "floor" | "flow" | "relationships" | "simulation" | "initiatives" | "knowledge" | "data";

const nav = [
  { id: "overview" as const, group: "Lihat", label: "Ringkasan", short: "Ringkasan", icon: LayoutDashboard },
  { id: "floor" as const, group: "Lihat", label: "Lantai", short: "Lantai", icon: Boxes },
  { id: "flow" as const, group: "Lihat", label: "Alur volume", short: "Alur", icon: TrendingUp },
  { id: "relationships" as const, group: "Lihat", label: "Bukti", short: "Bukti", icon: GitBranch },
  { id: "simulation" as const, group: "Putuskan", label: "Simulasi", short: "Simulasi", icon: FlaskConical },
  { id: "initiatives" as const, group: "Putuskan", label: "Rencana aksi", short: "Aksi", icon: Lightbulb },
  { id: "knowledge" as const, group: "Rujukan", label: "Pengetahuan", short: "Ilmu", icon: BookOpen },
  { id: "data" as const, group: "Rujukan", label: "Data & definisi", short: "Data", icon: Database },
];

const navGroups = [...new Set(nav.map((item) => item.group))];

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
const definitionStatusLabel: Record<AnalysisPayload["metricCatalog"][number]["definitionStatus"], string> = {
  documented: "Definisi sumber",
  inferred: "Inferensi terarah",
  unresolved: "Belum dijelaskan",
};
const threadStateLabel: Record<AnalysisPayload["operationalThreads"][number]["state"], string> = {
  connected: "Terhubung",
  constrained: "Ada tekanan",
  partial: "Sebagian terbaca",
  blocked: "Chain terputus",
};
const phaseLabel: Record<string, string> = { contain: "Kendalikan", diagnose: "Cari penyebab", optimize: "Perbaiki" };
const initiativeRoleLabel: Record<AnalysisPayload["initiatives"][number]["portfolioRole"], string> = { contain: "Kendalikan", recover: "Pulihkan", optimize: "Perbaiki", validate: "Uji" };
const initiativeTypeLabel: Record<AnalysisPayload["initiatives"][number]["type"], string> = { stabilize: "Stabilkan", optimize: "Optimalkan", validate: "Validasi" };
const confidenceLabel: Record<"high" | "medium" | "low", string> = { high: "tinggi", medium: "sedang", low: "rendah" };

function signatureLabel(value: string) {
  const labels: Record<string, string> = {
    CANCEL_HIGH: "Cancel tinggi",
    DEMAND_FILL_LOW: "Demand tidak terpenuhi",
    CAPACITY_PRESSURE: "Kapasitas tertekan",
    PICKFACE_NOT_READY: "Pickface belum siap",
    MANDAYS_BELOW_BUDGET: "MD di bawah budget",
    PRODUCTIVITY_LOW: "Produktivitas rendah",
    SLA_LOW: "SLA rendah",
  };
  return labels[value] ?? value.replaceAll("_", " ").toLowerCase();
}

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
  if (error) return { label: "Koneksi gagal", tone: "error" };
  if (!data) return { label: "Menyambungkan", tone: "loading" };
  const { sync } = data.context;
  if (sync.state === "fallback") return { label: "Snapshot aktif", tone: "stale" };
  if (sync.isStale) return { label: "Perlu sinkron", tone: "stale" };
  if (sync.state === "cached") return { label: "Data terhubung", tone: "cached" };
  return { label: sync.provider === "google" ? "Sheet terhubung" : "File lokal siap", tone: "live" };
}

function fmtMetric(value: number | null, unit: AnalysisPayload["pivotRows"][number]["unit"]) {
  if (value === null) return "—";
  if (unit === "percent") return `${value.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
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

function DateField({ label, name, value, onChange, minimum, maximum, disabled = false }: { label: string; name: string; value: string; onChange: (value: string) => void; minimum?: string; maximum?: string; disabled?: boolean }) {
  return <label className={`date-field${disabled ? " is-disabled" : ""}`}><span>{label}</span><div><CalendarDays size={15} /><input type="date" name={name} value={value} min={minimum} max={maximum} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></div></label>;
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
  const priorityText = insight.priority === "critical" ? "kritis" : insight.priority === "high" ? "tinggi" : "sedang";
  return (
    <article className={`insight-card insight-card--${insight.priority}`}>
      <header><span>0{index + 1}</span><div><small>{insight.domain === "Labor economics" ? "Biaya tenaga kerja" : insight.domain}</small><h3>{insight.title}</h3></div><b>{priorityText}</b></header>
      <p>{insight.observation}</p>
      <div className="insight-implication"><strong>Mengapa penting</strong><span>{insight.implication}</span></div>
      <div className="insight-action"><ArrowRight size={15} /><span>{insight.recommendedAction}</span></div>
      <footer><span>Keyakinan {confidenceLabel[insight.confidence]}</span><span>{insight.evidence.length} bukti</span></footer>
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
        <div><span>Produktivitas terjaga</span><strong>{item.serviceAdjustedProductivity === null ? "—" : `${fmtNumber(item.serviceAdjustedProductivity)}%`}</strong><small>setelah dikoreksi layanan</small></div>
        <div><span>Demand tak terlayani</span><strong>{fmtNumber(item.unservedDemandQty, 0)}</strong><small>unit dari demand awal</small></div>
      </div>
    </section>
  );
}

function OperatingPictureBrief({ data }: { data: AnalysisPayload }) {
  const picture = data.operatingPicture;
  return (
    <section className={`operating-picture operating-picture--${picture.mode}`} aria-labelledby="operating-picture-title">
      <header>
        <div><span className="eyebrow">Kondisi saat ini</span><h2 id="operating-picture-title">{picture.headline}</h2></div>
        <div className="operating-picture__status"><strong>{picture.label}</strong><span>Keyakinan {confidenceLabel[picture.confidence]}</span></div>
      </header>
      <p className="operating-picture__situation">{picture.situation}</p>
      <div className="operating-signature" aria-label="Penanda kondisi operasi">{picture.signature.length ? picture.signature.map((item) => <span key={item}>{signatureLabel(item)}</span>) : <span>Tidak ada masalah dominan</span>}</div>
      <div className="decision-sequence" aria-label="Urutan keputusan">
        {picture.decisionSequence.map((step, index) => <article key={`${step.phase}-${step.owner}`}><span>0{index + 1} · {phaseLabel[step.phase] ?? step.phase}</span><strong>{step.action}</strong><p>{step.owner}</p><small>Selesai bila: {step.exitGate}</small></article>)}
      </div>
      <details className="operating-picture__details">
        <summary>Dasar analisis <ChevronDown size={15} /></summary>
        <div className="operating-picture__evidence">
          <section><strong>Fakta</strong>{picture.verifiedFacts.map((item) => <p key={item}><CheckCircle2 size={14} />{item}</p>)}</section>
          <section><strong>Dugaan mekanisme</strong>{picture.plausibleMechanisms.map((item) => <p key={item}><GitBranch size={14} />{item}</p>)}</section>
          <section><strong>Alternatif</strong>{picture.alternativeExplanations.map((item) => <p key={item}><Info size={14} />{item}</p>)}</section>
        </div>
      </details>
      <footer><AlertTriangle size={14} /><span>{picture.evidenceBoundary}</span></footer>
    </section>
  );
}

/** Bridge from the KPI layer to the station that produces the number. Without
 *  it the cockpit names a problem and leaves the reader to guess which bench it
 *  lives on. */
function FloorConstraintStrip({ data, openFloor }: { data: AnalysisPayload; openFloor: () => void }) {
  const briefing = data.floorBriefing;
  const constraint = data.floorStations.find((station) => station.id === briefing.constraintStationId);
  const firstStep = briefing.walkOrder[0];
  return (
    <section className={`floor-strip${constraint ? ` floor-strip--${constraint.state}` : ""}`} aria-labelledby="floor-strip-title">
      <div className="floor-strip__copy">
        <span className="eyebrow"><Boxes size={13} />Lantai operasi</span>
        <h2 id="floor-strip-title">{briefing.headline}</h2>
        {firstStep ? <p><b>Langkah pertama.</b> {firstStep.action}</p> : <p>{briefing.narrative}</p>}
      </div>
      <div className="floor-strip__counts">
        <div><span>Menembus ambang</span><strong>{briefing.breachedCount}</strong></div>
        <div><span>Tertekan</span><strong>{briefing.pressuredCount}</strong></div>
        <div><span>Tidak terukur</span><strong>{briefing.unmeasuredCount}</strong></div>
        <div><span>Stasiun terukur</span><strong>{briefing.measuredStations}/{briefing.totalStations}</strong></div>
      </div>
      <button type="button" className="ghost-button floor-strip__cta" onClick={openFloor}>Buka rute inspeksi <ChevronRight size={15} /></button>
    </section>
  );
}

function ExecutiveCockpit({ data, openInitiatives, openFloor, openKnowledge }: { data: AnalysisPayload; openInitiatives: () => void; openFloor: () => void; openKnowledge: () => void }) {
  // fulfillment_rate and demand_fill_rate sit side by side on purpose: the first is
  // measured after cancellation and the second before it, and the gap between them
  // is the share of demand that was dropped rather than served.
  const priority = data.kpis.filter((item) => ["forecast_accuracy", "productivity_attainment", "fulfillment_rate", "demand_fill_rate", "cancel_rate", "mandays_variance", "capacity_utilization"].includes(item.key));
  const breaching = data.kpis.filter((item) => data.health.criticalKpis.includes(item.key));
  const stateLabel = data.health.status === "controlled" ? "Terkendali" : data.health.status === "critical" ? "Butuh tindakan" : "Perlu perhatian";
  return (
    <>
      <section className="intelligence-hero intelligence-hero--executive" aria-labelledby="cockpit-title">
        <div className="hero-copy">
          <span className={`status-label status-label--${data.health.status}`}><CircleDot size={13} />{data.health.headline}</span>
          <div className="hero-score-compact"><span>Kesehatan sistem</span><strong>{data.health.score}</strong></div>
          <h1 id="cockpit-title">{data.context.warehouse} · <em>{stateLabel}</em></h1>
          <p>{data.health.narrative}</p>
          <div className="hero-meta"><span><CalendarDays size={14} />{fmtDate(data.context.rangeStart)} — {fmtDate(data.context.rangeEnd)}</span><span><Database size={14} />{data.health.confidence}% cakupan analisis</span></div>
        </div>
        <div className="health-gauge"><HealthGauge score={data.health.score} /></div>
      </section>

      <EconomicsBrief data={data} />
      <FloorConstraintStrip data={data} openFloor={openFloor} />
      <OperatingPictureBrief data={data} />

      <div className="kpi-rail-header"><div><span>Ambang utama</span><strong>Angka pembentuk skor</strong></div><small>Geser untuk melihat semua</small></div>
      <section className="kpi-strip" aria-label="Angka pembentuk skor">{priority.map((metric) => <KpiCard key={metric.key} metric={metric} />)}</section>

      {breaching.length > 0 && (
        <section className="panel guardrail-banner">
          <AlertTriangle size={18} />
          <div>
            <strong>{breaching.length} angka lewat ambang</strong>
            <p>{breaching.map((item) => `${item.label} ${item.value === null ? "n/a" : `${item.value.toFixed(1)}%`} (target ${item.target}%)`).join(" · ")}. Skor rata-rata tidak boleh menutupinya.</p>
          </div>
        </section>
      )}

      <section className="section-block">
        <SectionHeader eyebrow="Keputusan" title="Yang perlu dilakukan sekarang" description="Urutannya sudah menimbang volume, orang, SLA, kapasitas, pembatalan, dan inventory." />
        <div className="insight-grid">{data.decisionInsights.slice(0, 3).map((insight, index) => <InsightCard insight={insight} index={index} key={insight.id} />)}</div>
      </section>

      <section className="section-block">
        <SectionHeader eyebrow="Angka" title="Yang tidak bisa dijawab satu persen" description="Arah error, hari yang benar-benar aneh, dan berapa orang yang sebenarnya dibutuhkan." action={<button type="button" className="ghost-button" onClick={openKnowledge}>Lihat semua <ChevronRight size={15} /></button>} />
        <StatisticsReadout data={data} compact />
      </section>

      <section className="split-grid split-grid--wide-left">
        <div className="panel chart-panel">
          <SectionHeader eyebrow="8 minggu" title="Risiko per fungsi" description="Warna lebih pekat berarti tekanan lebih tinggi." />
          <RiskHeatmapChart matrix={data.riskMatrix} />
          <div className="chart-legend"><span><i className="legend-low" />Terkendali</span><span><i className="legend-watch" />Waspada</span><span><i className="legend-high" />Risiko tinggi</span></div>
        </div>
        <div className="panel">
          <SectionHeader eyebrow="Prioritas" title="Driver terlemah" description="Skor di bawah 65 perlu diperiksa lebih dulu." />
          <DriverChart drivers={data.drivers} />
        </div>
      </section>

      <section className="panel flow-panel">
        <SectionHeader eyebrow="Lintas fungsi" title="Dampak saling terkait" description="Orang dan rencana memengaruhi seluruh alur." />
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
          <SectionHeader eyebrow={`${data.trends[0]?.values.length ?? 0} hari`} title="Tren KPI utama" description="Celah berarti data kosong atau tidak valid." />
          <TrendChart series={data.trends.slice(0, 4)} />
        </div>
        <div className="panel panel--ink portfolio-callout">
          <SectionHeader eyebrow="Aksi teratas" title={data.initiatives[0]?.title ?? "Validasi baseline operasi"} />
          <div className="portfolio-score"><strong>{data.initiatives[0]?.priorityScore ?? 0}</strong><span>skor<br/>prioritas</span></div>
          <p>{data.initiatives[0]?.intervention}</p>
          <div className="impact-box"><Sparkles size={18} /><div><span>Dampak yang dituju</span><strong>{data.initiatives[0]?.expectedImpact}</strong></div></div>
          <button className="text-button" onClick={openInitiatives}>Buka rencana aksi <ChevronRight size={15} /></button>
        </div>
      </section>

      <section className="panel comparison-panel">
        <SectionHeader eyebrow="Perbandingan WH" title={`PGS · SRG · BIT · STR · ${fmtDate(data.warehouseComparison.find((row) => row.asOf)?.asOf ?? data.context.asOf)}`} description="Skor dan tanggalnya sama untuk semua. Tanda ⚠ berarti datanya tidak lengkap, jadi peringkatnya belum setara." />
        <div className="comparison-layout">
          <WarehouseComparisonChart rows={data.warehouseComparison} />
          {/* The not-comparable marker is a disclosure, so it carries a text
              equivalent rather than living only in a bare glyph. */}
          <div className="comparison-scoreboard">{[...data.warehouseComparison].sort((a, b) => b.healthScore - a.healthScore).map((row, index) => <div key={row.warehouse}><span>#{index + 1}</span><strong>{row.warehouse}{row.comparable ? "" : <em className="not-comparable" role="img" aria-label="Tidak setara: pilar yang dilaporkan lebih sedikit" title={`Hanya ${row.pillarsAvailable} dari ${row.pillarsTotal} pilar tersedia — peringkat tidak setara`}>⚠</em>}</strong><b>{row.healthScore}</b><small>{row.comparable ? `${row.dataConfidence}% cakupan` : `${row.pillarsAvailable}/${row.pillarsTotal} pilar`}</small></div>)}</div>
        </div>
      </section>
    </>
  );
}

const floorStateLabel: Record<FloorStation["state"], string> = {
  controlled: "Terkendali",
  pressured: "Tertekan",
  breached: "Menembus ambang",
  partial: "Sebagian terbaca",
  unmeasured: "Tidak terukur",
};

const floorStageIcon: Record<FloorStation["stage"], typeof Boxes> = {
  Perencanaan: CalendarDays,
  Inbound: ScanLine,
  Inventory: Boxes,
  Outbound: Footprints,
  Dispatch: TrendingUp,
  Mutu: ShieldAlert,
};

const floorStages: Array<"Semua" | FloorStation["stage"]> = ["Semua", "Perencanaan", "Inbound", "Inventory", "Outbound", "Dispatch", "Mutu"];

function fmtSignal(signal: FloorSignal): string {
  if (signal.value === null) return "—";
  if (signal.unit === "percent") {
    // Loss rates live below 1%; rounding them to one decimal turns a real 0.06%
    // leak into a reassuring "0.1%". Small numbers get the precision they need.
    const precision = Math.abs(signal.value) < 1 ? 2 : 1;
    return `${signal.value.toLocaleString("id-ID", { minimumFractionDigits: precision, maximumFractionDigits: precision })}%`;
  }
  if (signal.unit === "currency") return new Intl.NumberFormat("id-ID", { notation: "compact", style: "currency", currency: "IDR", maximumFractionDigits: 1 }).format(signal.value);
  if (signal.unit === "mandays") return `${signal.value.toLocaleString("id-ID", { maximumFractionDigits: 1 })} MD`;
  return signal.value.toLocaleString("id-ID", { maximumFractionDigits: signal.unit === "ratio" ? 0 : 0 });
}

function FloorSignalRow({ signal }: { signal: FloorSignal }) {
  const coverage = Math.round(signal.coverage * 100);
  return (
    <div className={`floor-signal floor-signal--${signal.severity}`}>
      <div className="floor-signal__head">
        <span title={signal.floorNote}>{signal.label}</span>
        <b>{fmtSignal(signal)}</b>
      </div>
      <div className="floor-signal__meta">
        {/* Localised like the value above it: "0,06% vs ambang 0.2%" mixes two
            decimal conventions in one line. */}
        {signal.target === null ? <em>konteks</em> : <em>ambang {signal.target.toLocaleString("id-ID", { maximumFractionDigits: 2 })}{signal.unit === "percent" ? "%" : ""}</em>}
        <span className={`status-pill status-pill--${signal.severity === "good" ? "good" : signal.severity}`}>
          {signal.severity === "good" ? "Sesuai" : signal.severity === "watch" ? "Waspada" : signal.severity === "critical" ? "Lewat ambang" : "Konteks"}
        </span>
        <i className="floor-signal__coverage" aria-hidden="true"><i style={{ width: `${coverage}%` }} /></i>
        <small>{coverage}%</small>
      </div>
      <p>{signal.floorNote}</p>
    </div>
  );
}

function FloorStationCard({ station, highlighted, open, onToggle }: { station: FloorStation; highlighted: boolean; open: boolean; onToggle: (open: boolean) => void }) {
  const Icon = floorStageIcon[station.stage];
  const active = station.failureModes.filter((mode) => mode.active);
  const dormant = station.failureModes.filter((mode) => !mode.active);
  return (
    <article id={`station-${station.id}`} className={`floor-station floor-station--${station.state}${highlighted ? " is-constraint" : ""}`}>
      {/* The card collapses to its verdict line. Twelve fully expanded stations
          is a page nobody scrolls to the end of, so the ones the briefing put on
          today's walk open by default and the rest stay one click away. */}
      <details open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
      <summary className="floor-station__head">
        <span className="floor-station__seq">{String(station.sequence).padStart(2, "0")}</span>
        <div className="floor-station__title">
          <span className="floor-station__stage"><Icon size={13} />{station.stage}</span>
          <h3>{station.title}</h3>
          <div className="floor-station__meta">
            <span><Users size={13} />{station.owner}</span>
            <span><CalendarDays size={13} />{station.shiftMoment}</span>
          </div>
        </div>
        <div className="floor-station__verdict">
          <strong>{station.score === null ? "—" : station.score}</strong>
          <span className={`status-pill status-pill--${station.state === "controlled" ? "good" : station.state === "breached" ? "critical" : station.state === "pressured" ? "watch" : "neutral"}`}>{floorStateLabel[station.state]}</span>
          <ChevronDown size={16} className="floor-station__chevron" />
        </div>
        <p className="floor-station__reading"><Activity size={14} />{station.reading}</p>
      </summary>

      <p className="floor-station__purpose">{station.purpose}</p>

      {station.signals.length > 0 && <div className="floor-signal-grid">{station.signals.map((signal) => <FloorSignalRow key={signal.key} signal={signal} />)}</div>}

      {active.length > 0 && (
        <div className="floor-mode-list">
          {active.map((mode) => (
            <div className="floor-mode floor-mode--active" key={mode.id}>
              <header><AlertTriangle size={15} /><strong>{mode.title}</strong><small>{mode.owner}</small></header>
              <div className="floor-mode__body">
                <p className="floor-mode__symptom"><Eye size={13} />{mode.floorSymptom}</p>
                <div className="floor-mode__evidence">{mode.evidence.map((item) => <span key={item}>{item}</span>)}</div>
                <div className="floor-mode__actions">
                  <div><span>Tahan sekarang</span><p>{mode.containment}</p></div>
                  <div><span>Perbaiki penyebab</span><p>{mode.correction}</p></div>
                </div>
                <details className="floor-mode__causes"><summary>Kandidat akar masalah <ChevronDown size={14} /></summary><ul>{mode.rootCauses.map((cause) => <li key={cause}>{cause}</li>)}</ul></details>
              </div>
            </div>
          ))}
        </div>
      )}

      <details className="floor-protocol">
        <summary><span>Protokol WMS &amp; pengecekan lapangan</span><ChevronDown size={15} /></summary>
        <div className="floor-protocol__body">
          <section>
            <strong><ScanLine size={14} />Langkah di WMS</strong>
            <ol>{station.wmsSteps.map((step) => <li key={step}>{step}</li>)}</ol>
          </section>
          <section>
            <strong><Eye size={14} />Yang dicek langsung di lantai</strong>
            <ul>{station.gembaChecks.map((check) => <li key={check}>{check}</li>)}</ul>
          </section>
        </div>
        {dormant.length > 0 && (
          <div className="floor-dormant">
            <strong>Mode kegagalan yang tidak aktif pada rentang ini</strong>
            {dormant.map((mode) => <p key={mode.id}><CheckCircle2 size={13} /><b>{mode.title}</b> — pemicu: {mode.trigger}</p>)}
          </div>
        )}
      </details>

      <footer className="floor-station__foot">
        <p><ArrowRight size={14} /><span><b>Risiko serah terima.</b> {station.handoffRisk}</span></p>
        {station.unmeasured.length > 0 && (
          <div className="floor-unmeasured">
            <span>Belum terukur di stasiun ini</span>
            <div>{station.unmeasured.map((item) => <em key={item}>{item}</em>)}</div>
          </div>
        )}
      </footer>
      </details>
    </article>
  );
}

function FloorOperations({ data }: { data: AnalysisPayload }) {
  const [stage, setStage] = useState<"Semua" | FloorStation["stage"]>("Semua");
  // Explicit opens and closes override the default; the default is "the station
  // is over its line". Keyed by warehouse in the parent, so switching warehouse
  // recomputes the defaults instead of carrying another warehouse's choices.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const briefing = data.floorBriefing;
  const visible = data.floorStations.filter((station) => stage === "Semua" || station.stage === stage);
  const walkIds = new Set(briefing.walkOrder.map((step) => step.stationId));
  const isOpen = (station: FloorStation) => openOverrides[station.id] ?? walkIds.has(station.id);
  const openCount = data.floorStations.filter(isOpen).length;
  const setAll = (open: boolean) => setOpenOverrides(Object.fromEntries(data.floorStations.map((station) => [station.id, open])));
  const jumpTo = (id: string) => {
    setOpenOverrides((current) => ({ ...current, [id]: true }));
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`station-${id}`);
      target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    });
  };
  return (
    <>
      <PageIntro
        eyebrow="Lantai operasi"
        title="Setiap titik kerja, dari truk vendor sampai hub"
        description="Angkanya, langkah WMS-nya, dan yang harus dilihat langsung di lantai. Stasiun tanpa data ditandai tidak terukur—bukan aman."
        meta={`${briefing.measuredStations}/${briefing.totalStations} stasiun terukur · ${fmtDate(data.context.rangeStart)} — ${fmtDate(data.context.rangeEnd)}`}
      />

      <section className="floor-briefing" aria-labelledby="floor-briefing-title">
        <div className="floor-briefing__copy">
          <span className="eyebrow">Rute inspeksi shift ini</span>
          <h2 id="floor-briefing-title">{briefing.headline}</h2>
          <p>{briefing.narrative}</p>
          <div className="floor-briefing__counts">
            <span className="floor-count floor-count--breached"><b>{briefing.breachedCount}</b> menembus ambang</span>
            <span className="floor-count floor-count--pressured"><b>{briefing.pressuredCount}</b> tertekan</span>
            <span className="floor-count floor-count--unmeasured"><b>{briefing.unmeasuredCount}</b> tidak terukur</span>
          </div>
        </div>
        <ol className="floor-walk">
          {briefing.walkOrder.map((step, index) => (
            <li key={step.stationId}>
              <button type="button" onClick={() => jumpTo(step.stationId)}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{step.title}</strong><small>{step.reason}</small><p>{step.action}</p></div>
                <ChevronRight size={16} />
              </button>
            </li>
          ))}
          {!briefing.walkOrder.length && <li className="floor-walk__empty"><CheckCircle2 size={17} /><p>Tidak ada stasiun yang menembus ambang. Gunakan waktu shift untuk memverifikasi stasiun yang belum terukur.</p></li>}
        </ol>
      </section>

      <nav className="floor-chain" aria-label="Rantai proses">
        {data.floorStations.map((station) => (
          <button type="button" key={station.id} className={`floor-chip floor-chip--${station.state}${briefing.constraintStationId === station.id ? " is-constraint" : ""}`} onClick={() => jumpTo(station.id)}>
            <b>{String(station.sequence).padStart(2, "0")}</b>
            <span>{station.title}</span>
            <small>{floorStateLabel[station.state]}</small>
          </button>
        ))}
      </nav>

      <div className="floor-toolbar">
        <div className="segmented-control" aria-label="Filter tahap">
          {floorStages.map((item) => <button type="button" key={item} className={stage === item ? "active" : ""} onClick={() => setStage(item)}>{item}</button>)}
        </div>
        <div className="floor-toolbar__right">
          <small>{visible.length} stasiun ditampilkan · {openCount} terbuka</small>
          <button type="button" className="ghost-button" onClick={() => setAll(openCount < data.floorStations.length)}>
            {openCount < data.floorStations.length ? "Buka semua" : "Ringkas semua"}
          </button>
        </div>
      </div>

      <div className="floor-station-list">
        {visible.map((station) => (
          <FloorStationCard
            key={station.id}
            station={station}
            highlighted={briefing.constraintStationId === station.id}
            open={isOpen(station)}
            onToggle={(open) => setOpenOverrides((current) => ({ ...current, [station.id]: open }))}
          />
        ))}
      </div>
    </>
  );
}

function FlowIntelligence({ data }: { data: AnalysisPayload }) {
  const [mode, setMode] = useState<"inbound" | "outbound">("outbound");
  return (
    <>
      <PageIntro eyebrow="Alur volume" title="Dari rencana sampai diterima" description="Bandingkan rencana, aktual, pembatalan, siap kirim, hub, orang, dan kapasitas." meta={`${periodLabels[data.context.period]} · ${fmtDate(data.context.rangeStart)} — ${fmtDate(data.context.rangeEnd)}`} />
      <section className="panel chart-panel">
        <SectionHeader eyebrow={`${data.volumeFlow.length} hari`} title={mode === "outbound" ? "Forecast → request → RTS → hub" : "Forecast → aktual inbound"} description="Aktual menjadi dasar produktivitas; forecast menjadi acuan rencana." action={<div className="segmented-control"><button className={mode === "inbound" ? "active" : ""} onClick={() => setMode("inbound")}>Inbound</button><button className={mode === "outbound" ? "active" : ""} onClick={() => setMode("outbound")}>Outbound</button></div>} />
        <VolumeFlowChart points={data.volumeFlow} mode={mode} />
      </section>

      <section className="split-grid split-grid--wide-left">
        <div className="panel chart-panel">
          <SectionHeader eyebrow="Kebocoran" title="Di mana volume berkurang" description="Pisahkan yang dibatalkan, yang gagal dikerjakan, dan yang hilang setelah keluar gudang." />
          <FulfillmentFunnelChart stages={data.fulfillmentFunnel} />
          {/* Cumulative yield, not just step conversion: every step can look
              acceptable on its own while the chain end-to-end does not. */}
          <div className="yield-strip">
            {data.statistics.yieldChain.slice(1).map((stage) => (
              <div key={stage.key}>
                <span>{stage.label}</span>
                <strong>{stage.cumulativeYieldPct === null ? "—" : `${stage.cumulativeYieldPct.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}</strong>
                <small>{stage.lossQty === null ? "Tanpa pembanding" : `${stage.lossQty.toLocaleString("id-ID")} unit hilang${stage.lossSharePct === null || stage.lossQty === 0 ? "" : ` · ${stage.lossSharePct.toLocaleString("id-ID", { maximumFractionDigits: 0 })}% dari total bocor`}`}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="panel decision-sidebar">
          <SectionHeader eyebrow="Prioritas" title="Kendala utama" />
          {data.decisionInsights.filter((item) => ["Planning", "Outbound", "Labor economics"].includes(item.domain)).slice(0, 3).map((item) => <article key={item.id}><span>{item.domain}</span><strong>{item.title}</strong><p>{item.recommendedAction}</p></article>)}
          {!data.decisionInsights.some((item) => ["Planning", "Outbound", "Labor economics"].includes(item.domain)) && <div className="empty-state"><CheckCircle2 size={18} /><p>Tidak ada kebocoran besar pada rentang ini. Jaga ambangnya dan pantau perubahan harian.</p></div>}
        </div>
      </section>

      <section className="section-block">
        <SectionHeader eyebrow="Batas kendali" title="Hari aneh, atau memang begitu prosesnya?" description="Di dalam pita = naik-turun biasa. Di luar pita = ada penyebab khusus hari itu." />
        <div className="control-chart-grid">
          {data.statistics.controlCharts.map((chart) => (
            <div className={`panel chart-panel control-chart control-chart--${chart.state}`} key={chart.key}>
              <header><strong>{chart.label}</strong><span className={`status-pill status-pill--${chart.state === "stable" ? "good" : chart.state === "shifted" ? "watch" : "critical"}`}>{chart.state === "stable" ? "Stabil" : chart.state === "shifted" ? "Bergeser" : chart.state === "special_cause" ? "Penyebab khusus" : "Data kurang"}</span></header>
              {chart.state === "insufficient" ? <div className="empty-state"><Info size={17} /><p>{chart.finding}</p></div> : <><ControlChartView chart={chart} /><p className="control-chart__finding">{chart.finding}</p></>}
            </div>
          ))}
        </div>
      </section>

      <section className="panel chart-panel">
        <SectionHeader eyebrow="Orang" title="Pemakaian manday dan hasilnya" description="Keduanya berskala 100%. Manday di bawah budget hanya hemat kalau layanan tetap aman." />
        <LaborBalanceChart points={data.laborBalance} />
      </section>

      <section className="panel chart-panel">
        <SectionHeader eyebrow="Kapasitas zona" title="Ambient, chiller, dan frozen" description="Waspada 85%, kritis 92%. Hari kosong tetap kosong." />
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
      <PageIntro eyebrow="Penyebab & bukti" title="Pisahkan petunjuk dari penyebab" description="Hubungan 84 hari adalah petunjuk. Kebijakan tetap perlu uji dan bukti floor." meta={`84 hari · sampai ${fmtDate(data.context.asOf)}`} />
      <section className="section-block operational-thread-section">
        <SectionHeader eyebrow="Alur ujung ke ujung" title="Bagian yang tertekan atau terputus" description="Tahap kosong adalah gap keputusan, bukan kondisi normal." />
        <div className="operational-thread-grid">
          {data.operationalThreads.map((thread) => (
            <article className={`operational-thread operational-thread--${thread.state}`} key={thread.id}>
              <header><div><span>{thread.objective}</span><h3>{thread.title}</h3></div><div><strong>{thread.coveragePct}%</strong><small>{threadStateLabel[thread.state]}</small></div></header>
              <p className="thread-narrative">{thread.narrative}</p>
              <details className="thread-details"><summary>Lihat {thread.stages.length} tahap <ChevronDown size={15} /></summary><div className="thread-stage-rail">
                {thread.stages.map((stage, index) => <div className={`thread-stage thread-stage--${stage.state}`} key={stage.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{stage.label}</strong><small>{stage.domain}</small><p>{stage.reading}</p></div></div>)}
              </div></details>
              <footer><Target size={14} /><span>{thread.decisionUse}</span></footer>
            </article>
          ))}
        </div>
      </section>
      <section className="section-block causal-section">
        <SectionHeader eyebrow="Logika operasi" title="Jejak penyebab yang dapat diuji" description="Fakta, hipotesis, bukti penyeimbang, dan bukti yang kurang dipisahkan." />
        <div className="causal-chain-grid">
          {data.causalChains.map((chain) => (
            <article className={`causal-card causal-card--${chain.state}`} key={chain.id}>
              <header>
                <div><span>{chain.domain}</span><h3>{chain.title}</h3></div>
                <div className="causal-score"><strong>{chain.priorityScore}</strong><small>prioritas</small></div>
              </header>
              <div className="causal-badges"><span>{evidenceStateLabel[chain.state]}</span><span>Keyakinan {confidenceLabel[chain.confidence]}</span>{chain.linkedPainIds.length > 0 && <span>{chain.linkedPainIds.length} pain terkait</span>}</div>
              <p className="causal-cause">{chain.cause}</p>
              <div className="causal-outcome"><strong>Dampak sistem</strong><p>{chain.outcome}</p></div>
              <details className="causal-details"><summary>Lihat mekanisme dan bukti <ChevronDown size={15} /></summary><div>
                <ol className="causal-mechanism">{chain.mechanism.map((step) => <li key={step}>{step}</li>)}</ol>
                <div className="causal-evidence"><strong>Bukti aktif</strong>{chain.evidence.map((item) => <span key={item}><CheckCircle2 size={13} />{item}</span>)}</div>
                {chain.counterEvidence.length > 0 && <div className="causal-counter"><strong>Bukti penyeimbang</strong>{chain.counterEvidence.map((item) => <span key={item}>{item}</span>)}</div>}
                <div className="causal-missing"><strong>Bukti berikutnya</strong>{chain.missingEvidence.map((item) => <span key={item}>{item}</span>)}</div>
              </div></details>
              <footer><ArrowRight size={15} /><strong>{chain.recommendedAction}</strong></footer>
            </article>
          ))}
        </div>
      </section>
      <section className="split-grid split-grid--wide-left">
        <div className="panel chart-panel">
          <SectionHeader eyebrow="Hubungan statistik" title="Driver yang bergerak bersama hasil" description="Biru mendukung hipotesis, emas berlawanan, abu-abu belum meyakinkan." />
          <RelationshipChart signals={data.relationshipSignals} />
        </div>
        <div className="panel relationship-notice">
          <Info size={20} />
          <div><strong>Cara membaca</strong><p>Mulai dari hubungan sedang atau kuat. Uji per shift, hari, volume, dan observasi floor.</p></div>
          <div className="relationship-stats"><span><b>{data.relationshipSignals.filter((item) => item.survivesMultiplicity).length}</b> lolos koreksi</span><span><b>{data.relationshipSignals.filter((item) => item.sharedTerm).length}</b> formula beririsan</span><span><b>{data.relationshipSignals.filter((item) => item.alignment === "inconclusive").length}</b> belum pasti</span></div>
        </div>
      </section>

      <section className="section-block relationship-evidence">
        <SectionHeader eyebrow="Antrian bukti" title="Hubungan yang siap diuji" description="Siap diuji telah lolos koreksi dan tidak berbagi formula." action={<div className="segmented-control signal-filter" aria-label="Filter hubungan"><button className={signalFilter === "all" ? "active" : ""} onClick={() => setSignalFilter("all")}>Semua</button><button className={signalFilter === "actionable" ? "active" : ""} onClick={() => setSignalFilter("actionable")}>Siap diuji</button><button className={signalFilter === "validate" ? "active" : ""} onClick={() => setSignalFilter("validate")}>Perlu bukti</button></div>} />
        <div className="relationship-card-grid">
        {visibleSignals.map((signal) => (
          <article className={`relationship-card relationship-card--${signal.alignment}`} key={signal.id}>
            <header><span>{signal.driverDomain} → {signal.outcomeDomain}</span><b>{signal.coefficient === null ? "n/a" : `r ${signal.coefficient.toFixed(2)}`}</b></header>
            <h3>{signal.driverLabel} → {signal.outcomeLabel}</h3><p>{signal.narrative}</p>
            {signal.sharedTerm && <p className="relationship-confound"><AlertTriangle size={13} />Formula beririsan: kedua sisi memakai {signal.sharedTerm}.</p>}
            <div><span>{signal.strength}</span><span>n {signal.sampleSize}</span><span>jeda {signal.lagDays} hari</span><span>p {signal.pValue === null ? "n/a" : signal.pValue < 0.0001 ? "<0,0001" : signal.pValue.toFixed(4)}</span><span>keyakinan {confidenceLabel[signal.confidence]}</span></div>
            <footer><ArrowRight size={14} /><span>{signal.decision}</span></footer>
          </article>
        ))}
        {!visibleSignals.length && <div className="panel empty-state"><Info size={20} /><p>Tidak ada signal pada filter ini untuk cut-off aktif.</p></div>}
        </div>
      </section>

      <section className="section-block">
        <SectionHeader eyebrow="Masalah berulang" title="Masalah yang terus kembali" description="Angka yang lewat ambang digabung dengan catatan lapangan di Sheet." />
        <div className="diagnostic-grid">
          {data.painPoints.length ? data.painPoints.map((pain, index) => <article className="diagnostic-card" key={pain.id}><div className="diagnostic-card__index">0{index + 1}</div><div className="diagnostic-card__body"><div className="tag-row"><span>{pain.domain}</span><span>{pain.recurrenceWeeks}/8 minggu</span><span>bukti {pain.source}</span><span>dampak {pain.impactScore}</span></div><h3>{pain.title}</h3><p>{pain.hypothesis}</p><div className="evidence-box"><strong>Bukti terukur</strong>{pain.evidence.map((item) => <span key={item}>{item}</span>)}</div></div></article>) : <div className="panel empty-state"><Info size={20} /><p>Belum ada masalah berulang yang melewati ambang.</p></div>}
        </div>
      </section>

      <section className="panel">
        <SectionHeader eyebrow="Ambang" title="Tarik-menarik yang wajib dijaga" />
        <div className="guardrail-grid"><div><strong>Volume ↓, MP tetap</strong><span>Produktivitas bisa turun tanpa ada yang salah di proses.</span></div><div><strong>MP ↑</strong><span>SLA membaik, tapi hasil per orang bisa ikut turun.</span></div><div><strong>Actual MD &lt; budget</strong><span>Hemat hanya sah kalau SLA dan produktivitas ikut sehat.</span></div><div><strong>Cancel ↑</strong><span>Harus dibuktikan dengan sisa kapasitas, sisa jam, dan laju kerja.</span></div><div><strong>DCC ↓</strong><span>Telusuri SLOC, replenish, troubleshoot, Pick-to-PF, lalu picker.</span></div><div><strong>Capacity ≥ 92%</strong><span>Tambah volume atau orang berisiko membuat macet.</span></div></div>
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
    { key: "forecastChange", label: "Volume aktual", hint: "Perubahan workload yang masuk", min: -30, max: 35 },
    { key: "attendanceChange", label: "Kehadiran / mandays", hint: "Perubahan jumlah orang yang tersedia", min: -20, max: 20 },
    { key: "cancelChange", label: "Perubahan cancel", hint: "Negatif berarti cancel turun", min: -10, max: 10 },
    { key: "processGain", label: "Perbaikan proses", hint: "Dampak pickface, travel, rework, atau sistem", min: 0, max: 20 },
  ];
  return (
    <>
      <PageIntro eyebrow="Simulasi" title="Uji keputusan sebelum diterapkan" description="Lihat arah dampaknya sebelum diputuskan di lapangan." meta={`${data.context.warehouse} · ${periodLabels[data.context.period]}`} />
      <section className="simulation-layout">
        <div className="panel controls-panel">
          <div className="simulation-baseline"><SlidersHorizontal size={18} /><div><strong>Baseline {data.context.warehouse}</strong><span>Cut-off {fmtDate(data.context.asOf)}</span></div></div>
          {controls.map((control) => <label className="range-control" key={control.key}><div><span>{control.label}</span><output>{fmtSigned(inputs[control.key])}</output></div><p>{control.hint}</p><input type="range" min={control.min} max={control.max} step="1" value={inputs[control.key]} onChange={(event) => setInputs((current) => ({ ...current, [control.key]: Number(event.target.value) }))} /><div className="range-bounds"><span>{control.min}%</span><span>{control.max}%</span></div></label>)}
          <button className="secondary-button" onClick={() => setInputs({ forecastChange: 0, attendanceChange: 0, cancelChange: 0, processGain: 0 })}>Atur ulang</button>
        </div>
        <div className="panel chart-panel simulation-chart-panel">
          <SectionHeader eyebrow="Dampak arah" title="Perubahan terhadap baseline" description="Positif atau negatif adalah perubahan poin, bukan nilai akhir." />
          <SimulationImpactChart result={result} />
          <div className="model-notes model-notes--light"><strong>Catatan model</strong>{result.notes.map((note) => <p key={note}><Info size={14} />{note}</p>)}</div>
        </div>
      </section>
      <section className="baseline-grid"><div><span>Produktivitas</span><strong>{baseline.productivityAttainment.toFixed(1)}%</strong></div><div><span>SLA inbound</span><strong>{baseline.sla.toFixed(1)}%</strong></div><div><span>Demand fill</span><strong>{baseline.demandFill.toFixed(1)}%</strong></div><div><span>Kapasitas puncak</span><strong>{baseline.utilization.toFixed(1)}%</strong></div><div><span>Gap mandays</span><strong>{fmtSigned(baseline.mandaysGap)}</strong></div></section>
      <section className="panel assumption-panel"><Target size={19} /><div><strong>Batas model</strong><p>Volume, orang, proses, dan kapasitas saling tarik-menarik. Hasil ini untuk memilih uji coba, bukan ramalan angka.</p></div></section>
    </>
  );
}

function InitiativePortfolio({ data, openFloor }: { data: AnalysisPayload; openFloor: () => void }) {
  const stationTitle = (id: string) => data.floorStations.find((station) => station.id === id)?.title ?? id;
  const manpower = data.statistics.manpower.filter((item) => item.requiredMandays !== null);
  return (
    <>
      <PageIntro eyebrow="Rencana aksi" title="Dari masalah berulang ke uji yang terukur" description="Tiap aksi punya pemilik, tempat mengerjakannya, ukuran hasilnya, dan syarat berhenti." meta={`${data.initiatives.length} aksi · ${data.context.warehouse}`} />
      <section className="portfolio-overview">
        <div className="panel chart-panel"><SectionHeader eyebrow="Urutan" title="Kerjakan yang paling bernilai dulu" description="Garis 65 adalah ambang mulai." /><InitiativePriorityChart initiatives={data.initiatives} /></div>
        <div className="portfolio-summary">
          <article><Users size={17} /><span>Pemilik</span><strong>{new Set(data.initiatives.map((item) => item.owner)).size}</strong></article>
          <article><Target size={17} /><span>Keyakinan tinggi</span><strong>{data.initiatives.filter((item) => item.confidence === "high").length}</strong></article>
          <article><CalendarDays size={17} /><span>Tercepat</span><strong>{Math.min(...data.initiatives.map((item) => item.horizonDays))}h</strong></article>
          <article><Sparkles size={17} /><span>Prioritas tertinggi</span><strong>{Math.max(...data.initiatives.map((item) => item.priorityScore))}</strong></article>
        </div>
      </section>

      {manpower.length > 0 && (
        <section className="panel">
          <SectionHeader eyebrow="Orang" title="Beban kemarin butuh berapa orang" description="Kebutuhan = volume ÷ target produktivitas dari sumber. Bukan standar baru." />
          <div className="manpower-grid">
            {manpower.map((item) => (
              <article className={`manpower-card manpower-card--${item.verdict}`} key={item.key}>
                <header><span>{item.role}</span><b>{item.verdict === "short" ? "Kurang" : item.verdict === "surplus" ? "Lebih" : "Pas"}</b></header>
                <div className="manpower-card__pair">
                  <div><small>Butuh</small><strong>{fmtNumber(item.requiredMandays, 1)}</strong></div>
                  <div><small>Hadir</small><strong>{fmtNumber(item.actualMandays, 1)}</strong></div>
                  <div><small>Budget</small><strong>{fmtNumber(item.budgetMandays, 1)}</strong></div>
                </div>
                <p>{item.gapMandays === null ? "Selisih belum terbaca." : `Selisih ${item.gapMandays > 0 ? "+" : ""}${fmtNumber(item.gapMandays, 1)} MD terhadap kehadiran.`}</p>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="initiative-grid">
        {data.initiatives.map((initiative, index) => (
          <article className="initiative-card" key={initiative.id}>
            <header><span className="initiative-number">0{index + 1}</span><div><div className="tag-row"><span>{initiativeRoleLabel[initiative.portfolioRole]}</span><span>{initiativeTypeLabel[initiative.type]}</span><span>keyakinan {confidenceLabel[initiative.confidence]}</span><span>prioritas {initiative.priorityScore}</span></div><h3>{initiative.title}</h3><div className="initiative-meta"><span><Users size={13} />{initiative.owner}</span><span><BarChart3 size={13} />usaha {initiative.effort}</span><span><CalendarDays size={13} />{initiative.horizonDays} hari</span></div></div></header>
            <div className="initiative-adaptive"><div><span>Mengapa sekarang</span><strong>{initiative.whyNow}</strong></div><div><span>Mulai bila</span><strong>{initiative.trigger}</strong></div></div>
            {initiative.quantified.length > 0 && (
              <div className="initiative-prize">
                {initiative.quantified.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></div>)}
              </div>
            )}
            <div className="initiative-section initiative-section--impact"><span>Tindakan</span><p>{initiative.intervention}</p></div>
            {initiative.linkedStationIds.length > 0 && (
              <div className="initiative-stations">
                <span>Dikerjakan di</span>
                {initiative.linkedStationIds.map((id) => <button type="button" key={id} onClick={openFloor}>{stationTitle(id)}<ChevronRight size={13} /></button>)}
              </div>
            )}
            <div className="initiative-decision-gates"><div><span>Berhasil bila</span><strong>{initiative.successGate}</strong></div><div><span>Hentikan bila</span><strong>{initiative.stopLoss}</strong></div><div className="priority-breakdown"><span>Dasar prioritas</span><p><b>{initiative.priorityBreakdown.impact}</b> dampak · <b>{initiative.priorityBreakdown.recurrence}</b> berulang · <b>{initiative.priorityBreakdown.evidence}</b> bukti · <b>{initiative.priorityBreakdown.feasibility}</b> kelayakan</p></div></div>
            <details className="initiative-details"><summary>Detail uji dan 14 hari pertama <ChevronDown size={15} /></summary><div>
              <div className="initiative-experiment"><div><span>Pertanyaan keputusan</span><strong>{initiative.decisionQuestion}</strong></div><div><span>Hipotesis gugur bila</span><p>{initiative.counterfactual}</p></div><div><span>Indikator awal</span><p>{initiative.leadingIndicators.join(" · ")}</p></div></div>
              <div className="initiative-section"><span>Masalah</span><p>{initiative.problem}</p></div><div className="initiative-section initiative-section--impact"><span>Dampak yang dituju</span><p>{initiative.expectedImpact}</p></div>
              <div className="initiative-evidence"><strong>Bukti yang dipakai</strong>{initiative.evidence.map((item) => <span key={item}>{item}</span>)}</div>
              <div className="initiative-columns"><div><strong>Ukuran & guardrail</strong>{initiative.measurement.map((item) => <p key={item}><CheckCircle2 size={13} />{item}</p>)}</div><div><strong>14 hari pertama</strong>{initiative.first14Days.map((item) => <p key={item}><ChevronRight size={13} />{item}</p>)}</div></div>
            </div></details>
          </article>
        ))}
      </section>
    </>
  );
}

/** The five questions a single percentage cannot answer, answered from the
 *  active window. Placed on the cockpit because they are the sharpest thing the
 *  engine knows, not because they are statistics. */
function StatisticsReadout({ data, compact = false }: { data: AnalysisPayload; compact?: boolean }) {
  const readouts = compact ? data.statistics.readouts.slice(0, 3) : data.statistics.readouts;
  return (
    <div className="readout-grid">
      {readouts.map((item) => (
        <article className="readout" key={item.id}>
          <h3>{item.question}</h3>
          <p>{item.answer}</p>
          <details><summary>Cara menghitungnya <ChevronDown size={13} /></summary><p>{item.method}</p>{item.caveat && <p className="readout__caveat"><AlertTriangle size={12} />{item.caveat}</p>}</details>
        </article>
      ))}
    </div>
  );
}

function KnowledgeBase({ data }: { data: AnalysisPayload }) {
  const [group, setGroup] = useState<"Proses" | "Rumus" | "Aturan">("Proses");
  const [query, setQuery] = useState("");
  const articles = useMemo(() => data.knowledgeBase.filter((item) => {
    const matchesGroup = item.group === group;
    const haystack = `${item.domain} ${item.title} ${item.summary} ${item.body.join(" ")} ${item.formula ?? ""} ${item.basis ?? ""}`.toLowerCase();
    return matchesGroup && haystack.includes(query.toLowerCase());
  }), [data.knowledgeBase, group, query]);
  const domains = [...new Set(articles.map((item) => item.domain))];
  const groupHint: Record<typeof group, string> = {
    Proses: "Cara kerjanya dijalankan. Termasuk langkah yang belum terukur di sheet.",
    Rumus: "Setiap angka yang dihitung sistem ini, ditulis apa adanya.",
    Aturan: "Apa yang boleh dan tidak boleh disimpulkan dari sebuah angka.",
  };
  return (
    <>
      <PageIntro
        eyebrow="Pengetahuan"
        title="Cara kerja, rumus, dan aturan bacanya"
        description="Isi kepala tim operasi yang ditulis. Dibaca sambil berdiri, bukan sambil duduk."
        meta={`${data.knowledgeBase.length} catatan`}
      />

      <section className="panel">
        <SectionHeader eyebrow="Angka hari ini" title="Lima pertanyaan yang tidak bisa dijawab satu persen" description="Dihitung dari rentang yang sedang dibuka." />
        <StatisticsReadout data={data} />
      </section>

      <div className="knowledge-toolbar">
        <div className="segmented-control" aria-label="Pilih jenis catatan">
          {(["Proses", "Rumus", "Aturan"] as const).map((item) => <button type="button" key={item} className={group === item ? "active" : ""} onClick={() => setGroup(item)}>{item}</button>)}
        </div>
        <div className="search-box"><Search size={17} /><input aria-label="Cari catatan" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari proses, rumus, atau aturan" /><span>{articles.length}</span></div>
      </div>
      <p className="knowledge-hint">{groupHint[group]}</p>

      {domains.map((domain) => (
        <section className="knowledge-domain" key={domain}>
          <h2>{domain}</h2>
          <div className="knowledge-grid">
            {articles.filter((item) => item.domain === domain).map((item) => (
              <article className={`knowledge-card knowledge-card--${item.group.toLowerCase()}`} key={item.id}>
                <h3>{item.title}</h3>
                <p className="knowledge-card__summary">{item.summary}</p>
                {item.formula && <code className="knowledge-formula">{item.formula}</code>}
                <ul>{item.body.map((line) => <li key={line}>{line}</li>)}</ul>
                {item.basis && <footer><Info size={13} /><span>{item.basis}</span></footer>}
              </article>
            ))}
          </div>
        </section>
      ))}
      {!articles.length && <div className="panel empty-state"><Info size={18} /><p>Tidak ada catatan yang cocok.</p></div>}
    </>
  );
}

function MetricRegistry({ data }: { data: AnalysisPayload }) {
  const [query, setQuery] = useState("");
  const [readiness, setReadiness] = useState<"all" | AnalysisPayload["metricCatalog"][number]["readiness"]>("all");
  const [dataView, setDataView] = useState<"quality" | "definitions" | "pivot">("quality");
  const filtered = useMemo(() => data.pivotRows.filter((item) => `${item.division} ${item.role} ${item.metric} ${item.detail}`.toLowerCase().includes(query.toLowerCase())), [data.pivotRows, query]);
  const filteredSemantics = useMemo(() => data.metricCatalog.filter((item) => {
    const matchesQuery = `${item.division} ${item.role} ${item.remarks} ${item.metric} ${item.definition} ${item.decisionUse} ${item.inferenceBasis ?? ""} ${item.requiredContext.join(" ")} ${item.caveat ?? ""}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (readiness === "all" || item.readiness === readiness);
  }), [data.metricCatalog, query, readiness]);
  return (
    <>
      <PageIntro eyebrow="Data & definisi" title="Cek angka sebelum mengambil keputusan" description="Lihat kualitas sumber, definisi KPI, dan pivot periode dalam satu tempat." meta={`${data.pivotRows.length} metrik · ${data.metricCatalog.length} definisi`} />
      <div className="data-view-switch" role="tablist" aria-label="Pilih tampilan data"><button role="tab" aria-selected={dataView === "quality"} className={dataView === "quality" ? "active" : ""} onClick={() => setDataView("quality")}>Kualitas data</button><button role="tab" aria-selected={dataView === "definitions"} className={dataView === "definitions" ? "active" : ""} onClick={() => setDataView("definitions")}>Definisi</button><button role="tab" aria-selected={dataView === "pivot"} className={dataView === "pivot" ? "active" : ""} onClick={() => setDataView("pivot")}>Pivot periode</button></div>
      {dataView === "quality" && <>
      <section className="semantic-summary" aria-label="Ringkasan semantic layer">
        <article><span>Metrik sumber</span><strong>{data.intelligence.sourceMetrics}</strong><small>{data.intelligence.activeMetrics} aktif pada rentang</small></article>
        <article><span>Siap keputusan</span><strong>{data.intelligence.decisionReadyMetrics}</strong><small>terhubung ke logika analisis</small></article>
        <article><span>Diagnostik</span><strong>{data.intelligence.diagnosticMetrics}</strong><small>perlu bukti pendamping</small></article>
        <article><span>Observasi</span><strong>{data.intelligence.observationalMetrics}</strong><small>konteks, volume, atau plan</small></article>
        <article className={data.intelligence.unconfirmedMetrics ? "semantic-summary--warning" : ""}><span>Belum terkonfirmasi</span><strong>{data.intelligence.unconfirmedMetrics}</strong><small>tidak memicu rekomendasi</small></article>
        <article><span>Cakupan makna</span><strong>{data.intelligence.semanticCoveragePct}%</strong><small>punya konteks yang dapat dipakai</small></article>
      </section>
      <section className="definition-evidence-strip" aria-label="Kualitas definisi metric">
        <article><span>Definisi sumber</span><strong>{data.intelligence.documentedDefinitions}</strong><small>tertulis eksplisit pada glossary/source</small></article>
        <article><span>Inferensi terarah</span><strong>{data.intelligence.inferredDefinitions}</strong><small>pola jelas, tetap perlu owner confirmation</small></article>
        <article className={data.intelligence.unresolvedDefinitions ? "definition-evidence--warning" : ""}><span>Belum terselesaikan</span><strong>{data.intelligence.unresolvedDefinitions}</strong><small>diblokir dari keputusan</small></article>
      </section>
      <section className="panel domain-coverage-panel">
        <SectionHeader eyebrow="Cakupan fungsi" title="Fungsi yang cukup terukur" description="Metrik kosong tidak dianggap sehat." />
        <div className="domain-coverage-grid">{data.intelligence.domains.map((item) => <article key={item.domain}><header><strong>{item.domain}</strong><b>{item.activeCoveragePct}%</b></header><div><i style={{ width: `${item.activeCoveragePct}%` }} /></div><footer><span>{item.activeMetrics}/{item.totalMetrics} aktif</span><span>{item.decisionReadyMetrics} siap keputusan</span></footer></article>)}</div>
      </section>
      <section className="data-quality-strip"><div><span>Sumber</span><strong>{data.context.sourceName}</strong></div><div><span>Status</span><strong>{syncLabel(data, null).label}</strong></div><div><span>Sinkron terakhir</span><strong>{new Date(data.context.sync.lastSuccessAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</strong></div><div><span>Data terakhir</span><strong>{fmtDate(data.context.asOf)}</strong></div><div><span>Revisi</span><strong>{data.context.sync.revision ?? "Belum tercatat"}</strong></div><div><span>Cakupan KPI</span><strong>{data.health.confidence}%</strong></div></section>
      <section className={`sync-detail sync-detail--${data.context.sync.state}`}><Activity size={17} /><div><strong>{data.context.sync.message}</strong><p>{data.context.sync.rangesLoaded ? `${data.context.sync.rangesLoaded} rentang` : "Rentang tidak tercatat"} · {data.context.sync.cellsLoaded.toLocaleString("id-ID")} sel · {data.context.sync.latencyMs === null ? "durasi tidak tersedia" : `${data.context.sync.latencyMs.toLocaleString("id-ID")} ms`} · jeda operasi {data.context.operationalLagDays} hari.</p></div></section>
      {data.health.dataWarnings.length > 0 && <section className="warning-panel"><AlertTriangle size={20} /><div><strong>Guardrail kualitas aktif</strong>{data.health.dataWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div></section>}
      <section className="section-block context-gap-section">
        <SectionHeader eyebrow="Gap keputusan" title="Data yang paling perlu dilengkapi" description="Diurutkan dari yang paling menghambat keputusan." />
        <div className="context-gap-grid">
          {data.contextGaps.map((gap, index) => <article className={`context-gap-card context-gap-card--${gap.priority}`} key={gap.id}><header><span>0{index + 1} · {gap.domain}</span><b>{gap.priority}</b></header><h3>{gap.title}</h3><p>{gap.whyItMatters}</p><div><strong>Konteks yang sudah terbaca</strong>{gap.observedContext.map((item) => <span key={item}>{item}</span>)}</div><details><summary>Bukti yang perlu ditambahkan</summary><p>{gap.requiredEvidence.join(" · ")}</p></details><footer><span>{gap.owner}</span><strong>{gap.decisionUnlocked}</strong></footer></article>)}
          {!data.contextGaps.length && <div className="panel empty-state"><CheckCircle2 size={18} /><p>Tidak ada gap material pada rentang aktif.</p></div>}
        </div>
      </section>
      <section className="section-block operating-contract">
        <SectionHeader eyebrow="Aturan analisis" title="Cara KPI dibaca bersama" description="Satu angka tidak boleh membaik dengan mengorbankan angka lain." />
        <div className="operating-rule-grid">{data.intelligence.operatingRules.map((rule, index) => <details key={rule.id} open={index < 2}><summary><span>0{index + 1}</span><strong>{rule.title}</strong><ChevronDown size={15} /></summary><p>{rule.principle}</p><div><Target size={14} /><span>{rule.decisionGuardrail}</span></div></details>)}</div>
      </section>
      </>}
      {dataView === "definitions" &&
      <section className="panel semantic-registry">
        <SectionHeader eyebrow="Kamus metrik" title="Definisi dan aturan pakai" description="Metrik belum pasti tetap terlihat, tetapi tidak memicu skor atau aksi." action={<div className="segmented-control semantic-filter" aria-label="Filter kesiapan metrik"><button className={readiness === "all" ? "active" : ""} onClick={() => setReadiness("all")}>Semua</button><button className={readiness === "decision_ready" ? "active" : ""} onClick={() => setReadiness("decision_ready")}>Siap</button><button className={readiness === "diagnostic_only" ? "active" : ""} onClick={() => setReadiness("diagnostic_only")}>Diagnostik</button><button className={readiness === "observational" ? "active" : ""} onClick={() => setReadiness("observational")}>Observasi</button><button className={readiness === "unconfirmed" ? "active" : ""} onClick={() => setReadiness("unconfirmed")}>Belum pasti</button></div>} />
        <div className="semantic-toolbar"><div className="search-box"><Search size={17} /><input aria-label="Cari definisi metrik" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari metrik, definisi, fungsi, atau catatan" /><span>{filteredSemantics.length}</span></div><small>{filteredSemantics.filter((item) => item.activeCoverage > 0).length} metrik aktif</small></div>
        <div className="semantic-list">
          {filteredSemantics.slice(0, 160).map((item) => <details className={`semantic-item semantic-item--${item.readiness}`} key={item.id}><summary><div><span>{item.division} · {item.role}{item.remarks ? ` · ${item.remarks}` : ""}</span><strong>{item.metric}</strong></div><div><b>{readinessLabel[item.readiness]}</b><small>{definitionStatusLabel[item.definitionStatus]} · {Math.round(item.activeCoverage * 100)}% coverage</small><ChevronDown size={15} /></div></summary><div className="semantic-item__body"><section><span>Definisi · {definitionStatusLabel[item.definitionStatus]}</span><p>{item.definition}</p>{item.inferenceBasis && <small>Dasar: {item.inferenceBasis} · keyakinan {item.definitionConfidence}</small>}</section><section><span>Dipakai untuk</span><p>{item.decisionUse}</p></section><section><span>Posisi metric</span><p>{item.decisionRole} · {item.family} · {item.polarity.replaceAll("_", " ")}{item.remarks ? ` · ${item.remarks}` : ""}</p></section><section><span>Harus dibaca bersama</span><p>{item.relatedMetrics.join(" · ")}</p></section>{item.requiredContext.length > 0 && <section><span>Konteks yang masih dibutuhkan</span><p>{item.requiredContext.join(" · ")}</p></section>}{item.caveat && <div className="semantic-caveat"><AlertTriangle size={14} /><p>{item.caveat}</p></div>}</div></details>)}
          {!filteredSemantics.length && <div className="empty-state"><Info size={18} /><p>Tidak ada metrik yang cocok.</p></div>}
        </div>
      </section>}
      {dataView === "pivot" &&
      <section className="panel metric-panel">
        <div className="table-toolbar"><div><TableProperties size={17} /><span>Saat ini vs sebelumnya</span></div><div className="search-box"><Search size={17} /><input aria-label="Cari metrik" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari metrik, peran, atau fungsi" /><span>{filtered.length}</span></div></div>
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
      </section>}
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
  const [draftStartDate, setDraftStartDate] = useState("");
  const [draftEndDate, setDraftEndDate] = useState("");
  const [filterError, setFilterError] = useState<string | null>(null);
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
    setDraftStartDate("");
    setDraftEndDate("");
    setFilterError(null);
    setPeriod(nextPeriod);
  };

  const changeStartDate = (value: string) => {
    setDraftStartDate(value);
    setDraftEndDate((current) => current || endDate || data?.context.rangeEnd || value);
    setFilterError(null);
  };

  const changeEndDate = (value: string) => {
    setDraftEndDate(value);
    setDraftStartDate((current) => current || startDate || data?.context.rangeStart || value);
    setFilterError(null);
  };

  const applyDateRange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Read the submitted controls as the source of truth. This also covers
    // browser autofill and native date pickers that may commit on submit.
    const formData = new FormData(event.currentTarget);
    const nextStart = String(formData.get("startDate") || draftStartDate || startDate || data?.context.rangeStart || "");
    const nextEnd = String(formData.get("endDate") || draftEndDate || endDate || data?.context.rangeEnd || "");
    if (!nextStart || !nextEnd) return setFilterError("Isi tanggal mulai dan selesai.");
    if (nextStart > nextEnd) return setFilterError("Tanggal mulai tidak boleh melewati tanggal selesai.");
    const rangeDays = Math.floor((Date.parse(`${nextEnd}T00:00:00Z`) - Date.parse(`${nextStart}T00:00:00Z`)) / 86_400_000) + 1;
    if (rangeDays > 180) return setFilterError("Rentang maksimum 180 hari.");
    setStartDate(nextStart);
    setEndDate(nextEnd);
    setDraftStartDate("");
    setDraftEndDate("");
    setFilterError(null);
    setPeriod("custom");
  };

  const sourceState = syncLabel(data, error);
  const visibleStart = draftStartDate || startDate || data?.context.rangeStart || "";
  const visibleEnd = draftEndDate || endDate || data?.context.rangeEnd || "";
  const hasPendingRange = Boolean(draftStartDate || draftEndDate);

  return (
    <div className={`app-shell${navCollapsed ? " app-shell--nav-collapsed" : ""}`}>
      <a className="skip-link" href="#workspace-content">Lewati ke analisis utama</a>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><BarChart3 size={19} /></div><div className="brand-copy"><strong>NEXUS</strong><span>Operations Intelligence</span></div></div>
        <nav aria-label="Menu utama">
          {navGroups.map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-caption">{group}</span>
              {nav.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                const badge = item.id === "initiatives" ? data?.initiatives.length : item.id === "floor" ? data?.floorBriefing.breachedCount : undefined;
                return (
                  <button type="button" data-view={item.id} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} key={item.id} onClick={() => selectView(item.id)} title={item.label}>
                    <Icon size={18} />
                    <span className="nav-label-long">{item.label}</span>
                    <span className="nav-label-short">{item.short}</span>
                    {Boolean(badge) && <b className={item.id === "floor" ? "nav-badge--alert" : undefined}>{badge}</b>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className={`sidebar-status sidebar-status--${sourceState.tone}`}><div className="live-dot" /><div><strong>Sinkron data</strong><span>{error ? "Perlu diperiksa" : "Otomatis · 30 detik"}</span></div></div>
        <div className="sidebar-footer"><span>FIT Operations Intelligence</span><small>Realtime decision support</small></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="topbar-leading"><button type="button" className="menu-toggle" onClick={toggleNavigation} aria-label={navCollapsed ? "Tampilkan panel menu" : "Sembunyikan panel menu"} aria-expanded={!navCollapsed}>{navCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><div className="breadcrumb"><span>NEXUS</span><ChevronRight size={14} /><strong>{nav.find((item) => item.id === view)?.label}</strong></div></div><div className="topbar-actions"><div className={`source-chip source-chip--${sourceState.tone}`} title={data?.context.sync.message}><Activity size={14} /><span>{sourceState.label}</span></div><button className="refresh-button" onClick={() => void refresh(false, true)} aria-label="Sinkronkan data sekarang"><RefreshCw className={loading ? "spinning" : ""} size={16} /><span>Sinkronkan</span></button></div></header>

        <div className="content-area">
          <div className="context-line"><span>{warehouse} · {periodLabels[period]}</span><span>{lastRefresh ? `Dicek ${lastRefresh.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}` : "Menyambungkan data"}</span></div>
          <section className={`filter-console${filtersOpen ? " is-open" : ""}`} aria-label="Filter analisis">
            <div className="filter-console__title"><SlidersHorizontal size={18} /><div><strong>Filter</strong><span>WH dan tanggal berlaku di semua halaman</span></div><div className="filter-summary" aria-label="Filter aktif"><span>{warehouse}</span><span>{periodLabels[period]}</span>{period === "custom" && startDate && endDate && <span>{fmtDate(startDate)}–{fmtDate(endDate)}</span>}<span>{division === "All" ? "Semua fungsi" : division}</span></div><button type="button" className="filter-toggle" aria-expanded={filtersOpen} aria-controls="filter-console-body" onClick={() => setFiltersOpen((current) => !current)}>{filtersOpen ? "Tutup" : "Ubah"}<ChevronDown size={16} /></button></div>
            <form className="filter-console__body" id="filter-console-body" onSubmit={applyDateRange}>
              <div className="filter-console__fields">
              <FilterSelect label="Warehouse" value={warehouse} onChange={(value) => { setWarehouse(value as WarehouseCode); setDivision("All"); setRole("All"); setStartDate(""); setEndDate(""); setDraftStartDate(""); setDraftEndDate(""); setFilterError(null); setPeriod("weekly"); }}>{PRIORITY_WAREHOUSES.map((item) => <option value={item} key={item}>{item}</option>)}</FilterSelect>
              <FilterSelect label="Fungsi" value={division} onChange={(value) => { setDivision(value); setRole("All"); }}><option value="All">Semua fungsi</option>{(data?.filters.divisions ?? []).map((item) => <option value={item} key={item}>{item}</option>)}</FilterSelect>
              <FilterSelect label="Peran" value={role} onChange={setRole} disabled={!data}><option value="All">Semua peran</option>{(data?.filters.rolesByDivision[division] ?? data?.filters.rolesByDivision.All ?? []).map((item) => <option value={item} key={item}>{item}</option>)}</FilterSelect>
              <DateField label="Mulai" name="startDate" value={visibleStart} onChange={changeStartDate} minimum={data?.filters.minimumDate} maximum={visibleEnd || data?.filters.maximumDate} disabled={!data} />
              <DateField label="Selesai" name="endDate" value={visibleEnd} onChange={changeEndDate} minimum={visibleStart || data?.filters.minimumDate} maximum={data?.filters.maximumDate} disabled={!data} />
              </div>
              <div className="filter-range-actions">
                <div className="period-control"><span>Rentang cepat</span><div className="period-switcher" aria-label="Pilih rentang cepat">{presetPeriods.map((key) => <button type="button" className={period === key && !startDate ? "active" : ""} aria-pressed={period === key && !startDate} onClick={() => choosePreset(key)} key={key}>{key === "daily" ? "1 hari" : key === "weekly" ? "7 hari" : "30 hari"}</button>)}</div></div>
                <div className="date-apply-group">
                  {hasPendingRange && <button type="button" className="date-cancel-button" onClick={() => { setDraftStartDate(""); setDraftEndDate(""); setFilterError(null); }}>Batal</button>}
                  <button type="submit" className="date-apply-button" disabled={!visibleStart || !visibleEnd}>Terapkan rentang</button>
                </div>
              </div>
              {filterError && <p className="filter-error" role="alert">{filterError}</p>}
            </form>
          </section>

          <div id="workspace-content" className="workspace-content" ref={workspaceRef} tabIndex={-1} aria-live="polite" aria-label={nav.find((item) => item.id === view)?.label}>
          {error ? <section className="source-error"><AlertTriangle size={24} /><div><h2>Data belum dapat dibaca</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw size={15} />Coba lagi</button></div></section> : loading && !data ? <Skeleton /> : data ? <>
            {view === "overview" && <ExecutiveCockpit data={data} openInitiatives={() => selectView("initiatives")} openFloor={() => selectView("floor")} openKnowledge={() => selectView("knowledge")} />}
            {view === "floor" && <FloorOperations key={data.context.warehouse} data={data} />}
            {view === "flow" && <FlowIntelligence data={data} />}
            {view === "relationships" && <RelationshipLab data={data} />}
            {view === "simulation" && <ScenarioStudio data={data} />}
            {view === "initiatives" && <InitiativePortfolio data={data} openFloor={() => selectView("floor")} />}
            {view === "knowledge" && <KnowledgeBase data={data} />}
            {view === "data" && <MetricRegistry data={data} />}
          </> : <Skeleton />}
          </div>
        </div>
      </main>
    </div>
  );
}
