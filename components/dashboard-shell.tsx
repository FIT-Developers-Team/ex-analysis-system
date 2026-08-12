"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Activity,
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
} from "lucide-react";
import { DriverChart, HealthGauge, TrendChart, WarehouseComparisonChart } from "@/components/analysis-charts";
import { KpiCard } from "@/components/kpi-card";
import { OperationsFlow } from "@/components/operations-flow";
import { runSimulation } from "@/lib/analysis/simulation";
import type { AnalysisPayload, Period, SimulationInputs, WarehouseCode } from "@/lib/types";
import { PRIORITY_WAREHOUSES } from "@/lib/types";

type View = "overview" | "diagnostic" | "simulation" | "initiatives" | "data";

const nav = [
  { id: "overview" as const, label: "Control tower", icon: LayoutDashboard },
  { id: "diagnostic" as const, label: "Flow diagnostic", icon: GitBranch },
  { id: "simulation" as const, label: "Scenario lab", icon: FlaskConical },
  { id: "initiatives" as const, label: "Initiative engine", icon: Lightbulb },
  { id: "data" as const, label: "Metric explorer", icon: Database },
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

function Skeleton() {
  return (
    <div className="loading-grid" aria-label="Memuat analisis">
      <div className="skeleton skeleton--hero" />
      <div className="skeleton" /><div className="skeleton" /><div className="skeleton" />
      <div className="skeleton skeleton--wide" />
    </div>
  );
}

function ControlTower({ data }: { data: AnalysisPayload }) {
  const priority = data.kpis.filter((item) => ["forecast_accuracy", "productivity_attainment", "fulfillment_rate", "mandays_variance", "capacity_utilization", "cancel_rate"].includes(item.key));
  return (
    <>
      <section className="intelligence-hero">
        <div className="hero-copy">
          <span className={`status-label status-label--${data.health.status}`}><CircleDot size={13} />{data.health.headline}</span>
          <h1>{data.context.warehouse} operations are <em>{data.health.status === "controlled" ? "in control" : "under pressure"}</em></h1>
          <p>{data.health.narrative}</p>
          <div className="hero-meta">
            <span><CalendarDays size={14} />{fmtDate(data.context.rangeStart)} — {fmtDate(data.context.rangeEnd)}</span>
            <span><Database size={14} />{data.health.confidence}% analytical confidence</span>
          </div>
        </div>
        <div className="health-gauge"><HealthGauge score={data.health.score} /></div>
      </section>

      <section className="kpi-strip">
        {priority.map((metric) => <KpiCard key={metric.key} metric={metric} />)}
      </section>

      <section className="panel flow-panel">
        <SectionHeader eyebrow="Connected operations core" title="One flow, shared consequences" description="Status setiap fungsi diturunkan dari KPI yang berkaitan—bukan dinilai sebagai silo." />
        <OperationsFlow modules={data.functionalModules} />
      </section>

      <section className="function-score-grid" aria-label="Functional operations health">
        {data.functionalModules.map((module) => (
          <article className={`function-score function-score--${module.status}`} key={module.division}>
            <div><span>{module.division}</span><strong>{module.status === "unavailable" ? "—" : module.score}</strong></div>
            <p>{module.headline}</p>
            <div className="function-score__bar"><i style={{ width: `${module.score}%` }} /></div>
          </article>
        ))}
      </section>

      <section className="panel capacity-panel">
        <SectionHeader eyebrow="Zonal capacity watch" title="Actual inventory versus physical maximum" description="Menggunakan latest available actual pada window aktif; warning 85% dan critical 92%." />
        <div className="capacity-grid">
          {data.capacityZones.map((zone) => (
            <article className={`capacity-zone capacity-zone--${zone.status}`} key={zone.zone}>
              <header><div><span>{zone.zone}</span><strong>{zone.utilization === null ? "—" : `${zone.utilization.toFixed(1)}%`}</strong></div><b>{zone.status}</b></header>
              <div className="capacity-track"><i style={{ width: `${Math.min(100, zone.utilization ?? 0)}%` }} /></div>
              <footer><span>Actual <b>{zone.actual?.toLocaleString("id-ID") ?? "—"}</b></span><span>Max <b>{zone.maximum?.toLocaleString("id-ID") ?? "—"}</b></span></footer>
            </article>
          ))}
        </div>
      </section>

      <section className="split-grid split-grid--wide-left">
        <div className="panel chart-panel">
          <SectionHeader eyebrow="28-day signal" title="Movement across the operating system" description="Persentase harian · gaps menunjukkan data belum tersedia atau tidak valid." />
          <TrendChart series={data.trends.slice(0, 4)} />
        </div>
        <div className="panel">
          <SectionHeader eyebrow="Attention order" title="Driver health" description="Skor di bawah 65 perlu tindakan terlebih dahulu." />
          <DriverChart drivers={data.drivers} />
        </div>
      </section>

      <section className="split-grid">
        <div className="panel">
          <SectionHeader eyebrow="Recurring pain" title="Patterns that keep coming back" />
          <div className="pain-list">
            {data.painPoints.length ? data.painPoints.slice(0, 3).map((pain) => (
              <article className="pain-row" key={pain.id}>
                <div className={`severity-mark severity-mark--${pain.severity}`} />
                <div><div className="pain-row__title"><strong>{pain.title}</strong><span>{pain.recurrenceWeeks}/8 weeks</span></div><p>{pain.hypothesis}</p></div>
                <ChevronRight size={17} />
              </article>
            )) : <div className="empty-state"><Info size={19} /><p>Belum ada pain point dengan evidence minimal dua minggu. Sistem tetap membuat validation initiative.</p></div>}
          </div>
        </div>
        <div className="panel panel--ink">
          <SectionHeader eyebrow="Next best action" title={data.initiatives[0]?.title ?? "Validate operating baseline"} />
          <p className="initiative-lead">{data.initiatives[0]?.intervention}</p>
          <div className="impact-box"><Sparkles size={18} /><div><span>Expected impact</span><strong>{data.initiatives[0]?.expectedImpact}</strong></div></div>
          <button className="text-button" onClick={() => document.querySelector<HTMLButtonElement>('[data-view="initiatives"]')?.click()}>Open initiative brief <ChevronRight size={15} /></button>
        </div>
      </section>

      <section className="panel comparison-panel">
        <SectionHeader eyebrow="Network benchmark" title="PGS · SRG · BIT · STR side by side" description="Perbandingan memakai period dan cut-off yang sama agar ranking tidak bias oleh jendela waktu." />
        <div className="comparison-layout">
          <WarehouseComparisonChart rows={data.warehouseComparison} />
          <div className="comparison-scoreboard">
            {[...data.warehouseComparison].sort((a, b) => b.healthScore - a.healthScore).map((row, index) => (
              <div key={row.warehouse}><span>#{index + 1}</span><strong>{row.warehouse}</strong><b>{row.healthScore}</b><small>{row.dataConfidence}% coverage</small></div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function Diagnostic({ data }: { data: AnalysisPayload }) {
  return (
    <>
      <SectionHeader eyebrow="Root-cause workspace" title="Follow the chain, not the symptom" description="Setiap temuan menampilkan recurrence, evidence, dan hipotesis yang perlu dibuktikan di floor." />
      <section className="panel flow-panel"><OperationsFlow modules={data.functionalModules} /></section>
      <section className="diagnostic-grid">
        {data.painPoints.length ? data.painPoints.map((pain, index) => (
          <article className="diagnostic-card" key={pain.id}>
            <div className="diagnostic-card__index">0{index + 1}</div>
            <div className="diagnostic-card__body">
              <div className="tag-row"><span>{pain.domain}</span><span>{pain.recurrenceWeeks} of 8 weeks</span><span>{pain.confidence} confidence</span></div>
              <h3>{pain.title}</h3>
              <p>{pain.hypothesis}</p>
              <div className="evidence-box"><strong>Observed evidence</strong>{pain.evidence.map((item) => <span key={item}>{item}</span>)}</div>
            </div>
          </article>
        )) : <div className="panel empty-state"><Info size={20} /><p>Belum ada recurrent breach yang memenuhi threshold. Gunakan Metric Explorer untuk memeriksa coverage dan definisi.</p></div>}
      </section>
      <section className="panel">
        <SectionHeader eyebrow="Guardrail matrix" title="Trade-offs the review must protect" />
        <div className="guardrail-grid">
          <div><strong>Volume ↓, MP tetap</strong><span>Productivity dapat turun tanpa process failure.</span></div>
          <div><strong>MP ↑</strong><span>SLA seharusnya membaik; productivity per manday dapat terdilusi.</span></div>
          <div><strong>Actual MD &lt; budget</strong><span>Savings hanya valid bila SLA dan productivity tetap sehat.</span></div>
          <div><strong>Cancel ↑</strong><span>Harus dibuktikan dengan capacity/run-rate, bukan asumsi shortage.</span></div>
          <div><strong>DCC memburuk</strong><span>Telusuri dampak ke SLOC, replenish, troubleshoot, dan picker.</span></div>
          <div><strong>Capacity ≥ 92%</strong><span>Tambahan volume/MP berisiko congestion dan queue.</span></div>
        </div>
      </section>
    </>
  );
}

function ScenarioLab({ data }: { data: AnalysisPayload }) {
  const [inputs, setInputs] = useState<SimulationInputs>({ forecastChange: 0, attendanceChange: 0, cancelChange: 0, processGain: 0 });
  const find = (key: string, fallback: number) => data.kpis.find((item) => item.key === key)?.value ?? fallback;
  const result = runSimulation({ productivityAttainment: find("productivity_attainment", 90), sla: find("sla_checker_inbound", 95), fulfillment: find("fulfillment_rate", 97), utilization: find("capacity_utilization", 75), mandaysGap: find("mandays_variance", 0) }, inputs);
  const controls: Array<{ key: keyof SimulationInputs; label: string; hint: string; min: number; max: number }> = [
    { key: "forecastChange", label: "Actual volume vs baseline", hint: "Perubahan workload yang benar-benar masuk", min: -30, max: 35 },
    { key: "attendanceChange", label: "Attendance / actual mandays", hint: "Perubahan MP tersedia", min: -20, max: 20 },
    { key: "cancelChange", label: "Cancel rate change", hint: "Negatif = lebih sedikit request dicancel", min: -10, max: 10 },
    { key: "processGain", label: "Process efficiency gain", hint: "Perbaikan pickface, travel, rework, atau system", min: 0, max: 20 },
  ];
  const outcomes = [
    ["Productivity", result.productivityChange], ["Inbound SLA", result.slaChange], ["Fulfillment", result.fulfillmentChange], ["Capacity load", result.utilizationChange], ["Mandays gap", result.mandaysGapChange],
  ] as const;
  return (
    <>
      <SectionHeader eyebrow="What-if simulator" title="Stress-test a decision before the floor feels it" description="Model heuristik transparan untuk directional planning—bukan pengganti forecast model atau time study." />
      <section className="simulation-layout">
        <div className="panel controls-panel">
          <div className="simulation-baseline"><SlidersHorizontal size={18} /><div><strong>{data.context.warehouse} baseline</strong><span>{periodLabels[data.context.period]} · as of {fmtDate(data.context.asOf)}</span></div></div>
          {controls.map((control) => (
            <label className="range-control" key={control.key}>
              <div><span>{control.label}</span><output>{fmtSigned(inputs[control.key])}</output></div>
              <p>{control.hint}</p>
              <input type="range" min={control.min} max={control.max} step="1" value={inputs[control.key]} onChange={(event) => setInputs((current) => ({ ...current, [control.key]: Number(event.target.value) }))} />
              <div className="range-bounds"><span>{control.min}%</span><span>{control.max}%</span></div>
            </label>
          ))}
          <button className="secondary-button" onClick={() => setInputs({ forecastChange: 0, attendanceChange: 0, cancelChange: 0, processGain: 0 })}>Reset scenario</button>
        </div>
        <div className="panel simulation-results">
          <span className="eyebrow">Projected movement</span>
          <div className="outcome-grid">
            {outcomes.map(([label, value]) => <div key={label}><span>{label}</span><strong className={value < 0 ? "is-negative" : value > 0 ? "is-positive" : ""}>{fmtSigned(value)}</strong><i style={{ width: `${Math.min(100, Math.abs(value) * 3)}%` }} /></div>)}
          </div>
          <div className="model-notes"><strong>Model interpretation</strong>{result.notes.map((note) => <p key={note}><Info size={14} />{note}</p>)}</div>
        </div>
      </section>
      <section className="panel assumption-panel">
        <Target size={19} /><div><strong>Model mechanics</strong><p>Volume memengaruhi output per fixed manday; attendance menambah SLA buffer tetapi bisa menurunkan productivity; process gain meningkatkan throughput; dampak dilunakkan saat capacity melewati 88%.</p></div>
      </section>
    </>
  );
}

function InitiativeEngine({ data }: { data: AnalysisPayload }) {
  return (
    <>
      <SectionHeader eyebrow="Prioritized transformation" title="Projects generated from recurring evidence" description="Minimal dua inisiatif per WH; setiap project memiliki outcome, guardrail, dan langkah 14 hari." />
      <section className="initiative-grid">
        {data.initiatives.map((initiative, index) => (
          <article className="initiative-card" key={initiative.id}>
            <header><span className="initiative-number">0{index + 1}</span><div><div className="tag-row"><span>{initiative.type}</span><span>{initiative.confidence} confidence</span></div><h3>{initiative.title}</h3></div></header>
            <div className="initiative-section"><span>Problem</span><p>{initiative.problem}</p></div>
            <div className="initiative-section"><span>Intervention</span><p>{initiative.intervention}</p></div>
            <div className="initiative-section initiative-section--impact"><span>Expected impact</span><p>{initiative.expectedImpact}</p></div>
            <div className="initiative-columns">
              <div><strong>Measure</strong>{initiative.measurement.map((item) => <p key={item}><CheckCircle2 size={13} />{item}</p>)}</div>
              <div><strong>First 14 days</strong>{initiative.first14Days.map((item) => <p key={item}><ChevronRight size={13} />{item}</p>)}</div>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function MetricExplorer({ data }: { data: AnalysisPayload }) {
  const [query, setQuery] = useState("");
  const filtered = data.pivotRows.filter((item) => `${item.division} ${item.role} ${item.metric} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <SectionHeader eyebrow="Pivot intelligence" title={`${data.pivotRows.length} metrics in the active cut`} description="Setiap baris dihitung dengan aggregation rule, period comparison, coverage, dan arah pergerakan yang konsisten." />
      <section className="data-quality-strip">
        <div><span>Source</span><strong>{data.context.sourceName}</strong></div>
        <div><span>Read mode</span><strong>{data.context.sourceMode === "google" ? "Google batch API" : data.context.sourceMode === "snapshot" ? "Optimized snapshot" : "Local workbook"}</strong></div>
        <div><span>Latest actual</span><strong>{fmtDate(data.context.asOf)}</strong></div>
        <div><span>Confidence</span><strong>{data.health.confidence}%</strong></div>
      </section>
      {data.health.dataWarnings.length > 0 && <section className="warning-panel"><AlertTriangle size={20} /><div><strong>Quality guardrails active</strong>{data.health.dataWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div></section>}
      <section className="panel metric-panel">
        <div className="table-toolbar"><div><TableProperties size={17} /><span>Period pivot · current vs previous</span></div><div className="search-box"><Search size={17} /><input aria-label="Cari metric" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search metric or role" /><span>{filtered.length}</span></div></div>
        <div className="metric-table" role="table">
          <div className="metric-row metric-row--pivot metric-row--head" role="row"><span>Function / role</span><span>Metric</span><span>Aggregation</span><span>Current</span><span>Previous</span><span>Delta</span><span>Coverage</span></div>
          {filtered.slice(0, 250).map((item) => (
            <div className="metric-row metric-row--pivot" role="row" key={item.id}>
              <span><b>{item.division}</b><small>{item.role}</small></span>
              <strong title={item.detail}>{item.metric}</strong>
              <span className="aggregation-pill">{item.aggregation}</span>
              <b>{fmtMetric(item.current, item.unit)}</b>
              <span>{fmtMetric(item.previous, item.unit)}</span>
              <span className={`movement movement--${item.movement}`}>{item.deltaPct === null ? "—" : fmtSigned(item.deltaPct)}</span>
              <span>{Math.round(item.coverage * 100)}%</span>
            </div>
          ))}
        </div>
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

  const refresh = useCallback(async (quiet = false, force = false) => {
    if (!quiet) setLoading(true);
    try {
      const query = new URLSearchParams({ warehouse, period, division, role });
      if (asOf) query.set("asOf", asOf);
      if (force) query.set("refresh", "1");
      const response = await fetch(`/api/analysis?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json() as AnalysisPayload & { error?: string; detail?: string; remediation?: string };
      if (!response.ok) throw new Error([payload.error, payload.detail, payload.remediation].filter(Boolean).join(" — "));
      setData(payload);
      setError(null);
      setLastRefresh(new Date());
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
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><BarChart3 size={19} /></div><div><strong>NEXUS</strong><span>Excellence Analysis</span></div></div>
        <nav aria-label="Primary">
          <span className="nav-caption">Workspace</span>
          {nav.map((item) => { const Icon = item.icon; return <button data-view={item.id} className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}><Icon size={17} /><span>{item.label}</span>{item.id === "initiatives" && data && <b>{data.initiatives.length}</b>}</button>; })}
        </nav>
        <div className="sidebar-status">
          <div className="live-dot" />
          <div><strong>Source monitor</strong><span>{error ? "Connection needs attention" : "Auto-refresh · 60 sec"}</span></div>
        </div>
        <div className="sidebar-footer"><span>FIT Operations Intelligence</span><small>v0.2 · 100% open stack</small></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>FIT Ops Intelligence</span><ChevronRight size={14} /><strong>{nav.find((item) => item.id === view)?.label}</strong></div>
          <div className="topbar-actions">
            <div className={`source-chip source-chip--${error ? "error" : "live"}`}><Activity size={14} /><span>{data?.context.sourceMode === "google" ? "Google live" : data?.context.sourceMode === "snapshot" ? "Snapshot fast-path" : "Local source"}</span></div>
            <button className="refresh-button" onClick={() => void refresh(false, true)} aria-label="Refresh source"><RefreshCw className={loading ? "spinning" : ""} size={16} /><span>Sync now</span></button>
          </div>
        </header>

        <div className="content-area">
          <div className="context-line"><span>{warehouse} · {periodLabels[period]} intelligence</span><span>{lastRefresh ? `Refreshed ${lastRefresh.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}` : "Connecting to source"}</span></div>
          <section className="filter-console" aria-label="Analysis filters">
            <div className="filter-console__title"><SlidersHorizontal size={17} /><div><strong>Analysis scope</strong><span>Semua view mengikuti cut-off yang sama</span></div></div>
            <div className="filter-console__fields">
              <FilterSelect label="Warehouse" value={warehouse} onChange={(value) => { setWarehouse(value as WarehouseCode); setDivision("All"); setRole("All"); setAsOf(""); }}>
                {PRIORITY_WAREHOUSES.map((item) => <option value={item} key={item}>{item}</option>)}
              </FilterSelect>
              <FilterSelect label="Function" value={division} onChange={(value) => { setDivision(value); setRole("All"); }}>
                <option value="All">All functions</option>
                {(data?.filters.divisions ?? []).map((item) => <option value={item} key={item}>{item}</option>)}
              </FilterSelect>
              <FilterSelect label="Role" value={role} onChange={setRole} disabled={!data}>
                <option value="All">All roles</option>
                {(data?.filters.rolesByDivision[division] ?? data?.filters.rolesByDivision.All ?? []).map((item) => <option value={item} key={item}>{item}</option>)}
              </FilterSelect>
              <FilterSelect label="Data cut-off" value={asOf} onChange={setAsOf} disabled={!data}>
                <option value="">Latest actual</option>
                {(data?.filters.availableDates ?? []).map((item) => <option value={item} key={item}>{fmtDate(item)}</option>)}
              </FilterSelect>
            </div>
            <div className="period-control"><span>View</span><div className="period-switcher" aria-label="Period">{Object.entries(periodLabels).map(([key, label]) => <button className={period === key ? "active" : ""} onClick={() => setPeriod(key as Period)} key={key}>{label}</button>)}</div></div>
          </section>
          {error ? <section className="source-error"><AlertTriangle size={24} /><div><h2>Live source belum terhubung</h2><p>{error}</p><button onClick={() => void refresh()}><RefreshCw size={15} />Retry connection</button></div></section> : loading && !data ? <Skeleton /> : data ? (
            <>
              {view === "overview" && <ControlTower data={data} />}
              {view === "diagnostic" && <Diagnostic data={data} />}
              {view === "simulation" && <ScenarioLab data={data} />}
              {view === "initiatives" && <InitiativeEngine data={data} />}
              {view === "data" && <MetricExplorer data={data} />}
            </>
          ) : <Skeleton />}
        </div>
      </main>
    </div>
  );
}
