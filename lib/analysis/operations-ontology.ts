import { metricAliasKeys, normalizeLabel } from "@/lib/data/metric-aliases";
import glossaryJson from "@/lib/analysis/operations-glossary.json";
import type {
  MetricDecisionRole,
  MetricFamily,
  MetricReadiness,
  OperatingRule,
  OperationalMetricSemantic,
} from "@/lib/types";

export interface CatalogInput {
  division: string;
  role: string;
  remarks?: string;
  metric: string;
  detail: string;
  activeCoverage: number;
}

export interface OperationGlossaryEntry {
  division: string;
  role: string;
  remarks: string;
  metric: string;
  details: string;
  explanation: string;
  notes: string;
}

export const OPERATION_GLOSSARY = glossaryJson as OperationGlossaryEntry[];

const glossaryKey = (division: string, role: string, metric: string, remarks = "") =>
  [division, role, metric, remarks].map(normalizeLabel).join("|");
const glossaryExact = new Map(OPERATION_GLOSSARY.map((item) => [glossaryKey(item.division, item.role, item.metric, item.remarks), item]));

function glossaryFor(input: CatalogInput): OperationGlossaryEntry | undefined {
  const exact = glossaryExact.get(glossaryKey(input.division, input.role, input.metric, input.remarks));
  if (exact) return exact;
  const sameRole = OPERATION_GLOSSARY.filter((item) => normalizeLabel(item.division) === normalizeLabel(input.division)
    && normalizeLabel(item.role) === normalizeLabel(input.role)
    && normalizeLabel(item.metric) === normalizeLabel(input.metric));
  if (sameRole.length === 1) return sameRole[0];
  const sameDivision = OPERATION_GLOSSARY.filter((item) => normalizeLabel(item.division) === normalizeLabel(input.division)
    && normalizeLabel(item.metric) === normalizeLabel(input.metric));
  return sameDivision.length === 1 ? sameDivision[0] : undefined;
}

/**
 * The operating contract behind the decision engine. These are intentionally
 * expressed as trade-offs: optimizing one metric without its paired guardrail
 * is how a dashboard turns a local improvement into a system loss.
 */
