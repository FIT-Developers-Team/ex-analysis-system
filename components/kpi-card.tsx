"use client";

import { ArrowDownRight, ArrowUpRight, Minus, ShieldAlert } from "lucide-react";
import type { MetricReading, Severity } from "@/lib/types";

function formatValue(metric: MetricReading): string {
  if (metric.value === null) return "–";
  if (metric.unit === "percent" || metric.unit === "ratio") {
    const precision = metric.key === "fulfillment_rate" ? 2 : 1;
    return `${metric.value.toFixed(precision)}%`;
  }
  if (metric.unit === "mandays") return metric.value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  if (metric.unit === "currency") return new Intl.NumberFormat("id-ID", { notation: "compact", style: "currency", currency: "IDR" }).format(metric.value);
  return new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(metric.value);
}

function formatTarget(metric: MetricReading): string | null {
  if (metric.target === null) return null;
  if (metric.unit === "percent" || metric.unit === "ratio") return `${metric.target}%`;
  if (metric.unit === "currency") return new Intl.NumberFormat("id-ID", { notation: "compact", style: "currency", currency: "IDR" }).format(metric.target);
  return metric.target.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

// The engine's own verdict, spelled out. Colour alone used to be the only thing
// separating a breaching KPI from a healthy one, which is invisible to anyone
// who cannot distinguish the border tints.
const severityLabel: Record<Severity, string> = {
  good: "Sesuai",
  watch: "Waspada",
  critical: "Lewat ambang",
  neutral: "Tanpa data",
};

export function KpiCard({ metric }: { metric: MetricReading }) {
  const TrendIcon = metric.trend === "up" ? ArrowUpRight : metric.trend === "down" ? ArrowDownRight : Minus;
  const target = formatTarget(metric);
  const coverage = Math.round(metric.coverage * 100);
  const lowCoverage = metric.coverage < 0.7;

  return (
    <article className={`kpi-card kpi-card--${metric.severity}`}>
      <header className="kpi-card__head">
        <span className="kpi-card__label">{metric.label}</span>
        <span className={`status-pill status-pill--${metric.severity}`}>{severityLabel[metric.severity]}</span>
      </header>

      <div className="kpi-card__value">{formatValue(metric)}</div>

      <div className="kpi-card__against">
        {target && <span className="kpi-card__target">Guardrail <b>{target}</b></span>}
        {/* Signed, not absolute: the previous card stripped the sign with Math.abs
            and left the direction to an icon, so a cancel rate rising 13% and one
            falling 13% rendered identically. Deliberately not colour-coded —
            forecast accuracy and mandays variance are band metrics where "up" is
            not automatically good, so the status pill carries the verdict. */}
        {metric.deltaPct === null ? (
          <span className="kpi-card__delta kpi-card__delta--none">Tanpa pembanding</span>
        ) : (
          <span className="kpi-card__delta">
            <TrendIcon size={14} aria-hidden="true" />
            {/* Below 0.05 the signed figure rounds to "+0.0%", which reads as a
                movement that did not happen. Say it held instead. */}
            {Math.abs(metric.deltaPct) < 0.05
              ? "Tetap"
              : `${metric.deltaPct > 0 ? "+" : ""}${metric.deltaPct.toFixed(1)}% vs periode lalu`}
          </span>
        )}
      </div>

      <p className="kpi-card__note">{metric.interpretation}</p>

      <footer className={`kpi-card__coverage${lowCoverage ? " kpi-card__coverage--low" : ""}`}>
        {lowCoverage && <ShieldAlert size={14} aria-hidden="true" />}
        <div className="coverage-meter" role="presentation"><i style={{ width: `${coverage}%` }} /></div>
        <span>{coverage}% cakupan</span>
      </footer>
    </article>
  );
}
