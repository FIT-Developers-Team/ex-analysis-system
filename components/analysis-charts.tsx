"use client";

import dynamic from "next/dynamic";
import type {
  CapacityHistoryPoint,
  DriverSignal,
  FlowStage,
  Initiative,
  LaborBalancePoint,
  RelationshipSignal,
  RiskMatrix,
  SimulationResult,
  TrendSeries,
  VolumeFlowPoint,
  WarehouseComparisonRow,
} from "@/lib/types";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const palette = ["#2563eb", "#0f9f8f", "#f0a229", "#e36a50", "#768b47", "#af5d86", "#516170"];
const axis = { axisLine: { lineStyle: { color: "#dfe6f0" } }, axisTick: { show: false }, axisLabel: { color: "#738092", fontSize: 10 } };
const split = { lineStyle: { color: "#edf0f4" } };
const tooltip = { backgroundColor: "#10213a", borderWidth: 0, textStyle: { color: "#fff", fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 }, extraCssText: "border-radius:8px;box-shadow:0 12px 30px rgba(16,33,58,.18)" };
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("id-ID", { maximumFractionDigits: 1 });

function Chart({ option, height = 320 }: { option: Record<string, unknown>; height?: number }) {
  return <ReactECharts option={option} style={{ height, width: "100%" }} notMerge lazyUpdate />;
}

export function TrendChart({ series }: { series: TrendSeries[] }) {
  const dates = series[0]?.values.map((item) => item.date) ?? [];
  return <Chart height={330} option={{
    color: palette,
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "axis", valueFormatter: (value: number | null) => value === null ? "—" : `${Number(value).toFixed(1)}%` },
    legend: { top: 0, left: 0, itemWidth: 17, itemHeight: 3, textStyle: { color: "#596778", fontSize: 10 } },
    grid: { left: 46, right: 20, top: 48, bottom: 32 },
    xAxis: { type: "category", data: dates, boundaryGap: false, ...axis, axisLabel: { color: "#738092", fontSize: 9, formatter: (value: string) => value.slice(5), interval: 4 } },
    yAxis: { type: "value", min: 0, max: (value: { max: number }) => Math.max(110, Math.ceil(value.max / 10) * 10), axisLabel: { color: "#738092", fontSize: 9, formatter: "{value}%" }, splitLine: split },
    series: series.map((item, index) => ({ name: item.label, type: "line", data: item.values.map((point) => point.value === null ? null : Number(point.value.toFixed(2))), connectNulls: false, showSymbol: false, smooth: 0.2, lineStyle: { width: index === 0 ? 2.6 : 1.8, type: index > 3 ? "dashed" : "solid" }, emphasis: { focus: "series" } })),
  }} />;
}

export function VolumeFlowChart({ points, mode }: { points: VolumeFlowPoint[]; mode: "inbound" | "outbound" }) {
  const inbound = [
    { name: "Forecast inbound", key: "inboundForecast", color: palette[0], type: "line" },
    { name: "Actual inbound", key: "inboundActual", color: palette[1], type: "bar" },
  ] as const;
  const outbound = [
    { name: "Forecast", key: "outboundForecast", color: palette[0], type: "line" },
    { name: "Before cancel", key: "beforeCancel", color: palette[2], type: "line" },
    { name: "After cancel", key: "afterCancel", color: palette[3], type: "line" },
    { name: "RTS", key: "rts", color: palette[1], type: "bar" },
    { name: "Hub received", key: "hubReceived", color: palette[4], type: "line" },
  ] as const;
  const definitions = mode === "inbound" ? inbound : outbound;
  return <Chart height={350} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "axis" },
    legend: { top: 0, left: 0, itemWidth: 16, itemHeight: 4, textStyle: { color: "#596778", fontSize: 9 } },
    grid: { left: 62, right: 22, top: 48, bottom: 34 },
    xAxis: { type: "category", data: points.map((point) => point.date), ...axis, axisLabel: { color: "#738092", fontSize: 9, formatter: (value: string) => value.slice(5), interval: 3 } },
    yAxis: { type: "value", ...axis, axisLabel: { color: "#738092", fontSize: 9, formatter: (value: number) => Intl.NumberFormat("id-ID", { notation: "compact" }).format(value) }, splitLine: split },
    series: definitions.map((definition) => ({ name: definition.name, type: definition.type, data: points.map((point) => point[definition.key]), itemStyle: { color: definition.color, borderRadius: definition.type === "bar" ? [3, 3, 0, 0] : 0 }, lineStyle: { color: definition.color, width: 2 }, showSymbol: false, smooth: 0.16, barMaxWidth: 13, connectNulls: false })),
  }} />;
}

