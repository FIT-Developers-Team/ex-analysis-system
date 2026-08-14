"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import type { ControlChart } from "@/lib/analysis/operations-math";
import type {
  CapacityHistoryPoint,
  DriverSignal,
  FlowStage,
  Initiative,
  LaborBalancePoint,
  RelationshipSignal,
  RiskMatrix,
  SimulationResult,
  SimulationScenario,
  TrendSeries,
  VolumeFlowPoint,
  WarehouseComparisonRow,
} from "@/lib/types";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const palette = ["#1d4ed8", "#0f8f82", "#d8890b", "#d95d45", "#667f36", "#9b4f79", "#475569"];
const axis = { axisLine: { show: true, lineStyle: { color: "#cbd5e1", width: 1 } }, axisTick: { show: false }, axisLabel: { color: "#475569", fontSize: 11, hideOverlap: true } };
const split = { lineStyle: { color: "#e2e8f0", type: "dashed" as const, width: 1 } };
const tooltip = {
  backgroundColor: "#0f1f35",
  borderColor: "#31445f",
  borderWidth: 1,
  confine: true,
  textStyle: { color: "#fff", fontFamily: "Inter, system-ui, sans-serif", fontSize: 12, lineHeight: 19 },
  extraCssText: "border-radius:10px;box-shadow:0 16px 36px rgba(15,31,53,.24);padding:10px 12px",
};
const number = (value: number | null | undefined, precision = 0) => value == null ? "—" : value.toLocaleString("id-ID", { minimumFractionDigits: precision, maximumFractionDigits: precision });
const percent = (value: number | null | undefined, precision = 2) => value == null ? "—" : `${number(value, precision)}%`;
const dateInterval = (length: number) => length <= 10 ? 0 : Math.max(1, Math.ceil(length / 7) - 1);
const pointVisibility = (length: number) => length <= 14;

function Chart({ option, height = 320 }: { option: Record<string, unknown>; height?: number }) {
  const accessibleOption = {
    aria: { enabled: true, decal: { show: true } },
    ...option,
  };
  return <div className="chart-frame" style={{ "--chart-height": `${height}px` } as CSSProperties}><ReactECharts option={accessibleOption} style={{ height: "100%", width: "100%" }} opts={{ renderer: "canvas" }} notMerge lazyUpdate /></div>;
}

export function TrendChart({ series }: { series: TrendSeries[] }) {
  const dates = series[0]?.values.map((item) => item.date) ?? [];
  return <Chart height={330} option={{
    color: palette,
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: "#64748b", type: "dashed" } }, valueFormatter: (value: number | null) => percent(value, 2) },
    legend: { top: 0, left: 0, itemWidth: 22, itemHeight: 4, itemGap: 16, textStyle: { color: "#475569", fontSize: 11 } },
    grid: { left: 58, right: 28, top: 58, bottom: 38 },
    xAxis: { type: "category", data: dates, boundaryGap: false, ...axis, axisLabel: { color: "#475569", fontSize: 11, formatter: (value: string) => value.slice(5), interval: dateInterval(dates.length), hideOverlap: true } },
    yAxis: { type: "value", min: 0, max: (value: { max: number }) => Math.max(110, Math.ceil(value.max / 10) * 10), axisLabel: { color: "#475569", fontSize: 11, formatter: "{value}%" }, splitLine: split },
    series: series.map((item, index) => ({
      name: item.label,
      type: "line",
      data: item.values.map((point) => point.value === null ? null : Number(point.value.toFixed(2))),
      connectNulls: false,
      showSymbol: pointVisibility(dates.length),
      symbol: index % 2 === 0 ? "circle" : "emptyCircle",
      symbolSize: 6,
      smooth: false,
      lineStyle: { width: index === 0 ? 3 : 2.4, type: index === 2 ? "dashed" : "solid" },
      emphasis: { focus: "series", scale: 1.4, lineStyle: { width: 4 } },
    })),
  }} />;
}