export const OPERATING_RULES: OperatingRule[] = [
  {
    id: "forecast-to-labor",
    title: "Forecast menentukan rencana, actual menentukan produktivitas",
    principle: "MPP dan budget mandays disiapkan dari forecast; produktivitas harus dihitung dari barang yang benar-benar diproses.",
    decisionGuardrail: "Selalu baca forecast vs demand aktual, actual mandays, productivity, SLA, dan demand fill pada volume band yang sama.",
  },
  {
    id: "saving-with-service",
    title: "Mandays rendah belum tentu efisien",
    principle: "Actual mandays di bawah budget hanya menjadi saving jika output, SLA, demand fill, dan cancel tetap sehat.",
    decisionGuardrail: "Tolak label saving bila demand fill <97%, cancel >2%, SLA <98%, atau productivity attainment <100%.",
  },
  {
    id: "sla-productivity-tension",
    title: "SLA dan produktivitas saling tarik-menarik",
    principle: "Tambahan orang dapat memperbaiki lead time dan SLA, tetapi output per manday dapat terdilusi ketika workload tidak ikut naik.",
    decisionGuardrail: "Bandingkan SLA dan productivity pada actual workload serta jam kerja yang setara sebelum mengubah manpower.",
  },
  {
    id: "cancel-before-after",
    title: "Demand sebelum cancel tidak boleh hilang dari pembacaan",
    principle: "Fulfillment setelah cancel dapat terlihat membaik walau permintaan awal tidak dilayani.",
    decisionGuardrail: "Tampilkan demand fill terhadap request sebelum cancel berdampingan dengan fulfillment setelah cancel.",
  },
  {
    id: "zonal-capacity",
    title: "Kapasitas harus dibaca per zona",
    principle: "Ambient, chiller, dan frozen memiliki constraint berbeda; rata-rata warehouse dapat menutupi satu zona yang jenuh.",
    decisionGuardrail: "Warning pada 85%, critical pada 92%, dan validasi max capacity sebelum overflow atau tambahan volume.",
  },
  {
    id: "inventory-loss-chain",
    title: "Kualitas SLOC mengalir ke service",
    principle: "DCC, replenishment, troubleshoot, Pick-to-PF, pick-to-lost, dan picker productivity membentuk satu loss chain.",
    decisionGuardrail: "Jangan menyalahkan picker sebelum memeriksa readiness pickface, repeat-offender SLOC, dan recovery queue.",
  },
  {
    id: "troubleshoot-mp",
    title: "Troubleshoot FR perlu konteks manpower",
    principle: "FR troubleshoot menunjukkan recovery, tetapi perubahan FR belum dapat dikaitkan ke manpower bila mandays role tidak tersedia.",
    decisionGuardrail: "Gunakan FR sebagai outcome diagnostik; tahan rekomendasi staffing sampai arrival rate, aging, dan mandays tersedia.",
  },
  {
    id: "relabel-scope",
    title: "Relabel bukan seluruh inbound",
    principle: "Hanya sebagian barang melalui relabel dan sumber belum menyediakan forecast pcs relabel.",
    decisionGuardrail: "Nilai actual productivity relabel terhadap actual relabel qty; jangan menyebutnya forecast attainment.",
  },
  {
    id: "fleet-ownership",
    title: "Pisahkan loss warehouse dan fleet",
    principle: "RTS, dispatch, departure, dan hub received berada pada ownership serta cut-off yang berbeda.",
    decisionGuardrail: "Tag owner delay per tahap sebelum menurunkan kesimpulan tentang fulfillment warehouse.",
  },
  {
    id: "wastage-value",
    title: "Wastage harus dibaca terhadap nilai bisnis",
    principle: "Qty wastage saja tidak cukup untuk menentukan prioritas; nilai, penyebab, GMV, dan run-rate menentukan materialitas.",
    decisionGuardrail: "Pisahkan handling, expired, inbound-to-bad, dan others; gunakan % to GMV hanya bila denominator terverifikasi.",
  },
];

const includesAny = (value: string, terms: string[]) => terms.some((term) => value.includes(term));

function familyFor(metric: string, division: string): MetricFamily {
  const value = `${normalizeLabel(division)} ${normalizeLabel(metric)}`;
  if (includesAny(value, ["personalia", "attendance", "churn", "manday", "slot mp", "mp recommendation", "scheduled"])) return "people";
  if (includesAny(value, ["capacity", "utilization", "occupancy"])) return "capacity";
  if (includesAny(value, ["productivity", "produktivitas"])) return "productivity";
  if (includesAny(value, ["dcc", "sloc", "troubleshoot", "replenish", "lost", "found", "badstock", "bad stock", "planogram", "lbh", "ldp"])) return "inventory-quality";
  if (includesAny(value, ["wastage", "gmv", "revenue", "value"])) return "cost";
  if (includesAny(value, ["fleet", "truck", "driver", "dispatch", "depart", "arrival"])) return "fleet";
  if (includesAny(value, ["sla", "fulfillment", "otif", "on time", "completion", "achievement", "accuracy", "fr %"])) return "service";
  if (includesAny(value, ["forecast", "qty", "actual", "incoming", "requested", "rts", "task", "done", "milkrun", "screening"])) return "volume";
  return "other";
}

function roleFor(metric: string): MetricDecisionRole {
  const value = normalizeLabel(metric);
  if (includesAny(value, ["cancel", "churn", "lost", "bad", "wastage", "adjustment", "audit", "unfulfilled"])) return "guardrail";
  if (includesAny(value, ["sla", "fulfillment", "accuracy", "achievement", "completion", "productivity", "otif", "on time", "found %", "fr %"])) return "outcome";
  if (includesAny(value, ["actual", "qty", "task", "done", "attendance", "delivered", "screening", "relabel", "relable"])) return "driver";
  return "context";
}