export function FulfillmentFunnelChart({ stages }: { stages: FlowStage[] }) {
  const available = stages.filter((stage) => stage.value !== null);
  const max = Math.max(1, ...available.map((stage) => stage.value ?? 0));
  return <Chart height={318} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "item", formatter: (params: { name: string; value: number; dataIndex: number }) => { const stage = available[params.dataIndex]; return `<strong>${params.name}</strong><br/>Qty ${number(params.value)}<br/>Step conversion ${number(stage?.conversionPct)}%<br/>Loss ${number(stage?.lossQty)}`; } },
    grid: { left: 142, right: 38, top: 8, bottom: 20 },
    xAxis: { type: "value", max, axisLabel: { color: "#738092", fontSize: 9, formatter: (value: number) => Intl.NumberFormat("id-ID", { notation: "compact" }).format(value) }, splitLine: split },
    yAxis: { type: "category", inverse: true, data: available.map((stage) => stage.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#34445c", fontSize: 10 } },
    series: [{ type: "bar", barWidth: 21, data: available.map((stage) => ({ value: stage.value, itemStyle: { color: stage.status === "critical" ? palette[3] : stage.status === "watch" ? palette[2] : palette[0], borderRadius: [0, 5, 5, 0] }, label: { show: true, position: "right", color: "#34445c", fontSize: 9, fontWeight: 700, formatter: ({ value }: { value: number }) => Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(value) } })) }],
  }} />;
}

export function LaborBalanceChart({ points }: { points: LaborBalancePoint[] }) {
  return <Chart height={350} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "axis" },
    legend: { top: 0, left: 0, itemWidth: 16, itemHeight: 4, textStyle: { color: "#596778", fontSize: 9 } },
    grid: { left: 44, right: 48, top: 48, bottom: 34 },
    xAxis: { type: "category", data: points.map((point) => point.date), ...axis, axisLabel: { color: "#738092", fontSize: 9, formatter: (value: string) => value.slice(5), interval: 3 } },
    yAxis: [
      { type: "value", name: "Mandays", nameTextStyle: { color: "#738092", fontSize: 9 }, axisLabel: { color: "#738092", fontSize: 9 }, splitLine: split },
      { type: "value", name: "%", min: 0, nameTextStyle: { color: "#738092", fontSize: 9 }, axisLabel: { color: "#738092", fontSize: 9, formatter: "{value}%" }, splitLine: { show: false } },
    ],
    series: [
      { name: "Budget MD", type: "bar", data: points.map((point) => point.budgetMandays), barMaxWidth: 10, itemStyle: { color: "#bfd0f8", borderRadius: [3, 3, 0, 0] } },
      { name: "Actual MD", type: "bar", data: points.map((point) => point.actualMandays), barMaxWidth: 10, itemStyle: { color: palette[0], borderRadius: [3, 3, 0, 0] } },
      { name: "Productivity", type: "line", yAxisIndex: 1, data: points.map((point) => point.productivity), showSymbol: false, connectNulls: false, lineStyle: { color: palette[3], width: 2.2 }, itemStyle: { color: palette[3] }, markLine: { symbol: "none", silent: true, lineStyle: { color: "#e36a50", type: "dashed", opacity: 0.55 }, data: [{ yAxis: 100, label: { formatter: "target", color: "#738092", fontSize: 8 } }] } },
    ],
  }} />;
}

