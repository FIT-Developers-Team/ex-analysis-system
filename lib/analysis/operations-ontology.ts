import { metricAliasKeys, normalizeLabel } from "@/lib/data/metric-aliases";
import glossaryJson from "@/lib/analysis/operations-glossary.json";
import type {
  DefinitionStatus,
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

interface DefinitionResolution {
  definition: string;
  status: DefinitionStatus;
  confidence: "high" | "medium" | "low";
  basis: string | null;
  requiredContext: string[];
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

function readinessFor(metric: string, detail: string, mappedKeys: string[], definitionStatus: DefinitionStatus): MetricReadiness {
  const value = normalizeLabel(metric);
  const context = normalizeLabel(`${metric} ${detail}`);
  if (definitionStatus === "unresolved" || value.includes("schedule accuracy") || value.includes("mp recommendation") || context.includes("tbc") || value === "planogram accuracy" || value === "gmv" || value.includes("% to gmv")) return "unconfirmed";
  if (mappedKeys.some((key) => DECISION_ENGINE_KEYS.has(key)) && !value.includes("source forecast")) return "decision_ready";
  if (includesAny(value, ["accuracy", "productivity", "sla", "fulfillment", "completion", "utilization", "cancel", "lost", "wastage", "attendance", "churn", "otif", "found", "adoption"])) return "diagnostic_only";
  return "observational";
}

function definitionResolution(input: CatalogInput, glossary?: OperationGlossaryEntry): DefinitionResolution {
  const metric = normalizeLabel(input.metric);
  if (metric.includes("mp recommendation")) return {
    definition: `Rekomendasi jumlah manpower untuk ${input.role || input.division || "fungsi terkait"} berdasarkan workload, standard productivity, jam tersedia, dan service guardrail.`,
    status: "inferred",
    confidence: "medium",
    basis: "Sumber menjelaskan ini sebagai rekomendasi MP, tetapi formula keputusan diinferensikan dari Forecast/Task, Productivity Target, Budget Mandays, Actual Mandays, dan Attendance pada role yang sama.",
    requiredContext: ["Formula rekomendasi", "Jam kerja efektif", "Skill mix", "Cut-off workload", "Service guardrail"],
  };
  const documented = (glossary?.explanation || glossary?.details || input.detail).trim();
  const normalizedDocumented = normalizeLabel(documented);
  if (documented && !["tbc", "n/a", "na", "-"].includes(normalizedDocumented)) return {
    definition: documented,
    status: "documented",
    confidence: "high",
    basis: "Deskripsi atau penjelasan eksplisit pada sumber glossary.",
    requiredContext: [],
  };

  const inferred = (definition: string, basis: string, requiredContext: string[], confidence: DefinitionResolution["confidence"] = "medium"): DefinitionResolution => ({
    definition,
    status: "inferred",
    confidence,
    basis,
    requiredContext,
  });

  if (metric.includes("inventory capacity forecast") && /(frozen|chiller|ambient)/.test(metric)) return inferred(
    `Proyeksi jumlah inventory pada zona ${metric.includes("frozen") ? "Frozen" : metric.includes("chiller") ? "Chiller" : "Ambient"} untuk horizon perencanaan yang digunakan Supply Chain dan warehouse.`,
    "Nama metric mengikuti pola forecast kapasitas per zona pada kelompok Inventory Capacity.",
    ["Horizon forecast", "Cut-off harian", "Unit qty", "In-transit/LDP inclusion"],
    "high",
  );
  if (metric.includes("inventory capacity max") && /(frozen|chiller|ambient)/.test(metric)) return inferred(
    `Batas jumlah inventory yang dapat ditampung pada zona ${metric.includes("frozen") ? "Frozen" : metric.includes("chiller") ? "Chiller" : "Ambient"} berdasarkan layout dan operating envelope yang berlaku.`,
    "Nama metric mengikuti pola maximum capacity per zona.",
    ["Tanggal berlaku kapasitas", "Blocked location", "Safety allowance"],
    "high",
  );
  if (metric.includes("inventory actual max") && /(frozen|chiller|ambient)/.test(metric)) return inferred(
    `Puncak inventory aktual harian pada zona ${metric.includes("frozen") ? "Frozen" : metric.includes("chiller") ? "Chiller" : "Ambient"}.`,
    "Nama metric mengikuti pola actual maximum inventory per zona.",
    ["Metode peak capture", "Cut-off harian", "LDP inclusion"],
    "high",
  );
  if (metric.includes("utilization actual vs forecast") && /(frozen|chiller|ambient)/.test(metric)) return inferred(
    `Rasio inventory aktual maksimum terhadap forecast pada zona ${metric.includes("frozen") ? "Frozen" : metric.includes("chiller") ? "Chiller" : "Ambient"}.`,
    "Diturunkan dari pasangan Actual Max dan Capacity Forecast pada zona yang sama.",
    ["Actual Max zona", "Forecast zona", "Formula dan zero-denominator rule"],
    "high",
  );
  if (metric.includes("utilization actual vs max") && /(frozen|chiller|ambient)/.test(metric)) return inferred(
    `Rasio inventory aktual maksimum terhadap kapasitas maksimum zona ${metric.includes("frozen") ? "Frozen" : metric.includes("chiller") ? "Chiller" : "Ambient"}.`,
    "Diturunkan dari pasangan Actual Max dan Max Capacity pada zona yang sama.",
    ["Actual Max zona", "Max Capacity aktif", "Blocked location"],
    "high",
  );
  if (metric === "relable % to inbound" || metric === "relabel % to inbound") return inferred(
    "Porsi qty inbound aktual yang benar-benar melalui proses relabel.",
    "Diturunkan dari Relabel Qty dibagi Qty Actual Inbound; tidak mewakili seluruh inbound.",
    ["Relabel Qty", "Qty Actual Inbound", "Kesamaan cut-off"],
    "high",
  );
  if (metric === "putaway productivity") return inferred(
    "Output putaway aktual per manday efektif pada periode yang sama.",
    "Diturunkan dari Putaway Done dan Actual Mandays Putaway pada role Inv-Putaway.",
    ["Putaway Done", "Actual Mandays Putaway", "Jam efektif dan adjustment"],
  );
  if (metric === "fulfillment rate % warehouse exclude troubleshoot") return inferred(
    "Persentase demand setelah cancel yang dipenuhi langsung oleh alur warehouse sebelum kontribusi recovery troubleshoot.",
    "Nama metric membedakan fulfillment dasar dari Fulfillment Rate Warehouse yang memasukkan troubleshoot.",
    ["Request setelah cancel", "RTS tanpa recovery troubleshoot", "Troubleshoot contribution"],
  );
  if (metric === "qty milkrun") return inferred(
    `Jumlah unit yang masuk ke alur ${normalizeLabel(input.division) === "inbound" ? "inbound" : "outbound"} melalui mekanisme milkrun.`,
    "Konteks diambil dari division dan pasangan Qty Milkrun pada alur inbound/outbound.",
    ["Definisi milkrun", "Cut-off", "Apakah termasuk total actual"],
    "low",
  );
  if (metric.startsWith("screening actual")) return inferred(
    `Jumlah unit yang benar-benar melalui screening pada tahap ${metric.includes("inbound") ? "inbound" : metric.includes("staging") ? "staging" : "outbound"}.`,
    "Nama metric dan role QC menunjukkan checkpoint screening aktual.",
    ["Eligibility screening", "Reject/rework result", "Kesamaan grain qty"],
  );
  if (metric.startsWith("wastage due to")) return inferred(
    `Nilai atau qty wastage yang diklasifikasikan berasal dari ${input.role.replace(/^Wastage due to\s*/i, "") || "penyebab terkait"}.`,
    "Role QC/QM menyatakan cause bucket wastage.",
    ["Unit qty/value", "Reason-code owner", "Tanggal pengakuan loss"],
  );
  if (metric === "total wastage wh") return inferred(
    "Akumulasi wastage yang menjadi tanggung jawab proses warehouse, sebelum tambahan inbound-to-bad bila dipisahkan.",
    "Posisi metric berada setelah cause buckets dan sebelum total WH + inbound-to-bad.",
    ["Komponen penyebab", "Unit qty/value", "Treatment inbound-to-bad"],
  );
  if (metric.includes("total wastage") && metric.includes("ib to bad")) return inferred(
    "Total wastage warehouse ditambah loss inbound-to-bad pada scope dan cut-off yang sama.",
    "Nama metric menyatakan rekonsiliasi dua loss pool.",
    ["Total wastage WH", "Inbound-to-bad", "Deduplication rule"],
  );
  if (["accumulation", "runrate", "% to gmv mtd", "% to gmv runrate"].includes(metric)) return inferred(
    metric === "accumulation" ? "Akumulasi wastage pada periode pelaporan aktif."
      : metric === "runrate" ? "Proyeksi wastage hingga akhir periode berdasarkan realisasi berjalan."
        : metric === "% to gmv mtd" ? "Rasio akumulasi wastage MTD terhadap GMV MTD pada scope yang sama."
          : "Rasio proyeksi wastage terhadap proyeksi GMV sampai akhir periode.",
    "Posisi metric mengikuti blok total wastage, accumulation, run-rate, dan normalisasi terhadap GMV.",
    ["Nilai wastage", "GMV dengan scope identik", "Hari berjalan", "Metode proyeksi"],
    "low",
  );
  if (metric === "gmv") return inferred(
    "Gross Merchandise Value yang dipakai sebagai denominator materialitas loss pada scope produk dan periode yang sama.",
    "Istilah bisnis standar, tetapi scope produk dan cut-off sumber belum dijelaskan.",
    ["Scope produk", "Gross/net treatment", "Timezone dan cut-off", "MTD/run-rate basis"],
    "low",
  );

  return {
    definition: `Definisi operasional ${input.metric} belum tersedia dan belum aman untuk diinferensikan hanya dari nama kolom.`,
    status: "unresolved",
    confidence: "low",
    basis: null,
    requiredContext: ["Formula", "Numerator", "Denominator", "Grain", "Owner", "Cut-off"],
  };
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

function relatedMetricsFor(metric: string, family: MetricFamily): string[] {
  const value = normalizeLabel(metric);
  if (value.includes("mp recommendation")) return ["Forecast / task", "Productivity target", "Jam efektif", "Attendance", "SLA", "Capacity"];
  if (value.includes("schedule accuracy")) return ["Budget mandays", "Scheduled mandays", "Attendance", "Actual mandays", "Workload actual"];
  if (value.includes("relabel") || value.includes("relable")) return ["Qty actual inbound", "Relabel qty", "Actual mandays relabel", "Productivity relabel"];
  if (value.includes("troubleshoot")) return ["Task created", "Task executed", "Queue aging", "Mandays troubleshooter", "Found %", "SO FR"];
  if (value.includes("% to gmv") || value.includes("wastage") || value === "gmv") return ["Wastage by cause", "Wastage value", "GMV scope sama", "MTD cut-off", "Run-rate method"];
  if (/(frozen|chiller|ambient)/.test(value) && includesAny(value, ["capacity", "utilization", "actual max"])) return ["Forecast zona", "Actual max zona", "Max capacity zona", "Putaway queue", "Overflow"];
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
  const resolution = definitionResolution(input, glossary);
  const readiness = readinessFor(input.metric, `${detail} ${glossary?.explanation ?? ""}`, mappedKeys, resolution.status);
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
    definition: resolution.definition,
    definitionStatus: resolution.status,
    definitionConfidence: resolution.confidence,
    inferenceBasis: resolution.basis,
    requiredContext: resolution.requiredContext,
    decisionUse: decisionUseFor(family, decisionRole),
    caveat: [baseCaveat, glossaryNote ? `Catatan glossary: ${glossaryNote}.` : null].filter(Boolean).join(" ") || null,
    glossaryNotes: glossaryNote,
    relatedMetrics: relatedMetricsFor(input.metric, family),
    activeCoverage: input.activeCoverage,
    mappedKeyCount,
  };
}