export function VolumeFlowChart({ points, mode }: { points: VolumeFlowPoint[]; mode: "inbound" | "outbound" }) {
  const inbound = [
    { name: "Forecast inbound", key: "inboundForecast", color: palette[0], type: "line" },
    { name: "Actual inbound", key: "inboundActual", color: palette[1], type: "bar" },
  ] as const;
  const outbound = [
    { name: "Forecast", key: "outboundForecast", color: palette[0], type: "line" },
    { name: "Request sebelum cancel", key: "beforeCancel", color: palette[2], type: "line" },
    { name: "Request setelah cancel", key: "afterCancel", color: palette[3], type: "line" },
    { name: "RTS", key: "rts", color: palette[1], type: "bar" },
    { name: "Diterima hub", key: "hubReceived", color: palette[4], type: "line" },
  ] as const;
  const definitions = mode === "inbound" ? inbound : outbound;
  const zoomed = points.length > 45;
  return <Chart height={350} option={{
    animationDuration: 350,
    tooltip: {
      ...tooltip,
      trigger: "axis",
      axisPointer: { type: "cross", lineStyle: { color: "#64748b", type: "dashed" }, crossStyle: { color: "#64748b" } },
      valueFormatter: (value: number | null) => number(value, 0),
    },
    legend: { top: 0, left: 0, itemWidth: 22, itemHeight: 4, itemGap: 14, textStyle: { color: "#475569", fontSize: 11 } },
    grid: { left: 72, right: 28, top: 58, bottom: zoomed ? 68 : 38 },
    xAxis: { type: "category", data: points.map((point) => point.date), ...axis, axisLabel: { color: "#475569", fontSize: 11, formatter: (value: string) => value.slice(5), interval: dateInterval(points.length), hideOverlap: true } },
    yAxis: { type: "value", min: 0, ...axis, axisLabel: { color: "#475569", fontSize: 11, formatter: (value: number) => Intl.NumberFormat("id-ID", { notation: "compact" }).format(value) }, splitLine: split },
    dataZoom: zoomed ? [{ type: "inside", filterMode: "none" }, { type: "slider", height: 16, bottom: 8, borderColor: "#cbd5e1", fillerColor: "rgba(29,78,216,.12)", handleStyle: { color: palette[0] } }] : undefined,
    series: definitions.map((definition, index) => ({
      name: definition.name,
      type: definition.type,
      data: points.map((point) => point[definition.key]),
      itemStyle: { color: definition.color, opacity: definition.type === "bar" ? 0.82 : 1, borderColor: definition.color, borderWidth: definition.type === "bar" ? 1 : 0, borderRadius: definition.type === "bar" ? [4, 4, 0, 0] : 0 },
      lineStyle: { color: definition.color, width: index === 0 ? 3 : 2.4, type: index === 0 || index === 2 ? "dashed" : "solid" },
      showSymbol: definition.type === "line" && pointVisibility(points.length),
      symbol: index % 2 === 0 ? "circle" : "emptyCircle",
      symbolSize: 6,
      smooth: false,
      barMaxWidth: 16,
      connectNulls: false,
      emphasis: { focus: "series", scale: 1.25, lineStyle: { width: 4 } },
    })),
  }} />;
}

export function FulfillmentFunnelChart({ stages }: { stages: FlowStage[] }) {
  const available = stages.filter((stage) => stage.value !== null);
  const max = Math.max(1, ...available.map((stage) => stage.value ?? 0));
  return <Chart height={318} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "item", formatter: (params: { name: string; value: number; dataIndex: number }) => { const stage = available[params.dataIndex]; return `<strong>${params.name}</strong><br/>Volume <strong>${number(params.value)}</strong><br/>Konversi tahap ${percent(stage?.conversionPct, 2)}<br/>Loss ${number(stage?.lossQty)}`; } },
    grid: { left: 180, right: 92, top: 12, bottom: 30 },
    xAxis: { type: "value", min: 0, max, axisLabel: { color: "#475569", fontSize: 11, formatter: (value: number) => Intl.NumberFormat("id-ID", { notation: "compact" }).format(value) }, splitLine: split },
    yAxis: { type: "category", inverse: true, data: available.map((stage) => stage.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#334155", fontSize: 11, fontWeight: 600 } },
    series: [{ type: "bar", barWidth: 22, data: available.map((stage) => ({ value: stage.value, itemStyle: { color: stage.status === "critical" ? palette[3] : stage.status === "watch" ? palette[2] : palette[0], borderColor: stage.status === "critical" ? "#a83f2c" : stage.status === "watch" ? "#a66100" : "#173fa5", borderWidth: 1, borderRadius: [0, 5, 5, 0] }, label: { show: true, position: "right", distance: 8, color: "#334155", fontSize: 11, fontWeight: 700, formatter: ({ value }: { value: number }) => number(value) } })), emphasis: { focus: "self", itemStyle: { shadowBlur: 10, shadowColor: "rgba(15,31,53,.18)" } } }],
  }} />;
}