export function CapacityHistoryChart({ points }: { points: CapacityHistoryPoint[] }) {
  const definitions = [
    { key: "ambient", name: "Ambient", color: palette[0] },
    { key: "chiller", name: "Chiller", color: palette[1] },
    { key: "frozen", name: "Frozen", color: palette[5] },
  ] as const;
  return <Chart height={340} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "axis", valueFormatter: (value: number | null) => value == null ? "—" : `${Number(value).toFixed(1)}%` },
    legend: { top: 0, left: 0, itemWidth: 16, itemHeight: 4, textStyle: { color: "#596778", fontSize: 9 } },
    grid: { left: 46, right: 22, top: 46, bottom: 32 },
    xAxis: { type: "category", data: points.map((point) => point.date), boundaryGap: false, ...axis, axisLabel: { color: "#738092", fontSize: 9, formatter: (value: string) => value.slice(5), interval: 3 } },
    yAxis: { type: "value", min: 0, max: (value: { max: number }) => Math.max(100, Math.ceil(value.max / 10) * 10), axisLabel: { color: "#738092", fontSize: 9, formatter: "{value}%" }, splitLine: split },
    series: definitions.map((definition, index) => ({ name: definition.name, type: "line", data: points.map((point) => point[definition.key]), showSymbol: false, connectNulls: false, smooth: 0.18, lineStyle: { width: 2, color: definition.color }, itemStyle: { color: definition.color }, areaStyle: { color: definition.color, opacity: 0.035 }, markLine: index === 0 ? { symbol: "none", silent: true, lineStyle: { type: "dashed" }, data: [{ yAxis: 85, lineStyle: { color: palette[2] }, label: { formatter: "warning 85", color: "#94620f", fontSize: 8 } }, { yAxis: 92, lineStyle: { color: palette[3] }, label: { formatter: "critical 92", color: "#aa4935", fontSize: 8 } }] } : undefined })),
  }} />;
}

export function RelationshipChart({ signals }: { signals: RelationshipSignal[] }) {
  const data = [...signals].filter((signal) => signal.coefficient !== null).sort((a, b) => (a.coefficient ?? 0) - (b.coefficient ?? 0));
  return <Chart height={Math.max(330, data.length * 42)} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "item", formatter: (params: { dataIndex: number; value: number }) => { const signal = data[params.dataIndex]; return `<strong>${signal.driverLabel} → ${signal.outcomeLabel}</strong><br/>r ${Number(params.value).toFixed(2)} · n ${signal.sampleSize}<br/>${signal.strength} · ${signal.confidence} confidence<br/>${signal.alignment}`; } },
    grid: { left: 198, right: 58, top: 16, bottom: 30 },
    xAxis: { type: "value", min: -1, max: 1, axisLabel: { color: "#738092", fontSize: 9 }, splitLine: split },
    yAxis: { type: "category", data: data.map((signal) => `${signal.driverLabel} → ${signal.outcomeLabel}`), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#34445c", fontSize: 9, width: 184, overflow: "truncate" } },
    series: [{ type: "bar", barWidth: 13, data: data.map((signal) => ({ value: signal.coefficient, itemStyle: { color: signal.alignment === "supports" ? palette[0] : signal.alignment === "contradicts" ? palette[2] : "#a8b2c0", borderRadius: signal.coefficient && signal.coefficient < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0] }, label: { show: true, position: signal.coefficient && signal.coefficient < 0 ? "left" : "right", color: "#34445c", fontSize: 9, formatter: ({ value }: { value: number }) => Number(value).toFixed(2) } })), markLine: { symbol: "none", silent: true, lineStyle: { color: "#8793a4" }, data: [{ xAxis: 0 }] } }],
  }} />;
}

