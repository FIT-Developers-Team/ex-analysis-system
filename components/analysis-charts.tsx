"use client";

import dynamic from "next/dynamic";
import type { DriverSignal, TrendSeries, WarehouseComparisonRow } from "@/lib/types";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const palette = ["#1f63ff", "#f0a229", "#e36a50", "#768b47", "#af5d86", "#516170"];

export function TrendChart({ series }: { series: TrendSeries[] }) {
  const dates = series[0]?.values.map((item) => item.date) ?? [];
  const option = {
    color: palette,
    animationDuration: 350,
    tooltip: {
      trigger: "axis",
      backgroundColor: "#17202b",
      borderWidth: 0,
      textStyle: { color: "#fff", fontFamily: "Inter, system-ui, sans-serif", fontSize: 12 },
      valueFormatter: (value: number | null) => value === null ? "–" : `${Number(value).toFixed(1)}%`,
    },
    legend: { top: 0, left: 0, itemWidth: 18, itemHeight: 3, textStyle: { color: "#596778", fontSize: 11 } },
    grid: { left: 42, right: 20, top: 46, bottom: 34 },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: "#d9dfe7" } },
      axisTick: { show: false },
      axisLabel: { color: "#7a8797", formatter: (value: string) => value.slice(5), interval: 4 },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: (value: { max: number }) => Math.max(110, Math.ceil(value.max / 10) * 10),
      axisLabel: { color: "#7a8797", formatter: "{value}%" },
      splitLine: { lineStyle: { color: "#edf0f4" } },
    },
    series: series.map((item, index) => ({
      name: item.label,
      type: "line",
      data: item.values.map((point) => point.value === null ? null : Number(point.value.toFixed(2))),
      connectNulls: false,
      showSymbol: false,
      smooth: 0.22,
      lineStyle: { width: index === 0 ? 2.5 : 1.8, type: index > 2 ? "dashed" : "solid" },
      emphasis: { focus: "series" },
    })),
  };
  return <ReactECharts option={option} style={{ height: 330, width: "100%" }} notMerge lazyUpdate />;
}

export function DriverChart({ drivers }: { drivers: DriverSignal[] }) {
  const sorted = [...drivers].sort((a, b) => a.score - b.score);
  const option = {
    animationDuration: 350,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (params: Array<{ name: string; value: number }>) => `${params[0]?.name}<br/><strong>${params[0]?.value}/100</strong>` },
    grid: { left: 122, right: 28, top: 10, bottom: 24 },
    xAxis: { type: "value", min: 0, max: 100, axisLabel: { color: "#7a8797" }, splitLine: { lineStyle: { color: "#edf0f4" } } },
    yAxis: { type: "category", data: sorted.map((item) => item.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#596778", width: 112, overflow: "truncate" } },
    series: [{
      type: "bar",
      data: sorted.map((item) => ({ value: item.score, itemStyle: { color: item.score < 65 ? "#e36a50" : item.score < 85 ? "#f0a229" : "#1f63ff" } })),
      barWidth: 12,
      label: { show: true, position: "right", color: "#17202b", fontWeight: 700 },
      itemStyle: { borderRadius: [0, 3, 3, 0] },
      markLine: { silent: true, symbol: "none", lineStyle: { color: "#8a96a5", type: "dashed" }, data: [{ xAxis: 85, label: { formatter: "control", color: "#7a8797" } }] },
    }],
  };
  return <ReactECharts option={option} style={{ height: 290, width: "100%" }} notMerge lazyUpdate />;
}

export function HealthGauge({ score }: { score: number }) {
  const option = {
    animationDuration: 500,
    series: [{
      type: "gauge",
      startAngle: 205,
      endAngle: -25,
      min: 0,
      max: 100,
      radius: "95%",
      center: ["50%", "57%"],
      progress: { show: true, width: 12, itemStyle: { color: score < 65 ? "#e36a50" : score < 82 ? "#f0a229" : "#1f63ff" } },
      axisLine: { lineStyle: { width: 12, color: [[1, "#e7ebf0"]] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      pointer: { show: false },
      anchor: { show: false },
      detail: { valueAnimation: true, formatter: "{value}", offsetCenter: [0, "1%"], color: "#17202b", fontSize: 42, fontWeight: 760 },
      title: { show: true, offsetCenter: [0, "33%"], color: "#7a8797", fontSize: 11 },
      data: [{ value: score, name: "OPS HEALTH / 100" }],
    }],
  };
  return <ReactECharts option={option} style={{ height: 190, width: "100%" }} notMerge lazyUpdate />;
}

export function WarehouseComparisonChart({ rows }: { rows: WarehouseComparisonRow[] }) {
  const option = {
    color: ["#2563eb", "#0f9f8f", "#ea580c"],
    animationDuration: 350,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0, left: 0, itemWidth: 14, itemHeight: 4, textStyle: { color: "#596778", fontSize: 10 } },
    grid: { left: 38, right: 14, top: 42, bottom: 28 },
    xAxis: { type: "category", data: rows.map((row) => row.warehouse), axisTick: { show: false }, axisLine: { lineStyle: { color: "#dfe6f0" } }, axisLabel: { color: "#596778", fontWeight: 700 } },
    yAxis: { type: "value", min: 0, max: 110, axisLabel: { color: "#7a8797", formatter: "{value}%" }, splitLine: { lineStyle: { color: "#edf1f6" } } },
    series: [
      { name: "Productivity", type: "bar", barMaxWidth: 16, data: rows.map((row) => row.productivity), itemStyle: { borderRadius: [4, 4, 0, 0] } },
      { name: "Fulfillment", type: "bar", barMaxWidth: 16, data: rows.map((row) => row.fulfillment), itemStyle: { borderRadius: [4, 4, 0, 0] } },
      { name: "Cancel", type: "line", data: rows.map((row) => row.cancelRate), symbolSize: 7, lineStyle: { width: 2 } },
    ],
  };
  return <ReactECharts option={option} style={{ height: 285, width: "100%" }} notMerge lazyUpdate />;
}