export function LaborBalanceChart({ points }: { points: LaborBalancePoint[] }) {
  const usage = points.map((point) => point.actualMandays === null || point.budgetMandays === null || point.budgetMandays <= 0
    ? null
    : Number((point.actualMandays / point.budgetMandays * 100).toFixed(2)));
  return <Chart height={350} option={{
    animationDuration: 350,
    tooltip: {
      ...tooltip,
      trigger: "axis",
      formatter: (params: Array<{ dataIndex: number; marker: string; seriesName: string; value: number | null }>) => {
        const index = params[0]?.dataIndex ?? 0;
        const point = points[index];
        const rows = params.map((item) => `${item.marker}${item.seriesName}: <strong>${percent(item.value, 1)}</strong>`).join("<br/>");
        return `<strong>${point?.date ?? ""}</strong><br/>${rows}<br/><span style="color:#c3ccd6">Actual ${number(point?.actualMandays, 1)} MD · Budget ${number(point?.budgetMandays, 1)} MD</span>`;
      },
    },
    legend: { top: 0, left: 0, itemWidth: 22, itemHeight: 4, itemGap: 16, textStyle: { color: "#475569", fontSize: 11 } },
    grid: { left: 58, right: 76, top: 52, bottom: 36 },
    xAxis: { type: "category", data: points.map((point) => point.date), ...axis, axisLabel: { color: "#475569", fontSize: 11, formatter: (value: string) => value.slice(5), interval: dateInterval(points.length), hideOverlap: true } },
    yAxis: { type: "value", min: 0, max: (value: { max: number }) => Math.max(120, Math.ceil(value.max / 10) * 10), axisLabel: { color: "#475569", fontSize: 11, formatter: "{value}%" }, splitLine: split },
    series: [
      { name: "Pemakaian MD", type: "bar", data: usage, barMaxWidth: 16, itemStyle: { color: "#c8d7fb", borderColor: palette[0], borderWidth: 1, borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "series" } },
      { name: "Produktivitas", type: "line", data: points.map((point) => point.productivity), showSymbol: pointVisibility(points.length), symbol: "circle", symbolSize: 6, connectNulls: false, smooth: false, lineStyle: { color: palette[3], width: 3 }, itemStyle: { color: palette[3] }, emphasis: { focus: "series", scale: 1.35, lineStyle: { width: 4 } }, markLine: { symbol: "none", silent: true, lineStyle: { color: "#475569", type: "dashed", opacity: 0.85 }, data: [{ yAxis: 100, label: { formatter: "acuan 100%", color: "#475569", fontSize: 10 } }] } },
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
    tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: "#64748b", type: "dashed" } }, valueFormatter: (value: number | null) => percent(value, 1) },
    legend: { top: 0, left: 0, itemWidth: 22, itemHeight: 4, itemGap: 16, textStyle: { color: "#475569", fontSize: 11 } },
    grid: { left: 54, right: 76, top: 50, bottom: 34 },
    xAxis: { type: "category", data: points.map((point) => point.date), boundaryGap: false, ...axis, axisLabel: { color: "#475569", fontSize: 11, formatter: (value: string) => value.slice(5), interval: dateInterval(points.length), hideOverlap: true } },
    yAxis: { type: "value", min: 0, max: (value: { max: number }) => Math.max(100, Math.ceil(value.max / 10) * 10), axisLabel: { color: "#475569", fontSize: 11, formatter: "{value}%" }, splitLine: split },
    series: definitions.map((definition, index) => ({ name: definition.name, type: "line", data: points.map((point) => point[definition.key]), showSymbol: pointVisibility(points.length), symbol: index === 0 ? "circle" : index === 1 ? "emptyCircle" : "diamond", symbolSize: 6, connectNulls: false, smooth: false, lineStyle: { width: 2.7, color: definition.color, type: index === 1 ? "dashed" : index === 2 ? "dotted" : "solid" }, itemStyle: { color: definition.color }, emphasis: { focus: "series", scale: 1.35, lineStyle: { width: 4 } }, markLine: index === 0 ? { symbol: "none", silent: true, lineStyle: { type: "dashed" }, data: [{ yAxis: 85, lineStyle: { color: palette[2] }, label: { formatter: "waspada 85%", color: "#855309", fontSize: 10 } }, { yAxis: 92, lineStyle: { color: palette[3] }, label: { formatter: "kritis 92%", color: "#9d3a26", fontSize: 10 } }] } : undefined })),
  }} />;
}