export function RiskHeatmapChart({ matrix }: { matrix: RiskMatrix }) {
  const data = matrix.rows.flatMap((row, y) => row.values.flatMap((value, x) => value === null ? [] : [[x, y, value]]));
  return <Chart height={350} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, position: "top", formatter: (params: { value: [number, number, number] }) => `${matrix.rows[params.value[1]]?.domain}<br/><strong>Risk ${params.value[2]}/100</strong><br/>${matrix.weeks[params.value[0]]}` },
    grid: { left: 92, right: 20, top: 18, bottom: 55 },
    xAxis: { type: "category", data: matrix.weeks, splitArea: { show: true, areaStyle: { color: ["#fbfcfe", "#f6f8fb"] } }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#738092", fontSize: 8, rotate: 28 } },
    yAxis: { type: "category", data: matrix.rows.map((row) => row.domain), splitArea: { show: true }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#34445c", fontSize: 9 } },
    visualMap: { min: 0, max: 80, show: false, inRange: { color: ["#eef4ff", "#bad0fa", "#f6d291", "#e36a50"] } },
    series: [{ type: "heatmap", data, label: { show: true, color: "#10213a", fontSize: 8, formatter: ({ value }: { value: [number, number, number] }) => value[2] }, itemStyle: { borderColor: "#fff", borderWidth: 3, borderRadius: 5 }, emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(16,33,58,.18)" } } }],
  }} />;
}

export function InitiativePriorityChart({ initiatives }: { initiatives: Initiative[] }) {
  const effort = { low: 1, medium: 2, high: 3 } as const;
  return <Chart height={320} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, formatter: (params: { dataIndex: number }) => { const item = initiatives[params.dataIndex]; return `<strong>${item.title}</strong><br/>Priority ${item.priorityScore}/100<br/>Effort ${item.effort} · ${item.horizonDays} hari<br/>Owner ${item.owner}`; } },
    grid: { left: 46, right: 34, top: 30, bottom: 48 },
    xAxis: { type: "value", min: 0.6, max: 3.4, interval: 1, axisLabel: { color: "#738092", fontSize: 9, formatter: (value: number) => value === 1 ? "Low" : value === 2 ? "Medium" : value === 3 ? "High" : "" }, splitLine: split, name: "Implementation effort", nameLocation: "middle", nameGap: 32, nameTextStyle: { color: "#738092", fontSize: 9 } },
    yAxis: { type: "value", min: 0, max: 100, axisLabel: { color: "#738092", fontSize: 9 }, splitLine: split, name: "Priority", nameTextStyle: { color: "#738092", fontSize: 9 } },
    series: [{ type: "scatter", symbolSize: (value: [number, number, number]) => 18 + Math.max(0, 35 - value[2]) * 0.35, data: initiatives.map((item) => ({ value: [effort[item.effort], item.priorityScore, item.horizonDays], name: item.title, itemStyle: { color: item.type === "stabilize" ? palette[0] : item.type === "optimize" ? palette[1] : palette[2] }, label: { show: true, position: "top", color: "#34445c", fontSize: 8, width: 112, overflow: "truncate", formatter: item.title } })), markLine: { symbol: "none", silent: true, data: [{ yAxis: 65, lineStyle: { color: palette[2], type: "dashed" }, label: { formatter: "action line", color: "#94620f", fontSize: 8 } }] } }],
  }} />;
}

export function SimulationImpactChart({ result }: { result: SimulationResult }) {
  const data = [
    ["Productivity", result.productivityChange], ["Inbound SLA", result.slaChange], ["Fulfillment", result.fulfillmentChange], ["Capacity load", result.utilizationChange], ["Mandays gap", result.mandaysGapChange],
  ] as const;
  const max = Math.max(10, ...data.map((item) => Math.abs(item[1])));
  return <Chart height={300} option={{
    animationDuration: 220,
    tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number) => `${Number(value).toFixed(1)} pp` },
    grid: { left: 105, right: 35, top: 10, bottom: 22 },
    xAxis: { type: "value", min: -max, max, axisLabel: { color: "#738092", fontSize: 9, formatter: "{value} pp" }, splitLine: split },
    yAxis: { type: "category", data: data.map((item) => item[0]), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#34445c", fontSize: 9 } },
    series: [{ type: "bar", barWidth: 15, data: data.map((item) => ({ value: item[1], itemStyle: { color: item[1] < 0 ? palette[3] : palette[0], borderRadius: item[1] < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0] }, label: { show: true, position: item[1] < 0 ? "left" : "right", color: "#34445c", fontSize: 9, formatter: `${item[1] > 0 ? "+" : ""}${item[1].toFixed(1)}` } })), markLine: { symbol: "none", silent: true, data: [{ xAxis: 0 }], lineStyle: { color: "#8793a4" } } }],
  }} />;
}

