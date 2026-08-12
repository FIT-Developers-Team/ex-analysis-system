"use client";

import { ArrowDownRight, ArrowUpRight, Minus, ShieldAlert } from "lucide-react";
import type { MetricReading } from "@/lib/types";

function formatValue(metric: MetricReading): string {
  if (metric.value === null) return "–";
  if (metric.unit === "percent" || metric.unit === "ratio") return `${metric.value.toFixed(1)}%`;
  if (metric.unit === "mandays") return metric.value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  if (metric.unit === "currency") return new Intl.NumberFormat("id-ID", { notation: "compact", style: "currency", currency: "IDR" }).format(metric.value);
  return new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(metric.value);
}

export function KpiCard({ metric }: { metric: MetricReading }) {
  const TrendIcon = metric.trend === "up" ? ArrowUpRight : metric.trend === "down" ? ArrowDownRight : Minus;
  return (
    <article className={`kpi-card severity-${metric.severity}`}>
      <div className="kpi-card__top">
        <span>{metric.label}</span>
        {metric.coverage < 0.7 && <ShieldAlert size={15} aria-label="Coverage rendah" />}
      </div>
      <div className="kpi-card__value">{formatValue(metric)}</div>
      <div className="kpi-card__meta">
        <span className="kpi-delta"><TrendIcon size={13} />{metric.deltaPct === null ? "no prior" : `${Math.abs(metric.deltaPct).toFixed(1)}% vs prior`}</span>
        <span>{Math.round(metric.coverage * 100)}% coverage</span>
      </div>
      <p>{metric.interpretation}</p>
    </article>
  );
}