export function RelationshipChart({ signals }: { signals: RelationshipSignal[] }) {
  const data = [...signals].filter((signal) => signal.coefficient !== null).sort((a, b) => (a.coefficient ?? 0) - (b.coefficient ?? 0));
  return <Chart height={Math.max(330, data.length * 42)} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "item", formatter: (params: { dataIndex: number; value: number }) => { const signal = data[params.dataIndex]; return `<strong>${signal.driverLabel} → ${signal.outcomeLabel}</strong><br/>Korelasi <strong>r ${Number(params.value).toFixed(2)}</strong> · ${signal.sampleSize} hari<br/>${signal.strength} · keyakinan ${signal.confidence}<br/>${signal.alignment}`; } },
    grid: { left: 224, right: 70, top: 22, bottom: 40 },
    xAxis: { type: "value", min: -1, max: 1, axisLabel: { color: "#475569", fontSize: 11, formatter: (value: number) => value.toFixed(1) }, splitLine: split },
    yAxis: { type: "category", data: data.map((signal) => `${signal.driverLabel} → ${signal.outcomeLabel}`), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#334155", fontSize: 11, width: 208, overflow: "truncate" } },
    series: [{ type: "bar", barWidth: 15, data: data.map((signal) => ({ value: signal.coefficient, itemStyle: { color: signal.alignment === "supports" ? palette[0] : signal.alignment === "contradicts" ? palette[2] : "#64748b", borderColor: signal.alignment === "supports" ? "#173fa5" : signal.alignment === "contradicts" ? "#a66100" : "#475569", borderWidth: 1, borderRadius: signal.coefficient && signal.coefficient < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0] }, label: { show: true, position: signal.coefficient && signal.coefficient < 0 ? "left" : "right", distance: 7, color: "#334155", fontSize: 11, fontWeight: 700, formatter: ({ value }: { value: number }) => Number(value).toFixed(2) } })), emphasis: { focus: "self", itemStyle: { shadowBlur: 9, shadowColor: "rgba(15,31,53,.16)" } }, markLine: { symbol: "none", silent: true, lineStyle: { color: "#475569", width: 1.2 }, data: [{ xAxis: 0 }] } }],
  }} />;
}