export function DriverChart({ drivers }: { drivers: DriverSignal[] }) {
  const sorted = [...drivers].sort((a, b) => a.score - b.score);
  return <Chart height={292} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (params: Array<{ name: string; value: number }>) => `${params[0]?.name}<br/><strong>${params[0]?.value}/100</strong>` },
    grid: { left: 126, right: 34, top: 10, bottom: 24 },
    xAxis: { type: "value", min: 0, max: 100, axisLabel: { color: "#738092", fontSize: 9 }, splitLine: split },
    yAxis: { type: "category", data: sorted.map((item) => item.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#596778", fontSize: 9, width: 116, overflow: "truncate" } },
    series: [{ type: "bar", barWidth: 12, data: sorted.map((item) => ({ value: item.score, itemStyle: { color: item.score < 65 ? palette[3] : item.score < 85 ? palette[2] : palette[0], borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", color: "#10213a", fontSize: 9, fontWeight: 700 } })), markLine: { silent: true, symbol: "none", lineStyle: { color: "#8793a4", type: "dashed" }, data: [{ xAxis: 85, label: { formatter: "control", color: "#738092", fontSize: 8 } }] } }],
  }} />;
}

export function HealthGauge({ score }: { score: number }) {
  return <Chart height={185} option={{ series: [{ type: "gauge", startAngle: 205, endAngle: -25, min: 0, max: 100, radius: "88%", center: ["50%", "56%"], progress: { show: true, width: 9, roundCap: true, itemStyle: { color: score < 65 ? palette[3] : score < 82 ? palette[2] : palette[0] } }, axisLine: { lineStyle: { width: 9, color: [[1, "rgba(255,255,255,.12)"]] } }, pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, title: { offsetCenter: [0, "38%"], color: "#8ea0b4", fontSize: 9 }, detail: { valueAnimation: true, offsetCenter: [0, "0%"], color: "#fff", fontSize: 34, fontWeight: 700, formatter: "{value}" }, data: [{ value: score, name: "SYSTEM HEALTH" }] }] }} />;
}

export function WarehouseComparisonChart({ rows }: { rows: WarehouseComparisonRow[] }) {
  return <Chart height={295} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "axis" },
    legend: { top: 0, left: 0, itemWidth: 16, itemHeight: 4, textStyle: { color: "#596778", fontSize: 9 } },
    grid: { left: 42, right: 20, top: 42, bottom: 28 },
    xAxis: { type: "category", data: rows.map((row) => row.warehouse), ...axis },
    yAxis: { type: "value", min: 0, max: 110, axisLabel: { color: "#738092", fontSize: 9, formatter: "{value}%" }, splitLine: split },
    series: [
      { name: "Productivity", type: "bar", data: rows.map((row) => row.productivity), barMaxWidth: 18, itemStyle: { color: palette[0], borderRadius: [4, 4, 0, 0] } },
      // Demand fill rate rather than warehouse FR: post-cancel FR sits at ~100% for
      // every warehouse, so it plots as a flat line that separates nobody.
      { name: "Demand fill rate", type: "line", data: rows.map((row) => row.demandFillRate), showSymbol: true, symbolSize: 7, lineStyle: { color: palette[1], width: 2 }, itemStyle: { color: palette[1] } },
      { name: "Forecast accuracy", type: "line", data: rows.map((row) => row.forecastAccuracy), showSymbol: true, symbolSize: 7, lineStyle: { color: palette[2], width: 2, type: "dashed" }, itemStyle: { color: palette[2] } },
    ],
  }} />;
}