function polarityFor(metric: string): OperationalMetricSemantic["polarity"] {
  const value = normalizeLabel(metric);
  if (includesAny(value, ["cancel", "churn", "lost", "bad", "wastage", "late", "ldp", "lbh", "adjustment", "unfulfilled"])) return "lower_better";
  if (includesAny(value, ["productivity", "sla", "fulfillment", "accuracy", "achievement", "completion", "attendance", "otif", "on time", "found %", "fr %", "adoption"])) return "higher_better";
  return "neutral";
}

function readinessFor(metric: string, detail: string, mappedKeys: string[]): MetricReadiness {
  const value = normalizeLabel(metric);
  const context = normalizeLabel(`${metric} ${detail}`);
  if (value.includes("schedule accuracy") || value.includes("mp recommendation") || context.includes("tbc") || value === "planogram accuracy") return "unconfirmed";
  if (mappedKeys.some((key) => DECISION_ENGINE_KEYS.has(key)) && !value.includes("source forecast")) return "decision_ready";
  if (includesAny(value, ["accuracy", "productivity", "sla", "fulfillment", "completion", "utilization", "cancel", "lost", "wastage", "attendance", "churn", "otif", "found", "adoption"])) return "diagnostic_only";
  return "observational";
}

const DECISION_ENGINE_KEYS = new Set([
  "forecast_mpp_inbound", "forecast_weekly_inbound", "actual_inbound", "inbound_utilization", "inbound_capacity", "sla_checker_inbound",
  "budget_checker_mandays", "actual_checker_mandays", "checker_productivity", "checker_productivity_target", "forecast_weekly_putaway",
  "putaway_actual", "putaway_done", "putaway_utilization", "putaway_productivity", "putaway_productivity_target", "budget_putaway_mandays",
  "actual_putaway_mandays", "putaway_completion", "inventory_actual", "inventory_capacity", "inventory_forecast", "inventory_utilization_max",
  "inventory_accuracy_qty", "inventory_accuracy_sloc", "sloc_qty_accuracy", "lbh_qty", "ldp_qty", "ldp_value", "found_rate", "troubleshoot_created",
  "troubleshoot_executed", "troubleshoot_fr", "forecast_mpp_outbound", "forecast_weekly_outbound", "outbound_before_cancel", "outbound_requested",
  "outbound_rts", "outbound_actual_hub", "outbound_unfulfilled", "outbound_capacity", "outbound_utilization", "picker_productivity",
  "picker_productivity_target", "budget_picker_mandays", "actual_picker_mandays", "pick_to_pf", "pick_to_lost", "pick_to_bad", "fulfillment_rate",
  "fulfillment_excl_troubleshoot", "attendance_all", "churn_all", "putaway_productivity_attainment", "replenishment_completion", "replenishment_task",
  "replenishment_done", "relabel_productivity", "relabel_target", "relabel_qty", "relabel_share", "replenishment_sla", "on_time_dispatch",
  "on_time_arrival", "truck_delivered_rate", "actual_truck_delivered", "truck_dedicated", "total_wastage", "wastage_handling",
]);

function decisionUseFor(family: MetricFamily, role: MetricDecisionRole): string {
  if (role === "guardrail") return "Membatasi optimasi lokal agar tidak menurunkan service, quality, atau cost secara tersembunyi.";
  if (role === "outcome") return "Menilai apakah intervensi menghasilkan outcome yang dimaksud; selalu baca bersama driver dan denominator-nya.";
  if (family === "people") return "Menjelaskan ketersediaan kapasitas tenaga kerja dan potensi gap antara plan, schedule, attendance, serta actual workload.";
  if (family === "capacity") return "Menentukan operating envelope dan kapan volume, urutan proses, atau overflow perlu diubah.";
  if (family === "volume") return "Membentuk denominator planning, throughput, dan loss tree dari request sampai completion.";
  return "Memberi konteks operasional untuk diagnosis; bukan bukti tunggal untuk mengubah kebijakan.";
}