export function RiskHeatmapChart({ matrix }: { matrix: RiskMatrix }) {
  const data = matrix.rows.flatMap((row, y) => row.values.flatMap((value, x) => value === null ? [] : [[x, y, value]]));
  return <Chart height={350} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, position: "top", formatter: (params: { value: [number, number, number] }) => `${matrix.rows[params.value[1]]?.domain}<br/><strong>Risiko ${params.value[2]}/100</strong><br/>${matrix.weeks[params.value[0]]}` },
    grid: { left: 110, right: 22, top: 20, bottom: 62 },
    xAxis: { type: "category", data: matrix.weeks, splitArea: { show: true, areaStyle: { color: ["#fbfcfe", "#f6f8fb"] } }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#475569", fontSize: 10, rotate: 28, hideOverlap: true } },
    yAxis: { type: "category", data: matrix.rows.map((row) => row.domain), splitArea: { show: true }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#334155", fontSize: 11, fontWeight: 600 } },
    visualMap: { min: 0, max: 80, show: false, inRange: { color: ["#eef4ff", "#9fbcf5", "#f3c66f", "#d95d45"] } },
    series: [{ type: "heatmap", data, label: { show: true, color: "#0f1f35", fontSize: 10, fontWeight: 650, formatter: ({ value }: { value: [number, number, number] }) => value[2] }, itemStyle: { borderColor: "#fff", borderWidth: 3, borderRadius: 5 }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(15,31,53,.22)", borderColor: "#0f1f35", borderWidth: 2 } } }],
  }} />;
}

export function InitiativePriorityChart({ initiatives }: { initiatives: Initiative[] }) {
  const items = [...initiatives].sort((a, b) => b.priorityScore - a.priorityScore);
  const effortLabel = { low: "rendah", medium: "sedang", high: "tinggi" } as const;
  return <Chart height={Math.max(300, items.length * 58)} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, formatter: (params: { dataIndex: number }) => { const item = items[params.dataIndex]; return `<strong>${item.title}</strong><br/>Prioritas ${item.priorityScore}/100<br/>Usaha ${effortLabel[item.effort]} · ${item.horizonDays} hari<br/>Owner ${item.owner}`; } },
    grid: { left: 190, right: 46, top: 12, bottom: 34 },
    xAxis: { type: "value", min: 0, max: 100, axisLabel: { color: "#475569", fontSize: 11 }, splitLine: split },
    yAxis: { type: "category", inverse: true, data: items.map((item) => item.title), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#334155", fontSize: 11, width: 174, overflow: "truncate" } },
    series: [{ type: "bar", barWidth: 17, data: items.map((item) => ({ value: item.priorityScore, itemStyle: { color: item.type === "stabilize" ? palette[0] : item.type === "optimize" ? palette[1] : palette[2], borderColor: item.type === "stabilize" ? "#173fa5" : item.type === "optimize" ? "#0b6e65" : "#a66100", borderWidth: 1, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", distance: 7, color: "#0f1f35", fontSize: 11, fontWeight: 700, formatter: `${item.priorityScore}` } })), emphasis: { focus: "self", itemStyle: { shadowBlur: 9, shadowColor: "rgba(15,31,53,.16)" } }, markLine: { symbol: "none", silent: true, data: [{ xAxis: 65, lineStyle: { color: palette[2], type: "dashed" }, label: { formatter: "mulai 65", color: "#855309", fontSize: 10 } }] } }],
  }} />;
}

/**
 * The chain running at the speed of its slowest station. Each bar is a role's
 * throughput; the marked line is the demand it has to absorb. Any bar under the
 * line is where the flow stops, which is the one thing a staffing decision needs
 * to know and the thing a list of percentages never says out loud.
 */
export function SimulationCapacityChart({ scenario }: { scenario: SimulationScenario }) {
  const roles = scenario.roles;
  const demand = scenario.demandAfterCancel;
  const maximum = Math.max(demand, ...roles.map((role) => role.throughput)) * 1.12;
  return <Chart height={Math.max(260, roles.length * 74)} option={{
    animationDuration: 260,
    tooltip: {
      ...tooltip,
      trigger: "item",
      formatter: (params: { dataIndex: number }) => {
        const role = roles[params.dataIndex];
        return `<strong>${role.role}</strong><br/>Kemampuan <strong>${number(role.throughput)}</strong> unit<br/>${number(role.mandays, 1)} manday × ${number(role.ratePerManday)} / manday<br/>Butuh ${number(role.requiredMandays, 1)} manday untuk permintaan ini`;
      },
    },
    grid: { left: 86, right: 96, top: 18, bottom: 34 },
    xAxis: { type: "value", min: 0, max: maximum, axisLabel: { color: "#475569", fontSize: 11, formatter: (value: number) => Intl.NumberFormat("id-ID", { notation: "compact" }).format(value) }, splitLine: split },
    yAxis: { type: "category", inverse: true, data: roles.map((role) => role.role), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#334155", fontSize: 11, fontWeight: 600 } },
    series: [{
      type: "bar",
      barWidth: 26,
      data: roles.map((role) => ({
        value: role.throughput,
        itemStyle: {
          color: role.binding ? palette[3] : role.throughput < demand ? palette[2] : palette[0],
          borderColor: role.binding ? "#a83f2c" : role.throughput < demand ? "#a66100" : "#173fa5",
          borderWidth: 1,
          borderRadius: [0, 5, 5, 0],
        },
        label: { show: true, position: "right", distance: 8, color: "#334155", fontSize: 11, fontWeight: 700, formatter: ({ value }: { value: number }) => number(value) },
      })),
      emphasis: { focus: "self" },
      markLine: {
        symbol: "none",
        silent: true,
        data: [{ xAxis: Number(demand.toFixed(0)) }],
        lineStyle: { color: "#0f1f35", width: 1.8, type: "solid" },
        label: { formatter: `permintaan ${number(demand)}`, color: "#0f1f35", fontSize: 10, position: "insideEndTop" },
      },
    }],
  }} />;
}

export function SimulationImpactChart({ result }: { result: SimulationResult }) {
  // Percentage points and unit counts cannot share one axis, so the bars are
  // normalised to percent-of-baseline and the real figures live in the labels.
  const data = result.deltas
    .filter((item) => item.baseline !== null && item.scenario !== null)
    .map((item) => {
      const relative = item.baseline ? (item.change / Math.abs(item.baseline)) * 100 : item.change;
      const label = item.unit === "unit"
        ? `${item.change > 0 ? "+" : ""}${number(item.change)}`
        : `${item.change > 0 ? "+" : ""}${number(item.change, item.unit === "pp" ? 1 : 2)}${item.unit === "pp" ? " pp" : ""}`;
      return { name: item.label, relative: Number(relative.toFixed(2)), label, better: item.direction === "better", flat: item.direction === "flat" };
    });
  const max = Math.max(5, ...data.map((item) => Math.abs(item.relative)));
  return <Chart height={Math.max(280, data.length * 40)} option={{
    animationDuration: 220,
    tooltip: { ...tooltip, trigger: "item", formatter: (params: { dataIndex: number }) => `<strong>${data[params.dataIndex]?.name}</strong><br/>${data[params.dataIndex]?.label} terhadap kondisi sekarang` },
    grid: { left: 158, right: 76, top: 10, bottom: 30 },
    xAxis: { type: "value", min: -max, max, axisLabel: { color: "#475569", fontSize: 11, formatter: "{value}%" }, splitLine: split },
    yAxis: { type: "category", data: data.map((item) => item.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#334155", fontSize: 11, fontWeight: 600, width: 146, overflow: "truncate" } },
    series: [{
      type: "bar",
      barWidth: 15,
      data: data.map((item) => ({
        value: item.relative,
        itemStyle: {
          color: item.flat ? "#94a3b8" : item.better ? palette[1] : palette[3],
          borderColor: item.flat ? "#64748b" : item.better ? "#0b6e65" : "#a83f2c",
          borderWidth: 1,
          borderRadius: item.relative < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0],
        },
        label: { show: true, position: item.relative < 0 ? "left" : "right", distance: 7, color: "#334155", fontSize: 11, fontWeight: 700, formatter: item.label },
      })),
      emphasis: { focus: "self" },
      markLine: { symbol: "none", silent: true, data: [{ xAxis: 0 }], lineStyle: { color: "#475569", width: 1.2 } },
    }],
  }} />;
}

export function DriverChart({ drivers }: { drivers: DriverSignal[] }) {
  const sorted = [...drivers].sort((a, b) => a.score - b.score);
  return <Chart height={292} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (params: Array<{ name: string; value: number }>) => `${params[0]?.name}<br/><strong>${params[0]?.value}/100</strong>` },
    grid: { left: 148, right: 38, top: 10, bottom: 28 },
    xAxis: { type: "value", min: 0, max: 100, axisLabel: { color: "#475569", fontSize: 11 }, splitLine: split },
    yAxis: { type: "category", data: sorted.map((item) => item.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#475569", fontSize: 11, width: 136, overflow: "truncate" } },
    series: [{ type: "bar", barWidth: 14, data: sorted.map((item) => ({ value: item.score, itemStyle: { color: item.score < 65 ? palette[3] : item.score < 85 ? palette[2] : palette[0], borderColor: item.score < 65 ? "#a83f2c" : item.score < 85 ? "#a66100" : "#173fa5", borderWidth: 1, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", distance: 7, color: "#0f1f35", fontSize: 11, fontWeight: 700 } })), emphasis: { focus: "self" }, markLine: { silent: true, symbol: "none", lineStyle: { color: "#475569", type: "dashed" }, data: [{ xAxis: 65, label: { formatter: "prioritas 65", color: "#9d3a26", fontSize: 10 } }, { xAxis: 85, label: { formatter: "sehat 85", color: "#475569", fontSize: 10 } }] } }],
  }} />;
}

/**
 * Individuals control chart. The centre line and the two limits are what turn a
 * jagged daily series into a statement: inside the band is the process, outside
 * it is an event. Out-of-control points are drawn larger and in the breach
 * colour so they can be found without reading the tooltip.
 */
export function ControlChartView({ chart }: { chart: ControlChart }) {
  const dates = chart.points.map((point) => point.date);
  const values = chart.points.map((point) => point.value === null ? null : Number(point.value.toFixed(2)));
  const flagged = chart.points.map((point) => point.outOfControl && point.value !== null ? Number(point.value.toFixed(2)) : null);
  return <Chart height={300} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "axis", valueFormatter: (value: number | null) => chart.unit === "percent" ? percent(value, 2) : number(value, 1) },
    grid: { left: 58, right: 72, top: 24, bottom: 34 },
    xAxis: { type: "category", data: dates, boundaryGap: false, ...axis, axisLabel: { color: "#475569", fontSize: 11, formatter: (value: string) => value.slice(5), interval: dateInterval(dates.length), hideOverlap: true } },
    yAxis: { type: "value", scale: true, axisLabel: { color: "#475569", fontSize: 11, formatter: chart.unit === "percent" ? "{value}%" : "{value}" }, splitLine: split },
    series: [
      {
        name: chart.label,
        type: "line",
        data: values,
        connectNulls: false,
        showSymbol: pointVisibility(dates.length),
        symbolSize: 5,
        lineStyle: { width: 2.4, color: palette[0] },
        itemStyle: { color: palette[0] },
        markLine: chart.mean === null ? undefined : {
          symbol: "none",
          silent: true,
          data: [
            { yAxis: Number(chart.mean.toFixed(2)), lineStyle: { color: "#475569", type: "solid", width: 1.2 }, label: { formatter: "rata-rata", color: "#475569", fontSize: 10 } },
            { yAxis: Number((chart.upperLimit ?? 0).toFixed(2)), lineStyle: { color: palette[3], type: "dashed" }, label: { formatter: "batas atas", color: "#9d3a26", fontSize: 10 } },
            { yAxis: Number((chart.lowerLimit ?? 0).toFixed(2)), lineStyle: { color: palette[3], type: "dashed" }, label: { formatter: "batas bawah", color: "#9d3a26", fontSize: 10 } },
          ],
        },
      },
      { name: "Di luar batas", type: "scatter", data: flagged, symbolSize: 11, itemStyle: { color: palette[3], borderColor: "#fff", borderWidth: 2 }, z: 5 },
    ],
  }} />;
}

export function HealthGauge({ score }: { score: number }) {
  return <Chart height={185} option={{ series: [{ type: "gauge", startAngle: 205, endAngle: -25, min: 0, max: 100, radius: "88%", center: ["50%", "56%"], progress: { show: true, width: 9, roundCap: true, itemStyle: { color: score < 65 ? palette[3] : score < 82 ? palette[2] : palette[0] } }, axisLine: { lineStyle: { width: 9, color: [[1, "rgba(255,255,255,.12)"]] } }, pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, title: { offsetCenter: [0, "38%"], color: "#9aa8ba", fontSize: 11 }, detail: { valueAnimation: true, offsetCenter: [0, "0%"], color: "#fff", fontSize: 34, fontWeight: 700, formatter: "{value}" }, data: [{ value: score, name: "SKOR KESEHATAN" }] }] }} />;
}

export function WarehouseComparisonChart({ rows }: { rows: WarehouseComparisonRow[] }) {
  const allValues = rows.flatMap((row) => [row.productivity, row.demandFillRate, row.forecastAccuracy]).filter((value): value is number => value !== null);
  const maximum = Math.max(110, Math.ceil(Math.max(...allValues, 100) / 10) * 10);
  return <Chart height={295} option={{
    animationDuration: 350,
    tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(71,85,105,.08)" } }, valueFormatter: (value: number | null) => percent(value, 1) },
    legend: { top: 0, left: 0, itemWidth: 14, itemHeight: 8, itemGap: 16, textStyle: { color: "#475569", fontSize: 11 } },
    grid: { left: 56, right: 24, top: 50, bottom: 34 },
    xAxis: { type: "category", data: rows.map((row) => row.warehouse), ...axis },
    yAxis: { type: "value", min: 0, max: maximum, axisLabel: { color: "#475569", fontSize: 11, formatter: "{value}%" }, splitLine: split },
    series: [
      { name: "Produktivitas", type: "bar", data: rows.map((row) => row.productivity), barMaxWidth: 17, itemStyle: { color: palette[0], borderColor: "#173fa5", borderWidth: 1, borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "series" } },
      // Demand fill rate rather than warehouse FR: post-cancel FR sits at ~100% for
      // every warehouse, so it plots as a flat line that separates nobody.
      { name: "Demand fill", type: "bar", data: rows.map((row) => row.demandFillRate), barMaxWidth: 17, itemStyle: { color: palette[1], borderColor: "#0b6e65", borderWidth: 1, borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "series" } },
      { name: "Akurasi forecast", type: "bar", data: rows.map((row) => row.forecastAccuracy), barMaxWidth: 17, itemStyle: { color: palette[2], borderColor: "#a66100", borderWidth: 1, borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "series" } },
    ],
  }} />;
}