function caveatFor(metric: string): string | null {
  const value = normalizeLabel(metric);
  if (value.includes("schedule accuracy")) return "Definisi sumber belum terkonfirmasi dan nilai dapat melebihi 100%; tidak memicu rekomendasi.";
  if (value.includes("mp recommendation")) return "Kolom ini adalah output/rekomendasi perencanaan, bukan actual manpower dan belum dipakai untuk scoring.";
  if (value.includes("relable") || value.includes("relabel")) return "Tidak semua inbound melalui relabel dan forecast pcs relabel belum tersedia.";
  if (value.includes("troubleshoot") && value.includes("fr")) return "Mandays troubleshooter belum tersedia; hubungan FR dengan jumlah MP belum dapat dibuktikan.";
  if (value.includes("fulfillment rate % warehouse") && !value.includes("exclude")) return "Denominator menggunakan request setelah cancel; baca bersama demand fill terhadap request sebelum cancel.";
  if (value.includes("productivity")) return "Produktivitas memakai actual barang yang diproses; forecast hanya konteks kecukupan manpower plan.";
  if (value.includes("gmv") || value.includes("% to gmv")) return "Gunakan hanya setelah denominator GMV, scope produk, dan cut-off MTD/run-rate terverifikasi.";
  if (value.includes("actual ending") && value.includes("inventory")) return "Definisi ending SOH pada 23.59 masih perlu konfirmasi operasional sumber.";
  return null;
}

function relatedMetricsFor(family: MetricFamily): string[] {
  const related: Record<MetricFamily, string[]> = {
    people: ["Forecast workload", "Actual mandays", "Productivity", "SLA"],
    volume: ["Forecast", "Actual throughput", "Mandays", "Capacity"],
    capacity: ["Actual volume", "Max capacity", "Queue / SLA", "Overflow"],
    productivity: ["Actual volume", "Actual mandays", "Quality loss", "Service"],
    service: ["Volume", "Manpower", "Process lead time", "Downstream completion"],
    "inventory-quality": ["DCC / SLOC", "Replenishment", "Troubleshoot", "Pick-to-PF / Lost"],
    cost: ["GMV", "Wastage cause", "Mandays", "Service guardrail"],
    fleet: ["RTS readiness", "Dispatch", "Departure", "Hub arrival"],
    other: ["Source definition", "Operational owner", "Decision cadence"],
  };
  return related[family];
}

export function buildMetricSemantic(input: CatalogInput): OperationalMetricSemantic {
  const glossary = glossaryFor(input);
  const family = familyFor(input.metric, input.division);
  const decisionRole = roleFor(input.metric);
  const mappedKeys = metricAliasKeys(input.metric);
  const mappedKeyCount = mappedKeys.length;
  const detail = glossary?.details || input.detail;
  const readiness = readinessFor(input.metric, `${detail} ${glossary?.explanation ?? ""}`, mappedKeys);
  const definition = glossary?.explanation || detail.trim() || `${input.metric} untuk fungsi ${input.division || "lintas fungsi"} dan peran ${input.role || "All"}.`;
  const baseCaveat = caveatFor(input.metric);
  const glossaryNote = glossary?.notes.trim() || null;
  return {
    id: `${normalizeLabel(input.division)}|${normalizeLabel(input.role)}|${normalizeLabel(input.metric)}|${normalizeLabel(input.remarks ?? glossary?.remarks ?? "")}`,
    division: input.division || "Other",
    role: input.role || "All",
    remarks: input.remarks ?? glossary?.remarks ?? "",
    metric: input.metric,
    detail,
    family,
    decisionRole,
    readiness,
    polarity: polarityFor(input.metric),
    definition,
    decisionUse: decisionUseFor(family, decisionRole),
    caveat: [baseCaveat, glossaryNote ? `Catatan glossary: ${glossaryNote}.` : null].filter(Boolean).join(" ") || null,
    glossaryNotes: glossaryNote,
    relatedMetrics: relatedMetricsFor(family),
    activeCoverage: input.activeCoverage,
    mappedKeyCount,
  };
}
