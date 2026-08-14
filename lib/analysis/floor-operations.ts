import { clamp, decayScore } from "@/lib/analysis/scoring";
import type {
  AggregationMode,
  FloorBriefing,
  FloorFailureMode,
  FloorSignal,
  FloorStage,
  FloorStation,
  FloorStationState,
  MetricReading,
  Severity,
} from "@/lib/types";

/* ============================================================================
   Floor operations layer
   ----------------------------------------------------------------------------
   The KPI layer says whether the warehouse is healthy. This layer says which
   bench, lane, or desk produced that number — the PO table, the GRN lane, the
   QC gate, the relabel bench, the putaway aisle, the count sheet, the recovery
   queue, the pickface, the wave desk, the packing bench, the loading dock.

   Three kinds of content live here and they are deliberately kept apart:

   1. Measured signals. Source columns, read through the shared alias registry
      and scored with the same decay curve as the KPI engine.
   2. Protocol — WMS steps and gemba checks. Standing operating knowledge, not
      measurement. Nothing here is presented as a reading from the sheet.
   3. Failure modes. Each carries a numeric trigger, so it is either active on
      today's data or it is dormant. A mode never fires on narrative alone.

   Nothing in this file enters KPI_KEYS. Station scores are local to the station
   and never feed the warehouse health score — one definition of health stays in
   the engine's healthFrom().
   ============================================================================ */

/** Where a threshold came from. Displayed, because a threshold nobody agreed to
 *  should be arguable rather than obeyed. */
export type TargetBasis = "source_target" | "guardrail" | "working_threshold" | "none";

export interface FloorMetricRule {
  label: string;
  unit: MetricReading["unit"];
  /** null means "show it, do not grade it". */
  target: number | null;
  higher: boolean;
  /** Points of shortfall that halve the score. */
  slope: number;
  aggregation: AggregationMode;
  /**
   * How the source stores the number. `fraction` is always multiplied by 100 —
   * never conditionally. Collective attainment reaches 2.46 on a light day, and
   * a "multiply if below 2" heuristic would have rendered 246% as 2.5%.
   */
  scale: "fraction" | "percent" | "raw";
  basis: TargetBasis;
  /** How to read this while standing at the station, not how it is computed. */
  floorNote: string;
}

const pct = (
  label: string,
  target: number | null,
  higher: boolean,
  slope: number,
  basis: TargetBasis,
  floorNote: string,
  scale: FloorMetricRule["scale"] = "fraction",
): FloorMetricRule => ({ label, unit: "percent", target, higher, slope, aggregation: "average", scale, basis, floorNote });

const qty = (label: string, floorNote: string, aggregation: AggregationMode = "sum", target: number | null = null, higher = false, slope = 8): FloorMetricRule =>
  ({ label, unit: "qty", target, higher, slope, aggregation, scale: "raw", basis: target === null ? "none" : "working_threshold", floorNote });

const rate = (label: string, floorNote: string, aggregation: AggregationMode = "average"): FloorMetricRule =>
  ({ label, unit: "ratio", target: null, higher: true, slope: 5, aggregation, scale: "raw", basis: "none", floorNote });

const md = (label: string, floorNote: string): FloorMetricRule =>
  ({ label, unit: "mandays", target: null, higher: true, slope: 5, aggregation: "sum", scale: "raw", basis: "none", floorNote });

/**
 * Rules for source columns the KPI engine does not grade. Kept in a separate
 * table from the engine's `rules` on purpose: merging them would silently
 * change how existing threads and trends read the same keys.
 */
export const FLOOR_METRIC_RULES: Record<string, FloorMetricRule> = {
  // --- Pre-shift: the day's plan and the people who will run it -------------
  forecast_weekly_outbound: qty("Rencana outbound", "Volume yang dijanjikan rencana mingguan untuk rentang ini."),
  forecast_mpp_outbound: qty("Rencana MPP outbound", "Volume yang dipakai menyusun jumlah orang. Beda dengan rencana mingguan berarti dua angka dipakai untuk dua keputusan."),
  forecast_weekly_inbound: qty("Rencana inbound", "Volume masuk yang direncanakan."),
  outbound_capacity: qty("Kapasitas SO harian", "Batas yang dipakai menghitung utilisasi outbound.", "latest"),
  inbound_capacity: qty("Kapasitas inbound harian", "Batas yang dipakai menghitung utilisasi inbound.", "latest"),
  scheduled_mandays: md("Manday terjadwal", "Yang masuk jadwal sebelum ketidakhadiran diperhitungkan."),
  budget_mandays: md("Manday budget", "Rencana keseluruhan gudang."),
  available_slot_mp: qty("Slot MP tersedia", "Kursi yang benar-benar terisi orang.", "latest"),
  budget_slot_mp: qty("Slot MP budget", "Kursi yang dianggarkan. Selisih dengan tersedia adalah lubang struktural, bukan ketidakhadiran harian.", "latest"),
  schedule_accuracy: pct("Akurasi jadwal", null, true, 5, "none", "Definisi sumber belum dikonfirmasi dan nilainya bisa melewati 100%. Ditampilkan untuk diperiksa, tidak dinilai.", "fraction"),

  // --- Station: PO desk and vendor arrival ----------------------------------
  po_adjustment: qty("PO adjustment", "Berapa kali qty PO diubah agar cocok dengan fisik. Satu pun perlu nama vendor dan alasannya.", "sum", 0, false, 22),
  checker_otif: pct("Vendor OTIF", 95, true, 4, "working_threshold", "Kiriman tepat waktu dan tepat jumlah. Rendah di sini berarti kurva kedatangan tidak bisa dipakai untuk mengatur jumlah checker."),
  checker_on_time: qty("Kiriman tepat waktu", "Jumlah kiriman yang masuk sesuai slot dock.", "sum"),
  checker_late: qty("Kiriman terlambat", "Jumlah kiriman di luar slot. Bandingkan dengan antrean truk yang Anda lihat di dock.", "sum", 0, false, 6),
  incoming_inbound: qty("Qty incoming", "Yang dibongkar dari truk sebelum GRN. Selisihnya dengan qty actual adalah barang yang tertahan di lantai."),
  actual_inbound: qty("Qty actual inbound", "Yang benar-benar masuk sistem lewat GRN posting."),

  // --- Station 2 · Checker inbound and GRN ----------------------------------
  checker_productivity: rate("Output checker", "Pcs per manday checker pada hari itu. Baca bersama targetnya, bukan sendirian."),
  checker_productivity_target: rate("Target checker", "Target kolektif dari sumber. Ini pembanding sah untuk output di atas."),
  checker_productivity_individual: rate("Output checker per orang", "Rata-rata individu. Jarak jauh dengan angka kolektif biasanya berarti scanner dipakai bergantian tanpa logout."),
  actual_checker_mandays: md("Manday checker aktual", "Orang yang benar-benar bekerja di lane GRN."),
  budget_checker_mandays: md("Manday checker budget", "Rencana. Selisih ke bawah hanya efisiensi bila SLA tetap aman."),

  // --- Station 3 · QC gate and bad stock ------------------------------------
  inbound_to_bad_rate: pct("Inbound to bad", 0.5, false, 26, "working_threshold", "Bagian barang masuk yang langsung jatuh ke bad stock. Naik = masalah vendor, handling bongkar, atau rantai dingin."),
  inbound_to_bad_qty: qty("Inbound to bad (qty)", "Volume absolutnya. Persentase kecil pada volume besar tetap uang."),
  inbound_to_lost_rate: pct("Inbound to lost", 0.3, false, 30, "working_threshold", "Barang tercatat masuk lalu hilang jejak sebelum tersimpan. Hampir selalu soal GRN tanpa lokasi tujuan."),
  badstock_qty: qty("Bad stock aktual", "Isi area bad stock hari ini. Kalau tidak turun-turun, disposal-nya yang macet, bukan QC-nya."),
  badstock_sla: pct("SLA bad stock", 95, true, 5, "working_threshold", "Kecepatan bad stock diproses sampai keluar dari area good."),
  wastage_handling: { label: "Wastage handling", unit: "currency", target: null, higher: false, slope: 5, aggregation: "sum", scale: "raw", basis: "none", floorNote: "Nilai loss akibat penanganan. Nilai negatif adalah koreksi periode sebelumnya, bukan penghematan." },
  wastage_expired: { label: "Wastage expired", unit: "currency", target: null, higher: false, slope: 5, aggregation: "sum", scale: "raw", basis: "none", floorNote: "Loss karena umur simpan. Ini keputusan FEFO di putaway dan replenish, bukan kesalahan picker." },

  // --- Station 4 · Relabel bench --------------------------------------------
  relabel_share: pct("Relabel to inbound", null, false, 5, "none", "Porsi inbound yang benar-benar lewat bench relabel. Ini penentu kebutuhan orang di sini, bukan total inbound."),
  relabel_qty: qty("Relabel qty", "Pcs yang dilabel ulang."),
  relabel_actual_mandays: md("Manday relabel aktual", "Orang di bench relabel."),
  relabel_budget_mandays: md("Manday relabel budget", "Rencana orang di bench relabel."),

  // --- Station 5 · Putaway aisle --------------------------------------------
  putaway_utilization: pct("Putaway utilization", 85, false, 6, "guardrail", "Beban putaway terhadap kapasitasnya. Di atas 85% palet mulai menginap di staging."),
  putaway_capacity: qty("Kapasitas putaway", "Batas harian yang dipakai sebagai pembanding utilization.", "latest"),
  putaway_productivity_collective: rate("Output putaway (kolektif)", "Kolom kolektif dari sumber. Nilainya berbeda dari kolom Putaway Productivity — dua definisi, jangan dijumlahkan."),
  actual_putaway_mandays: md("Manday putaway aktual", "Orang yang mengerjakan task putaway."),
  budget_putaway_mandays: md("Manday putaway budget", "Rencana orang putaway."),
  putaway_suggestion_accuracy: pct("Akurasi saran lokasi", 95, true, 5, "working_threshold", "Seberapa sering lokasi saran WMS dipakai apa adanya. Override tanpa reason code hari ini adalah LDP besok."),

  // --- Station 6 · Zone capacity --------------------------------------------
  inventory_actual: qty("Inventory aktual (puncak)", "Isi gudang pada titik tertinggi hari itu.", "max"),
  inventory_capacity: qty("Kapasitas maksimum", "Batas yang tercatat. Validasi ulang setiap kali layout berubah.", "max"),

  // --- Station 7 · Cycle count, SLOC accuracy -------------------------------
  inventory_accuracy_qty: pct("Akurasi qty", 98, true, 5, "guardrail", "Kecocokan jumlah fisik dan sistem."),
  inventory_accuracy_sloc: pct("Akurasi SLOC", 98, true, 5, "guardrail", "Kecocokan lokasi. Qty benar di lokasi salah tetap membuat picker gagal."),
  sloc_qty_accuracy: pct("Akurasi SLOC × qty", 98, true, 5, "guardrail", "Keduanya benar sekaligus. Inilah angka yang dirasakan picker."),
  ldp_qty: qty("LDP (qty)", "Selisih kurang. Naik berarti barang berpindah tanpa transaksi."),
  lbh_qty: qty("LBH (qty)", "Selisih lebih. Sering pasangan dari LDP di SLOC sebelah."),
  ldp_value: { label: "LDP (nilai)", unit: "currency", target: null, higher: false, slope: 5, aggregation: "sum", scale: "raw", basis: "none", floorNote: "Nilai selisih kurang. Prioritas audit mengikuti nilai, bukan jumlah kasus." },
  ldp_stock_share: pct("LDP vs stok", 0.5, false, 24, "working_threshold", "LDP relatif terhadap stok tersimpan. Ini yang membuat angka LDP bisa dibandingkan antar gudang."),
  lost_to_found: qty("Lost to found", "Barang hilang yang berhasil ditemukan kembali lewat pencarian."),

  // --- Station 8 · Movement and troubleshoot --------------------------------
  troubleshoot_created: qty("Task dibuat", "Task recovery yang masuk antrean hari ini."),
  troubleshoot_executed: qty("Task dikerjakan", "Task yang benar-benar diselesaikan."),
  troubleshoot_so_contribution: pct("Kontribusi ke SO FR", null, true, 5, "none", "Bagian fulfillment yang ditolong recovery. Tinggi berarti service ditopang pemadam kebakaran, bukan proses normal."),

  // --- Station 9 · Replenishment to pickface --------------------------------
  replenishment_task: qty("Task replenish", "Permintaan isi ulang pickface."),
  replenishment_done: qty("Replenish selesai", "Yang benar-benar terisi."),
  replenishment_productivity: rate("Output replenish", "Pcs per manday replenish."),
  replenishment_productivity_target: rate("Target replenish", "Pembanding sah untuk output replenish."),
  replenishment_actual_mandays: md("Manday replenish aktual", "Orang yang mengisi pickface."),

  // --- Station 10 · Wave desk and picking -----------------------------------
  so_ratio: rate("SO ratio", "Pcs per SO. Naik berarti order makin besar; picker yang sama akan lebih lambat per SO."),
  seuic_adoption: pct("Adopsi SEUIC", 98, true, 6, "working_threshold", "Porsi kerja yang benar-benar lewat device. Yang tidak lewat device tidak punya jejak dan tidak bisa dinilai."),
  picker_productivity: rate("Output picker", "Pcs per manday picker."),
  picker_productivity_target: rate("Target picker", "Pembanding sah untuk output picker."),
  picker_regular_productivity: rate("Output picker regular", "Tanpa OJT. Jarak dengan kolektif adalah biaya kurva belajar, bukan kegagalan metode."),
  picker_productivity_user: rate("Output picker per login", "Per user WMS. Ini yang membedakan orang lambat dari proses lambat."),
  actual_picker_mandays: md("Manday picker aktual", "Orang di lantai picking."),
  budget_picker_mandays: md("Manday picker budget", "Rencana orang picking."),
  pick_to_lost: pct("Pick to lost", 0.2, false, 34, "working_threshold", "Task picking yang berakhir tanpa barang. Ini pertemuan antara akurasi SLOC dan kesiapan pickface."),
  pick_to_lost_qty: qty("Pick to lost (qty)", "Volume absolut task picking yang gagal."),
  pick_to_bad: pct("Pick to bad", 0.2, false, 34, "working_threshold", "Barang diambil lalu ditolak karena kondisi. Cek FEFO dan cara penumpukan di pickface."),

  // --- Station 11 · Packing bench and staging -------------------------------
  packer_productivity: rate("Output packer", "Pcs per manday packer."),
  packer_productivity_target: rate("Target packer", "Pembanding sah untuk output packer."),
  packer_attainment_source: pct("Pencapaian packer", 100, true, 3, "source_target", "Output packer terhadap targetnya, langsung dari sumber."),
  actual_packer_mandays: md("Manday packer aktual", "Orang di meja packing."),
  budget_packer_mandays: md("Manday packer budget", "Rencana orang packing."),
  staging_lost_rate: pct("Koli hilang di staging", 0.1, false, 40, "working_threshold", "Koli yang lolos dari staging tanpa naik truk. Hampir selalu koli tanpa label atau tanpa scan."),
  staging_lost_qty: qty("Koli hilang (qty)", "Jumlah koli. Satu koli hilang adalah satu toko yang komplain."),

  // --- Station 12 · Loading dock and hub handover ---------------------------
  loader_productivity: rate("Output loader", "Koli atau pcs per manday loader."),
  loader_productivity_target: rate("Target loader", "Pembanding sah untuk output loader."),
  loader_attainment_source: pct("Pencapaian loader", 100, true, 3, "source_target", "Output loader terhadap targetnya, langsung dari sumber."),
  actual_loader_mandays: md("Manday loader aktual", "Orang di dock loading."),
  budget_loader_mandays: md("Manday loader budget", "Rencana orang loading."),
  outbound_rts: qty("RTS", "Selesai disiapkan warehouse. Di sinilah tanggung jawab warehouse berakhir."),
  outbound_actual_hub: qty("Diterima hub", "Yang benar-benar diakui hub. Selisih dengan RTS wajib ditutup hari yang sama."),
  outbound_unfulfilled: qty("Tidak terpenuhi", "Permintaan yang tidak berubah menjadi barang siap kirim."),
  fulfillment_hub: pct("FR inbound hub", 99, true, 8, "guardrail", "Sisi hub dari serah terima yang sama. Beda dengan FR warehouse berarti dokumen dan fisik tidak bertemu."),
  on_time_depart: pct("On-time depart", 98, true, 5, "guardrail", "Truk meninggalkan dock sesuai cut-off, bukan sekadar dispatch di sistem."),
  truck_dedicated: qty("Truk dedicated", "Armada yang dijanjikan untuk hari itu.", "sum"),
  actual_truck_delivered: qty("Truk terkirim", "Armada yang benar-benar jalan.", "sum"),
  truck_on_call: qty("Truk on call", "Armada cadangan yang dipanggil. Naik terus berarti rencana armadanya yang kurang.", "sum"),

  // --- Quality and business value -------------------------------------------
  // Two scopes, deliberately read through separate keys. The shared
  // `total_wastage` alias covers both column names at once, so summing through
  // it would count the warehouse figure twice.
  total_wastage_wh: { label: "Wastage gudang", unit: "currency", target: null, higher: false, slope: 5, aggregation: "sum", scale: "raw", basis: "none", floorNote: "Loss yang menjadi tanggung jawab proses gudang saja." },
  total_wastage_all: { label: "Wastage total", unit: "currency", target: null, higher: false, slope: 5, aggregation: "sum", scale: "raw", basis: "none", floorNote: "Gudang ditambah barang yang sudah rusak sejak datang. Selisih keduanya adalah porsi vendor." },
  wastage_inbound_to_bad: { label: "Wastage inbound-to-bad", unit: "currency", target: null, higher: false, slope: 5, aggregation: "sum", scale: "raw", basis: "none", floorNote: "Loss yang sudah ada sejak barang datang. Ini masuk klaim vendor, bukan perbaikan internal." },
  wastage_others: { label: "Wastage lain-lain", unit: "currency", target: null, higher: false, slope: 5, aggregation: "sum", scale: "raw", basis: "none", floorNote: "Kalau kategori ini yang terbesar, reason code-nya yang perlu diperbaiki lebih dulu." },
  gmv: { label: "GMV", unit: "currency", target: null, higher: true, slope: 5, aggregation: "sum", scale: "raw", basis: "none", floorNote: "Cakupan produk dan cut-off belum dikonfirmasi. Dipakai sebagai konteks skala, bukan penyebut resmi." },

  // --- Cross-station people signals -----------------------------------------
  attendance_inbound: pct("Kehadiran inbound", 96, true, 5, "guardrail", "Kehadiran fungsi ini, bukan rata-rata gudang."),
  attendance_inventory: pct("Kehadiran inventory", 96, true, 5, "guardrail", "Kehadiran fungsi ini, bukan rata-rata gudang."),
  attendance_outbound: pct("Kehadiran outbound", 96, true, 5, "guardrail", "Kehadiran fungsi ini, bukan rata-rata gudang."),
  mandays_daily_worker: md("Manday harian lepas", "Porsi tenaga harian. Tinggi berarti output hari itu bergantung pada orang yang paling sedikit dilatih."),
};

/** Engine rule keys the stations borrow. The engine already derives and grades
 *  these; the floor layer must not compute a second, disagreeing version. */
export const FLOOR_ENGINE_KEYS = [
  "inbound_forecast_accuracy",
  "sla_checker_inbound",
  "inbound_productivity_attainment",
  "relabel_productivity_attainment",
  "putaway_completion",
  "putaway_productivity_attainment",
  "inventory_capacity_utilization",
  "dcc_accuracy",
  "found_rate",
  "troubleshoot_fr",
  "replenishment_completion",
  "forecast_accuracy",
  "cancel_rate",
  "outbound_capacity_utilization",
  "productivity_attainment",
  "pick_to_pf",
  "on_time_dispatch",
  "on_time_arrival",
  "truck_delivered_rate",
  "inbound_capacity_utilization",
  "attendance_all",
  "churn_all",
  "mp_fulfill_accuracy",
] as const;

/* ------------------------------------------------------------------------- */

export interface FloorAggregate {
  value: number | null;
  coverage: number;
}

export interface FloorResolver {
  /** Raw aggregate for an alias-mapped source column, before any scaling. */
  raw: (key: string, aggregation: AggregationMode) => FloorAggregate;
  /** Readings the engine already derived, so both layers quote one number. */
  kpi: (key: string) => MetricReading | undefined;
}

type Values = Record<string, number | null>;

interface FailureModeConfig extends Omit<FloorFailureMode, "active" | "evidence"> {
  /** Returns the resolved evidence when the mode fires, or null when dormant. */
  evaluate: (value: Values, fmt: Formatter) => string[] | null;
}

interface Formatter {
  pct: (key: string, precision?: number) => string;
  num: (key: string, precision?: number) => string;
}

interface StationConfig {
  id: string;
  stage: FloorStage;
  title: string;
  shiftMoment: string;
  owner: string;
  purpose: string;
  wmsSteps: string[];
  gembaChecks: string[];
  handoffRisk: string;
  signals: string[];
  unmeasured: string[];
  failureModes: FailureModeConfig[];
}

const above = (value: number | null, limit: number) => value !== null && value > limit;
const below = (value: number | null, limit: number) => value !== null && value < limit;

export const FLOOR_STATIONS: StationConfig[] = [
  {
    id: "day-plan",
    stage: "Perencanaan",
    title: "Rencana hari ini & batas kapasitas",
    shiftMoment: "H-1 sore, dikunci sebelum shift pertama",
    owner: "Planning + WH Head",
    purpose: "Menetapkan berapa yang akan dikerjakan hari ini dan memastikan angkanya masih muat di dalam batas fisik gudang sebelum satu orang pun dijadwalkan.",
    wmsSteps: [
      "Bandingkan rencana mingguan dengan rencana MPP. Kalau berbeda, tentukan mana yang dipakai untuk orang dan mana untuk kapasitas — jangan dipakai bergantian.",
      "Cek volume rencana terhadap kapasitas SO harian dan kapasitas inbound. Rencana yang melewati kapasitas bukan rencana, itu daftar keinginan.",
      "Kunci cut-off SO per rute, bukan satu cut-off untuk seluruh hari.",
      "Sebarkan rencana ke tiap fungsi dalam satuan yang mereka pakai: pcs untuk picking, palet untuk putaway, koli untuk loading.",
    ],
    gembaChecks: [
      "Lihat hari dalam seminggu. Senin dan Jumat hampir selalu berbeda; rencana yang sama untuk keduanya akan salah dua kali.",
      "Periksa apakah ada promo, hari besar, atau SKU baru yang masuk. Ketiganya mengubah bentuk permintaan, bukan hanya jumlahnya.",
      "Tanyakan ke leader apakah rencana kemarin terasa masuk akal di lantai. Angka yang selalu meleset ke arah yang sama sudah diketahui tim jauh sebelum muncul di laporan.",
    ],
    handoffRisk: "Rencana yang melewati kapasitas akan diselesaikan lewat pembatalan di sore hari, dan pembatalan itu akan terlihat sebagai keputusan outbound, bukan sebagai kesalahan perencanaan.",
    signals: ["forecast_accuracy", "inbound_forecast_accuracy", "outbound_capacity_utilization", "inbound_capacity_utilization", "forecast_weekly_outbound", "forecast_mpp_outbound", "outbound_capacity", "so_ratio"],
    unmeasured: ["Sebaran permintaan per jam", "Cut-off per rute", "Kalender promo dan SKU baru"],
    failureModes: [
      {
        id: "two-plans",
        title: "Dua angka rencana dipakai bergantian",
        floorSymptom: "Jumlah orang disiapkan dari satu angka, target volume diumumkan dari angka lain, dan keduanya tidak pernah dibandingkan.",
        dataSignature: "Rencana MPP berbeda material dari rencana mingguan pada rentang yang sama.",
        rootCauses: ["MPP dan rencana mingguan punya horizon berbeda", "Revisi rencana tidak sampai ke penyusun jadwal", "Tidak ada satu angka yang disepakati sebagai acuan"],
        containment: "Pilih satu angka untuk hari ini dan umumkan mana yang dipakai; jangan menyelaraskan keduanya di tengah shift.",
        correction: "Tetapkan satu angka acuan beserta jam kuncinya, dan turunkan angka lain darinya.",
        owner: "Planning",
        trigger: "Selisih rencana MPP dan rencana mingguan lebih dari 10%.",
        evaluate: (value, fmt) => {
          const mpp = value.forecast_mpp_outbound;
          const weekly = value.forecast_weekly_outbound;
          if (mpp === null || weekly === null || weekly <= 0) return null;
          const gap = Math.abs(mpp - weekly) / weekly;
          if (gap <= 0.1) return null;
          return [`Rencana MPP ${fmt.num("forecast_mpp_outbound")}`, `Rencana mingguan ${fmt.num("forecast_weekly_outbound")}`, `Selisih ${(gap * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`];
        },
      },
      {
        id: "plan-over-capacity",
        title: "Rencana melewati batas kapasitas",
        floorSymptom: "Semua orang sibuk sejak jam pertama dan tidak ada satu pun jam yang longgar untuk mengejar ketinggalan.",
        dataSignature: "Utilisasi outbound atau inbound di atas 85%.",
        rootCauses: ["Kapasitas master tidak pernah divalidasi ulang", "Rencana disusun dari permintaan, bukan dari kemampuan", "Tidak ada mekanisme menolak volume"],
        containment: "Tentukan rute atau SKU mana yang digeser ke hari berikutnya sekarang, sebelum jam sibuk—bukan lewat pembatalan sore hari.",
        correction: "Sepakati aturan penerimaan volume: di atas berapa persen kapasitas, sebagian volume dijadwal ulang di muka.",
        owner: "Planning + WH Head",
        trigger: "Utilisasi outbound atau inbound >85%.",
        evaluate: (value, fmt) => {
          if (!above(value.outbound_capacity_utilization, 85) && !above(value.inbound_capacity_utilization, 85)) return null;
          return [`Utilisasi outbound ${fmt.pct("outbound_capacity_utilization")}`, `Utilisasi inbound ${fmt.pct("inbound_capacity_utilization")}`, `Kapasitas SO ${fmt.num("outbound_capacity")}`];
        },
      },
    ],
  },
  {
    id: "roster",
    stage: "Perencanaan",
    title: "Roster, kehadiran & tenaga cadangan",
    shiftMoment: "H-1 malam sampai apel pagi",
    owner: "Personalia + SPV fungsi",
    purpose: "Memastikan orang yang hadir cukup untuk beban yang sudah dikunci, dan lubangnya diketahui sebelum shift mulai—bukan ditemukan jam sebelas siang.",
    wmsSteps: [
      "Bandingkan manday terjadwal dengan manday budget. Selisihnya adalah keputusan, dan keputusan itu harus punya nama.",
      "Bandingkan slot MP tersedia dengan slot budget. Kekurangan di sini bersifat struktural dan tidak bisa ditutup dengan lembur.",
      "Catat ketidakhadiran sebelum apel selesai, bukan setelah pekerjaan berjalan.",
      "Tandai siapa yang boleh dipindah antar fungsi hari ini, beserta jamnya.",
    ],
    gembaChecks: [
      "Hitung kepala di apel dan bandingkan dengan daftar. Selisih di sini adalah selisih yang paling mahal karena semua rencana lain dibangun di atasnya.",
      "Lihat komposisi tim per zona: berapa regular, berapa OJT, berapa harian lepas. Tim yang sama jumlahnya bisa berbeda jauh kemampuannya.",
      "Pastikan orang baru tidak ditempatkan di zona tersulit hari ini. Itu menghasilkan dua kerugian sekaligus: lambat dan salah.",
      "Cek siapa yang sudah lembur dua hari berturut-turut. Hari ketiga produktivitasnya akan turun dan kesalahannya naik.",
    ],
    handoffRisk: "Kekurangan orang yang tidak diketahui pagi hari akan muncul sore hari sebagai SLA gagal atau permintaan dibatalkan, dan pada titik itu pilihannya tinggal yang buruk.",
    signals: ["attendance_all", "churn_all", "mp_fulfill_accuracy", "scheduled_mandays", "budget_mandays", "available_slot_mp", "budget_slot_mp", "mandays_daily_worker", "schedule_accuracy"],
    unmeasured: ["Kehadiran per jam", "Komposisi regular vs OJT per shift", "Jam lembur per orang", "Alasan ketidakhadiran"],
    failureModes: [
      {
        id: "structural-shortfall",
        title: "Kursi kosong, bukan orang tidak hadir",
        floorSymptom: "Tim terasa kurang setiap hari, bukan hanya pada hari tertentu.",
        dataSignature: "Slot MP tersedia di bawah slot budget secara konsisten.",
        rootCauses: ["Rekrutmen tertinggal dari churn", "Slot dibekukan tanpa penyesuaian beban", "Turnover terkonsentrasi di satu fungsi"],
        containment: "Jangan menutup lubang struktural dengan lembur harian—itu memindahkan biaya tanpa menyelesaikan apa pun.",
        correction: "Bawa selisih slot ke rekrutmen dengan angka, dan sesuaikan target sementara sampai kursinya terisi.",
        owner: "Personalia",
        trigger: "Slot MP tersedia < slot MP budget.",
        evaluate: (value, fmt) => {
          const available = value.available_slot_mp;
          const budget = value.budget_slot_mp;
          if (available === null || budget === null || available >= budget) return null;
          return [`Slot tersedia ${fmt.num("available_slot_mp")} vs budget ${fmt.num("budget_slot_mp")}`, `Kehadiran ${fmt.pct("attendance_all")}`, `Churn ${fmt.pct("churn_all")}`];
        },
      },
      {
        id: "daily-worker-dependence",
        title: "Hari ini bergantung pada tenaga harian",
        floorSymptom: "Sebagian besar wajah di zona tertentu belum pernah Anda lihat minggu lalu.",
        dataSignature: "Manday tenaga harian terbaca nyata pada rentang aktif.",
        rootCauses: ["Kursi tetap kosong", "Lonjakan volume ditutup tenaga lepas", "Kehadiran regular rendah"],
        containment: "Tempatkan tenaga harian berpasangan dengan regular, dan jangan di zona bernilai tinggi.",
        correction: "Ukur selisih output regular dan harian; kalau besar, biaya sebenarnya bukan di upah tapi di rework.",
        owner: "Personalia + SPV fungsi",
        trigger: "Manday tenaga harian > 0 pada rentang aktif.",
        evaluate: (value, fmt) => above(value.mandays_daily_worker, 0)
          ? [`Manday harian lepas ${fmt.num("mandays_daily_worker", 1)}`, `Manday terjadwal ${fmt.num("scheduled_mandays", 1)}`, `Kehadiran ${fmt.pct("attendance_all")}`]
          : null,
      },
      {
        id: "attendance-gap",
        title: "Kehadiran di bawah ambang",
        floorSymptom: "Setiap fungsi memulai hari dengan menghitung ulang siapa yang mengerjakan apa.",
        dataSignature: "Kehadiran keseluruhan di bawah 96%.",
        rootCauses: ["Ketidakhadiran mendadak tidak punya cadangan", "Jadwal disusun tanpa penyangga", "Churn tinggi di satu fungsi"],
        containment: "Tutup fungsi dengan risiko SLA tertinggi lebih dulu; jangan membagi kekurangan rata ke semua fungsi.",
        correction: "Tetapkan cadangan minimum per fungsi berdasarkan pola ketidakhadiran empat minggu terakhir.",
        owner: "Personalia",
        trigger: "Kehadiran <96%.",
        evaluate: (value, fmt) => below(value.attendance_all, 96)
          ? [`Kehadiran ${fmt.pct("attendance_all")}`, `Ketepatan pemenuhan MP ${fmt.pct("mp_fulfill_accuracy")}`, `Churn ${fmt.pct("churn_all")}`]
          : null,
      },
    ],
  },
  {
    id: "po-arrival",
    stage: "Inbound",
    title: "Penerimaan PO & kedatangan vendor",
    shiftMoment: "Sebelum shift sampai gelombang bongkar pertama",
    owner: "Admin Inbound + Leader Dock",
    purpose: "Memastikan setiap unit yang turun dari truk punya PO yang sah, slot dock yang benar, dan antrean yang sebanding dengan jumlah checker yang hadir jam itu.",
    wmsSteps: [
      "Buka daftar PO open: nomor PO, vendor, SKU, qty, ETA. PO yang tidak ada di daftar tidak boleh dibongkar.",
      "Kunci slot dock per vendor; satu slot satu PO, jangan digabung agar selisih bisa ditelusuri.",
      "Buat GR draft dari PO — jangan mengetik ulang SKU dan qty dari surat jalan.",
      "PO Adjustment hanya lewat approval, dengan reason code dan nama vendor tercatat di baris yang sama.",
      "Tandai sumber kedatangan: vendor direct atau milkrun. Keduanya punya kurva jam yang berbeda.",
    ],
    gembaChecks: [
      "Surat jalan dihitung ulang terhadap fisik sebelum palet turun. Dua orang: satu menghitung, satu mencatat — bukan satu orang membaca surat jalan sambil mengangguk.",
      "Segel truk difoto sebelum dibuka. Untuk chiller dan frozen, suhu dicatat di titik itu juga, bukan di ruang admin.",
      "Palet dijejer per PO dan label PO menghadap lorong, supaya checker tidak memutari palet untuk membaca.",
      "Hitung truk yang menunggu terhadap lane checker yang aktif. Lebih dari dua truk per lane berarti antrean, bukan kesibukan.",
    ],
    handoffRisk: "PO yang dibongkar tanpa GR draft membuat checker mengejar dokumen sambil menghitung barang — dan itu muncul sebagai SLA checker yang jelek, bukan sebagai masalah admin.",
    signals: ["inbound_forecast_accuracy", "checker_otif", "checker_on_time", "checker_late", "po_adjustment", "incoming_inbound", "actual_inbound"],
    unmeasured: ["Jam kedatangan per truk", "Waktu tunggu di dock", "Reason code PO adjustment", "Nama vendor di balik keterlambatan"],
    failureModes: [
      {
        id: "arrival-curve-mismatch",
        title: "Kedatangan tidak mengikuti rencana",
        floorSymptom: "Dock penuh truk pagi hari lalu kosong sepanjang siang, sementara jumlah checker tetap sama sepanjang shift.",
        dataSignature: "Qty actual inbound jauh dari forecast weekly, sementara manday checker tidak bergerak.",
        rootCauses: ["ETA vendor tidak dikonfirmasi ulang H-1", "Slot dock dibagi rata, bukan mengikuti kurva kedatangan", "Milkrun dan vendor direct dijadwalkan di jam yang sama"],
        containment: "Pindahkan checker ke gelombang kedatangan yang nyata siang ini; jangan menambah orang, cukup memindahkan.",
        correction: "Kunci konfirmasi ETA H-1 pukul 16.00 dan alokasikan slot dock per jam berdasar realisasi 4 minggu terakhir.",
        owner: "Admin Inbound + Planning",
        trigger: "Inbound forecast accuracy di luar 85–115%.",
        evaluate: (value, fmt) => {
          const accuracy = value.inbound_forecast_accuracy;
          if (accuracy === null || (accuracy >= 85 && accuracy <= 115)) return null;
          return [`Inbound forecast accuracy ${fmt.pct("inbound_forecast_accuracy")}`, `Qty actual inbound ${fmt.num("actual_inbound")}`, `Qty incoming ${fmt.num("incoming_inbound")}`];
        },
      },
      {
        id: "vendor-otif-drag",
        title: "OTIF vendor menahan seluruh alur inbound",
        floorSymptom: "Barang datang tidak lengkap atau di luar jam, dan checker menunggu sisa kiriman sambil lane menganggur.",
        dataSignature: "OTIF di bawah 95% berulang, biasanya bersamaan dengan jumlah kiriman terlambat yang naik.",
        rootCauses: ["Komitmen slot tidak masuk kontrak vendor", "Perubahan PO mendadak dari sisi buyer", "Kapasitas armada vendor tidak sesuai ukuran PO"],
        containment: "Tahan lane untuk kiriman terlambat, jangan membuka lane baru; catat vendor dan jam untuk eskalasi hari itu juga.",
        correction: "Bawa Pareto vendor terlambat ke review mingguan dengan buyer dan pasang konsekuensi slot.",
        owner: "Leader Dock + Buyer",
        trigger: "OTIF <95% atau kiriman terlambat > 0 pada window aktif.",
        evaluate: (value, fmt) => {
          if (!below(value.checker_otif, 95) && !above(value.checker_late, 0)) return null;
          return [`OTIF ${fmt.pct("checker_otif")}`, `Kiriman terlambat ${fmt.num("checker_late")}`, `Kiriman tepat waktu ${fmt.num("checker_on_time")}`];
        },
      },
      {
        id: "po-adjustment-habit",
        title: "Selisih PO ditutup dengan adjustment",
        floorSymptom: "Angka di sistem cocok pada akhir hari, padahal jumlah fisik yang turun tidak pernah sama dengan PO.",
        dataSignature: "PO Adjustment muncul berulang, bukan sebagai kejadian tunggal.",
        rootCauses: ["Hitung ulang tidak dilakukan sebelum bongkar", "Adjustment dipakai untuk mempercepat posting", "Short delivery vendor tidak pernah ditagihkan"],
        containment: "Setiap adjustment hari ini harus punya foto fisik dan nama vendor sebelum di-approve.",
        correction: "Pisahkan short delivery vendor dari salah hitung internal; yang pertama masuk klaim, yang kedua masuk coaching.",
        owner: "Admin Inbound + SPV Inbound",
        trigger: "PO Adjustment > 0 pada window aktif.",
        evaluate: (value, fmt) => above(value.po_adjustment, 0) ? [`PO adjustment ${fmt.num("po_adjustment")} kejadian`, `Qty incoming ${fmt.num("incoming_inbound")}`, `Qty actual inbound ${fmt.num("actual_inbound")}`] : null,
      },
    ],
  },
  {
    id: "grn-checker",
    stage: "Inbound",
    title: "Checker inbound & pemrosesan GRN",
    shiftMoment: "Sepanjang gelombang bongkar sampai posting terakhir",
    owner: "SPV Inbound + Checker",
    purpose: "Mengubah barang fisik menjadi stok bersistem yang benar sejak baris pertama: qty, batch, expired, dan kondisi, sebelum apa pun bergerak ke penyimpanan.",
    wmsSteps: [
      "Scan per SKU ke baris GR; qty, batch, expired, dan kondisi diisi pada baris yang sama, bukan diperbaiki setelah posting.",
      "Tandai baris discrepancy — short, over, damage — sebelum posting. Setelah posting, semuanya menjadi pekerjaan inventory.",
      "Posting GRN memindahkan stok ke SLOC receiving, bukan ke pickface. Jangan potong jalur.",
      "Cetak label palet atau LPN dari hasil GRN dan tempel sebelum palet meninggalkan lane.",
      "Login device atas nama sendiri. Scanner berpindah tangan tanpa logout membuat produktivitas per user tidak berarti apa-apa.",
    ],
    gembaChecks: [
      "Satu checker satu lane. Kalau dua orang berbagi satu scanner, output kolektif naik dan output per login jatuh — periksa keduanya bersama.",
      "Tanggal expired diketik dari kemasan fisik, bukan disalin dari baris sebelumnya. Ini sumber wastage expired tiga bulan lagi.",
      "Garis lantai memisahkan palet yang sudah GRN dan yang belum. Kalau garisnya tidak ada, buat hari ini.",
      "Bandingkan jam bongkar terakhir dengan jam posting terakhir. Selisihnya adalah SLA yang sebenarnya, bukan yang di laporan.",
    ],
    handoffRisk: "GRN yang di-posting menumpuk di akhir shift melempar seluruh antrean putaway ke shift berikutnya, dan yang terlihat besok adalah palet menginap di staging.",
    signals: ["sla_checker_inbound", "inbound_productivity_attainment", "checker_productivity", "checker_productivity_target", "checker_productivity_individual", "actual_checker_mandays", "budget_checker_mandays", "attendance_inbound"],
    unmeasured: ["Lead time per batch GRN", "Jam posting terakhir", "Jumlah baris discrepancy", "Login device per checker"],
    failureModes: [
      {
        id: "grn-sla-breach",
        title: "GRN tidak selesai dalam jendela SLA",
        floorSymptom: "Palet masih antre di lane saat shift berganti, dan checker shift berikutnya mulai dengan pekerjaan kemarin.",
        dataSignature: "SLA checker inbound di bawah 98%.",
        rootCauses: ["Kedatangan menumpuk di satu jam", "Baris discrepancy diselesaikan sambil menghitung", "Jumlah lane lebih sedikit dari jumlah truk"],
        containment: "Buka lane tambahan hanya untuk PO bersih; pisahkan PO bermasalah ke satu lane khusus agar tidak menahan yang lain.",
        correction: "Ubah staffing checker mengikuti kurva kedatangan per jam, bukan rata-rata harian.",
        owner: "SPV Inbound",
        trigger: "SLA checker inbound <98%.",
        evaluate: (value, fmt) => below(value.sla_checker_inbound, 98) ? [`SLA checker ${fmt.pct("sla_checker_inbound")}`, `Manday checker ${fmt.num("actual_checker_mandays", 1)} vs budget ${fmt.num("budget_checker_mandays", 1)}`, `Output checker ${fmt.num("checker_productivity")} vs target ${fmt.num("checker_productivity_target")}`] : null,
      },
      {
        id: "shared-login",
        title: "Output kolektif dan output per orang tidak sejalan",
        floorSymptom: "Lane terlihat sibuk, tetapi hanya sebagian nama yang muncul di WMS.",
        dataSignature: "Output kolektif jauh di atas rata-rata individu pada hari yang sama.",
        rootCauses: ["Scanner dipakai bergantian tanpa logout", "Helper tidak punya user WMS", "Login dititipkan ke leader"],
        containment: "Cek fisik jumlah orang di lane terhadap jumlah user aktif sekarang juga.",
        correction: "Satu user satu device; helper harian tetap dibuatkan user sementara agar jejaknya ada.",
        owner: "SPV Inbound + IT WMS",
        trigger: "Output kolektif ≥1,5× rata-rata output individu.",
        evaluate: (value, fmt) => {
          const collective = value.checker_productivity;
          const individual = value.checker_productivity_individual;
          if (collective === null || individual === null || individual <= 0 || collective < individual * 1.5) return null;
          return [`Output kolektif ${fmt.num("checker_productivity")}`, `Rata-rata individu ${fmt.num("checker_productivity_individual")}`, `Manday checker ${fmt.num("actual_checker_mandays", 1)}`];
        },
      },
      {
        id: "checker-undercoverage",
        title: "Manday checker di bawah budget saat beban naik",
        floorSymptom: "Lane kekurangan orang justru pada hari kedatangan besar.",
        dataSignature: "Manday checker aktual di bawah budget sementara SLA atau produktivitas checker menembus guardrail.",
        rootCauses: ["Absensi tidak tertutup", "Checker dipinjam ke fungsi lain", "Budget disusun dari volume rata-rata"],
        containment: "Tarik kembali checker yang dipinjam sebelum membuka lembur.",
        correction: "Sepakati flex pool lintas fungsi dengan aturan siapa yang boleh dipinjam dan pada jam berapa.",
        owner: "SPV Inbound + Personalia",
        trigger: "Manday aktual < budget dan (SLA <98% atau pencapaian produktivitas checker <100%).",
        evaluate: (value, fmt) => {
          const actual = value.actual_checker_mandays;
          const budget = value.budget_checker_mandays;
          if (actual === null || budget === null || actual >= budget) return null;
          if (!below(value.sla_checker_inbound, 98) && !below(value.inbound_productivity_attainment, 100)) return null;
          return [`Manday checker ${fmt.num("actual_checker_mandays", 1)} vs budget ${fmt.num("budget_checker_mandays", 1)}`, `SLA checker ${fmt.pct("sla_checker_inbound")}`, `Pencapaian produktivitas ${fmt.pct("inbound_productivity_attainment")}`];
        },
      },
    ],
  },
  {
    id: "qc-badstock",
    stage: "Inbound",
    title: "QC, screening & gerbang bad stock",
    shiftMoment: "Menempel pada lane GRN, sebelum palet dilepas ke putaway",
    owner: "QC Inbound + QA",
    purpose: "Menahan barang yang tidak layak sebelum masuk ke lokasi good, karena satu palet rusak yang lolos akan ditemukan lagi oleh picker dua minggu kemudian.",
    wmsSteps: [
      "Sampling per vendor per SKU, bukan per palet acak; hasilnya dicatat di baris GR yang sama.",
      "Barang reject dipindahkan ke SLOC bad lewat movement bersistem dengan reason code — jangan hanya digeser fisik.",
      "Inbound-to-bad ditandai pada hari kedatangan; menandainya belakangan membuat loss terlihat sebagai kesalahan handling internal.",
      "Bad stock keluar dari area lewat transaksi disposal atau retur, bukan lewat penyusutan diam-diam.",
    ],
    gembaChecks: [
      "Barang reject diberi label merah dan reason code di tempat, bukan menunggu admin. Palet tanpa label akan kembali ke good besok pagi.",
      "Chiller dan frozen tidak boleh menunggu QC di ambient. Kalau antre, QC yang mendatangi barang, bukan sebaliknya.",
      "Area bad stock punya batas fisik yang jelas dan tidak dipakai sebagai tempat parkir palet sementara.",
      "Cek umur palet tertua di area bad stock. Kalau lebih dari satu minggu, masalahnya di jalur disposal, bukan di QC.",
    ],
    handoffRisk: "Barang rusak yang lolos ke lokasi good akan muncul kembali sebagai pick-to-bad di outbound, dan saat itu yang disalahkan adalah picker.",
    signals: ["inbound_to_bad_rate", "inbound_to_bad_qty", "inbound_to_lost_rate", "badstock_qty", "badstock_sla", "wastage_handling", "wastage_expired"],
    unmeasured: ["Volume screening per hari", "Reason code reject", "Umur palet di area bad stock", "Nilai klaim ke vendor"],
    failureModes: [
      {
        id: "inbound-to-bad-rising",
        title: "Barang jatuh ke bad stock sejak pintu masuk",
        floorSymptom: "Palet reject menumpuk di dekat dock dan area bad stock tidak pernah kosong.",
        dataSignature: "Inbound-to-bad di atas ambang kerja 0,5%.",
        rootCauses: ["Kualitas kiriman vendor", "Bongkar kasar atau tumpukan terlalu tinggi", "Rantai dingin terputus saat menunggu QC"],
        containment: "Tahan vendor dengan reject tertinggi hari ini untuk pemeriksaan 100%, bukan sampling.",
        correction: "Bawa data reject per vendor ke klaim; pisahkan penyebab vendor dari penyebab handling internal.",
        owner: "QA + Buyer",
        trigger: "Inbound-to-bad >0,5%.",
        evaluate: (value, fmt) => above(value.inbound_to_bad_rate, 0.5) ? [`Inbound to bad ${fmt.pct("inbound_to_bad_rate", 2)}`, `Volume ${fmt.num("inbound_to_bad_qty")} unit`, `Bad stock aktual ${fmt.num("badstock_qty")}`] : null,
      },
      {
        id: "badstock-not-clearing",
        title: "Bad stock masuk tetapi tidak keluar",
        floorSymptom: "Area bad stock terus tumbuh dan mulai memakan ruang good.",
        dataSignature: "SLA bad stock di bawah 95% sementara qty bad stock tetap tinggi.",
        rootCauses: ["Jalur disposal atau retur menunggu approval", "Tidak ada owner harian untuk area bad stock", "Barang tanpa reason code tidak bisa diproses"],
        containment: "Tetapkan satu nama sebagai penanggung jawab area untuk shift ini dan targetkan palet tertua keluar hari ini.",
        correction: "Sepakati SLA disposal dan retur beserta approval-nya, lalu pantau umur palet, bukan hanya jumlahnya.",
        owner: "QA + Inventory",
        trigger: "SLA bad stock <95% atau bad stock aktual > 0 tanpa penurunan.",
        evaluate: (value, fmt) => below(value.badstock_sla, 95) ? [`SLA bad stock ${fmt.pct("badstock_sla")}`, `Bad stock aktual ${fmt.num("badstock_qty")}`, `Wastage handling ${fmt.num("wastage_handling")}`] : null,
      },
    ],
  },
  {
    id: "relabel",
    stage: "Inbound",
    title: "Relabel & pemrosesan labeling",
    shiftMoment: "Setelah GRN, sebelum palet dilepas ke putaway",
    owner: "Leader Relabel",
    purpose: "Memberi identitas yang bisa dibaca mesin pada barang yang tidak datang siap-scan, supaya tidak menjadi hambatan di setiap stasiun sesudahnya.",
    wmsSteps: [
      "Tandai SKU yang eligible relabel pada saat GRN, bukan saat palet sudah di lorong.",
      "Cetak label dari master SKU WMS, bukan dari file lokal yang bisa tertinggal versi.",
      "Scan uji 1 dari 20 label hasil cetak; label yang tidak terbaca dihitung sebagai rework hari itu juga.",
      "Catat qty relabel terhadap qty inbound aktual — inilah dasar kebutuhan orang di bench ini.",
    ],
    gembaChecks: [
      "Label lama harus tertutup penuh, bukan ditempel bersebelahan. Dua barcode pada satu kemasan adalah double scan di picking.",
      "Cek arah label: menghadap keluar dari rak. Label yang menghadap dinding memaksa picker mengangkat barang untuk membacanya.",
      "Bench relabel tidak boleh menjadi tempat parkir palet. Kalau palet menunggu di sini lebih dari satu jam, bench-nya kurang orang atau kurang meja.",
      "Ribbon dan stok label dicek di awal shift. Printer kehabisan ribbon di tengah gelombang adalah penyebab berhenti yang paling sering dan paling murah dicegah.",
    ],
    handoffRisk: "Barang tanpa label yang terbaca akan tetap masuk rak, lalu muncul sebagai pick-to-lost dan task troubleshoot yang tidak pernah ketemu penyebabnya.",
    signals: ["relabel_share", "relabel_productivity_attainment", "relabel_qty", "relabel_actual_mandays", "relabel_budget_mandays"],
    unmeasured: ["Forecast pcs yang eligible relabel", "Jumlah label gagal cetak / gagal scan", "Alasan relabel per SKU"],
    failureModes: [
      {
        id: "relabel-capacity",
        title: "Bench relabel menjadi antrean, bukan jalur",
        floorSymptom: "Palet menunggu di sekitar bench dan putaway mulai kekurangan pekerjaan padahal barang sudah datang.",
        dataSignature: "Porsi relabel terhadap inbound tinggi sementara pencapaian produktivitas relabel di bawah target.",
        rootCauses: ["Jumlah meja dan printer tidak mengikuti porsi relabel", "SKU eligible tidak ditandai sejak GRN", "Orang bench dipinjam ke lane checker"],
        containment: "Prioritaskan SKU yang akan dipakai wave picking terdekat; sisanya boleh menunggu.",
        correction: "Hitung kebutuhan orang dari qty relabel, bukan dari total inbound — porsinya jauh berbeda setiap hari.",
        owner: "Leader Relabel + SPV Inbound",
        trigger: "Pencapaian produktivitas relabel <100% dengan porsi relabel terbaca.",
        evaluate: (value, fmt) => {
          if (!below(value.relabel_productivity_attainment, 100) || value.relabel_share === null) return null;
          return [`Pencapaian relabel ${fmt.pct("relabel_productivity_attainment")}`, `Porsi relabel ${fmt.pct("relabel_share")} dari inbound`, `Manday relabel ${fmt.num("relabel_actual_mandays", 1)} vs budget ${fmt.num("relabel_budget_mandays", 1)}`];
        },
      },
    ],
  },
  {
    id: "putaway",
    stage: "Inventory",
    title: "Putaway & pelepasan staging",
    shiftMoment: "Mengikuti GRN, harus tuntas sebelum shift berganti",
    owner: "SPV Inventory + Leader Putaway",
    purpose: "Memindahkan stok dari receiving ke lokasi yang benar, karena lokasi yang benar hari ini adalah pickface yang siap besok.",
    wmsSteps: [
      "Ambil task putaway dari antrean sistem. Memilih palet sendiri membuat palet sulit selalu tertinggal.",
      "Scan LPN, scan lokasi tujuan, konfirmasi qty. Tiga langkah, tidak boleh dua.",
      "Override lokasi hanya dengan reason code. Override diam-diam hari ini adalah LDP besok.",
      "Tutup task sebelum mengambil task berikutnya; task menggantung membuat completion terlihat rendah padahal barangnya sudah di rak.",
    ],
    gembaChecks: [
      "Cek jam GRN tertua yang paletnya masih di staging. Itu angka backlog yang sebenarnya, bukan jumlah palet.",
      "Telusuri lorong tujuan: kalau terhalang palet lain, putaway lambat karena akses, bukan karena orang.",
      "Pastikan FEFO ditegakkan di lokasi — batch lama di depan. Salah taruh di sini menjadi wastage expired berbulan-bulan kemudian.",
      "Perhatikan berapa lama pintu chiller dan frozen terbuka saat putaway ramai; itu biaya energi sekaligus risiko mutu.",
    ],
    handoffRisk: "Palet yang menginap di staging membuat inventory terlihat ada di sistem tetapi tidak bisa dipetik, dan itu muncul sebagai pick-to-lost di outbound.",
    signals: ["putaway_completion", "putaway_productivity_attainment", "putaway_utilization", "putaway_capacity", "actual_putaway_mandays", "budget_putaway_mandays", "putaway_productivity_collective", "putaway_suggestion_accuracy", "attendance_inventory"],
    unmeasured: ["Umur palet di staging", "Waktu tunggu per task putaway", "Override lokasi dan alasannya"],
    failureModes: [
      {
        id: "putaway-backlog",
        title: "Putaway tidak menutup pekerjaan harinya",
        floorSymptom: "Palet menginap di staging dan shift berikutnya memulai hari dengan pekerjaan kemarin.",
        dataSignature: "Putaway completion di bawah 98%.",
        rootCauses: ["GRN menumpuk di akhir shift", "Lorong tujuan terhalang", "Orang putaway dipindah ke picking saat wave dibuka"],
        containment: "Selesaikan task pada lokasi yang menopang wave besok pagi lebih dulu; sisanya boleh menyusul.",
        correction: "Pasang cut-off putaway sebelum shift berganti dan lindungi orang putaway dari peminjaman saat gelombang picking.",
        owner: "SPV Inventory",
        trigger: "Putaway completion <98%.",
        evaluate: (value, fmt) => below(value.putaway_completion, 98) ? [`Putaway completion ${fmt.pct("putaway_completion")}`, `Pencapaian produktivitas putaway ${fmt.pct("putaway_productivity_attainment")}`, `Manday putaway ${fmt.num("actual_putaway_mandays", 1)} vs budget ${fmt.num("budget_putaway_mandays", 1)}`] : null,
      },
      {
        id: "putaway-capacity-pressure",
        title: "Kapasitas putaway mendekati batas",
        floorSymptom: "Lorong sempit, palet menunggu giliran masuk, dan forklift lebih banyak mengantre daripada bergerak.",
        dataSignature: "Putaway utilization di atas 85%.",
        rootCauses: ["Volume inbound naik tanpa penyesuaian slot", "Lokasi blokir tidak dikeluarkan dari kapasitas", "Overflow tidak diaktifkan tepat waktu"],
        containment: "Aktifkan area overflow sekarang dan hentikan penambahan volume ke zona yang paling padat.",
        correction: "Validasi ulang kapasitas efektif: kurangi lokasi blokir dan palet kosong dari angka maksimum.",
        owner: "SPV Inventory + Facility",
        trigger: "Putaway utilization >85%.",
        evaluate: (value, fmt) => above(value.putaway_utilization, 85) ? [`Putaway utilization ${fmt.pct("putaway_utilization")}`, `Kapasitas putaway ${fmt.num("putaway_capacity")}`, `Putaway completion ${fmt.pct("putaway_completion")}`] : null,
      },
    ],
  },
  {
    id: "zone-capacity",
    stage: "Inventory",
    title: "Kapasitas zona: ambient, chiller, frozen",
    shiftMoment: "Dibaca pada puncak isi harian, bukan pada akhir hari",
    owner: "SPV Inventory + Facility",
    purpose: "Menjaga ruang gerak. Zona yang penuh membuat setiap proses lain melambat tanpa satu pun proses terlihat salah.",
    wmsSteps: [
      "Baca occupancy per zona pada puncak harian, bukan pada saldo akhir — saldo akhir menyembunyikan kepadatan siang hari.",
      "Keluarkan lokasi blokir dan palet kosong dari angka kapasitas maksimum sebelum menghitung utilisasi.",
      "Aktifkan overflow lewat transaksi, bukan lewat kesepakatan lisan, supaya barangnya tetap bisa ditemukan.",
    ],
    gembaChecks: [
      "Hitung slot kosong yang benar-benar bisa dipakai. Slot berisi palet kosong atau barang blokir bukan slot kosong.",
      "Perhatikan lebar lorong yang tersisa di zona terpadat. Kalau forklift harus mundur untuk berpapasan, kapasitas efektif sudah habis sebelum angkanya sampai 100%.",
      "Cek suhu di titik terjauh dari evaporator saat zona penuh — beban pendinginan naik justru ketika Anda paling tidak sempat mengeceknya.",
      "Bandingkan angka maksimum di sistem dengan layout terakhir. Kapasitas yang tidak pernah divalidasi ulang adalah kapasitas fiksi.",
    ],
    handoffRisk: "Zona jenuh membuat putaway melambat, replenish tertunda, dan picking berjalan di pickface yang tidak terisi — tiga stasiun terlihat gagal karena satu ruang yang penuh.",
    signals: ["inventory_capacity_utilization", "inventory_actual", "inventory_capacity"],
    unmeasured: ["Slot blokir per zona", "Proyeksi occupancy H+3", "Kapasitas overflow yang benar-benar tersedia"],
    failureModes: [
      {
        id: "zone-envelope",
        title: "Operating envelope menyempit",
        floorSymptom: "Palet mulai diletakkan di lorong dan area staging dipakai sebagai penyimpanan.",
        dataSignature: "Utilisasi inventory di atas 85%; di atas 92% congestion sudah pasti terasa.",
        rootCauses: ["Inbound melebihi rencana", "Slow moving tidak dibersihkan", "Kapasitas master sudah tidak sesuai layout"],
        containment: "Hentikan penambahan volume ke zona terpadat dan pindahkan slow moving ke overflow hari ini.",
        correction: "Jadwalkan pembersihan slow moving berkala dan validasi ulang kapasitas setiap perubahan layout.",
        owner: "SPV Inventory + Facility",
        trigger: "Utilisasi inventory >85%.",
        evaluate: (value, fmt) => above(value.inventory_capacity_utilization, 85) ? [`Utilisasi inventory ${fmt.pct("inventory_capacity_utilization")}`, `Puncak aktual ${fmt.num("inventory_actual")}`, `Kapasitas maksimum ${fmt.num("inventory_capacity")}`] : null,
      },
    ],
  },
  {
    id: "dcc-sloc",
    stage: "Inventory",
    title: "Stock keeper: DCC & akurasi SLOC",
    shiftMoment: "Cycle count harian, sebelum gelombang picking utama",
    owner: "Inventory Control + Stock Keeper",
    purpose: "Menjaga agar apa yang tertulis di sistem sama dengan apa yang ada di rak — karena setiap selisih di sini akan dibayar oleh picker, troubleshooter, dan akhirnya oleh toko.",
    wmsSteps: [
      "Cycle count harian per zona secara blind: penghitung tidak melihat angka sistem. Kalau angkanya terlihat, yang Anda uji bukan stok tetapi kemampuan menyalin.",
      "Rekonsiliasi SLOC × qty, bukan qty total. Qty benar yang tersebar di lokasi salah tetap membuat picking gagal.",
      "Adjustment hanya lewat approval dengan reason code LDP atau LBH, dan diselesaikan pada hari yang sama.",
      "Simpan riwayat SLOC bermasalah; SLOC yang sama muncul tiga kali berturut-turut adalah masalah lokasi, bukan masalah orang.",
    ],
    gembaChecks: [
      "Buka satu SLOC yang sering bermasalah dan cek apakah berisi lebih dari satu batch. Campur batch adalah sumber LDP yang paling sering ditemukan.",
      "Perhatikan lokasi di ujung lorong dan di rak paling atas — dua tempat itu paling sering luput dari hitungan.",
      "Cek label lokasi yang buram atau terkelupas. Picker tidak akan berhenti untuk melapor; ia akan mengambil dari lokasi sebelah.",
      "Bandingkan LDP dengan LBH di lokasi bersebelahan. Pasangan yang saling meniadakan berarti salah taruh, bukan barang hilang.",
    ],
    handoffRisk: "Akurasi SLOC yang jatuh muncul dua langkah kemudian sebagai pick-to-lost dan antrean troubleshoot, saat penyebabnya sudah sulit ditelusuri.",
    signals: ["dcc_accuracy", "inventory_accuracy_qty", "inventory_accuracy_sloc", "sloc_qty_accuracy", "ldp_qty", "lbh_qty", "ldp_stock_share", "ldp_value", "found_rate", "lost_to_found"],
    unmeasured: [
      "SLOC repeat offender per SKU",
      "Cakupan cycle count harian terhadap total lokasi",
      "Definisi target Found % belum terkonfirmasi; nilainya bergerak di kisaran belasan persen sementara guardrail mesin 90% — jangan dibaca sebagai kegagalan sampai definisinya disepakati",
    ],
    failureModes: [
      {
        id: "sloc-reliability",
        title: "Akurasi lokasi tidak dapat diandalkan",
        floorSymptom: "Picker makin sering mencari barang di lokasi sebelah dan makin sering melapor kosong padahal sistem bilang ada.",
        dataSignature: "Akurasi DCC di bawah 98%, biasanya bersamaan dengan LDP yang naik.",
        rootCauses: ["Override lokasi saat putaway", "Campur batch dalam satu SLOC", "Movement fisik tanpa transaksi"],
        containment: "Audit 20 SLOC dengan nilai LDP tertinggi hari ini dan tutup koreksinya sebelum wave berikutnya.",
        correction: "DCC berbasis risiko: hitung lebih sering pada SLOC bernilai tinggi dan SLOC yang berulang bermasalah.",
        owner: "Inventory Control",
        trigger: "Akurasi DCC <98%.",
        evaluate: (value, fmt) => below(value.dcc_accuracy, 98) ? [`Akurasi DCC ${fmt.pct("dcc_accuracy")}`, `LDP ${fmt.num("ldp_qty")} unit senilai ${fmt.num("ldp_value")}`, `LBH ${fmt.num("lbh_qty")} unit`] : null,
      },
      {
        id: "ldp-material",
        title: "Selisih kurang sudah material terhadap stok",
        floorSymptom: "Nilai selisih mulai muncul di pembahasan bulanan, bukan lagi sebagai kasus satuan.",
        dataSignature: "LDP terhadap stok tersimpan melewati ambang kerja 0,5%.",
        rootCauses: ["Pencurian atau kehilangan di area tertentu", "Salah taruh berulang", "Adjustment tanpa penelusuran akar masalah"],
        containment: "Kunci area dengan LDP tertinggi untuk hitung ulang penuh, bukan sampling.",
        correction: "Telusuri per zona dan per shift; pisahkan salah taruh dari kehilangan sebelum menuduh siapa pun.",
        owner: "Inventory Control + SPV Inventory",
        trigger: "LDP vs stok >0,5%.",
        evaluate: (value, fmt) => above(value.ldp_stock_share, 0.5) ? [`LDP vs stok ${fmt.pct("ldp_stock_share", 2)}`, `LDP ${fmt.num("ldp_qty")} unit`, `Lost to found ${fmt.num("lost_to_found")} unit`] : null,
      },
    ],
  },
  {
    id: "movement-troubleshoot",
    stage: "Inventory",
    title: "Movement stock, SLOC & troubleshoot",
    shiftMoment: "Berjalan bersama picking, memburu SO yang gagal",
    owner: "Troubleshooter + Inventory Control",
    purpose: "Menyelamatkan order yang sudah gagal di pickface, dan memastikan setiap penyelamatan meninggalkan jejak yang bisa dipelajari.",
    wmsSteps: [
      "Movement antar SLOC selalu berpasangan from–to dan di-scan, tidak diketik. Ketikan adalah cara paling cepat menciptakan LDP.",
      "Transfer good ke bad dan sebaliknya wajib reason code dan bukti foto.",
      "Task troubleshoot dibuat dari SO yang gagal, dan prioritasnya mengikuti nilai serta umur task, bukan urutan masuk.",
      "Tutup task dengan hasil: ditemukan, tidak ditemukan, atau diganti SKU lain. Task yang ditutup tanpa hasil menghapus pelajarannya.",
    ],
    gembaChecks: [
      "Ikuti satu troubleshooter selama 30 menit. Kalau sebagian besar waktunya untuk berjalan, masalahnya prioritas antrean, bukan kecepatan orang.",
      "Cek apakah barang yang 'ditemukan' berasal dari lokasi sebelah. Kalau ya, akar masalahnya di putaway, bukan di pencarian.",
      "Perhatikan berapa banyak task yang dibuat untuk SKU yang sama dalam seminggu. Pengulangan berarti lokasi itu belum pernah benar-benar diperbaiki.",
    ],
    handoffRisk: "Recovery yang berhasil menutupi masalah akurasi: fulfillment terlihat sehat sementara akar masalahnya tetap ada dan biayanya berpindah ke lembur troubleshooter.",
    signals: ["troubleshoot_fr", "troubleshoot_created", "troubleshoot_executed", "troubleshoot_so_contribution", "dcc_accuracy"],
    unmeasured: ["Manday troubleshooter", "Umur task per bucket", "Nilai barang yang berhasil diselamatkan", "Arrival rate task per jam"],
    failureModes: [
      {
        id: "recovery-lagging",
        title: "Recovery tidak mengejar antrean",
        floorSymptom: "Task menumpuk dan sebagian SO ditutup tanpa pernah dicari.",
        dataSignature: "Troubleshoot FR di bawah 90%: task dikerjakan lebih sedikit daripada task dibuat.",
        rootCauses: ["Jumlah troubleshooter tidak mengikuti antrean", "Prioritas mengikuti urutan masuk", "Akurasi SLOC memperbesar antrean lebih cepat dari kemampuan mencari"],
        containment: "Urutkan antrean berdasarkan nilai dan umur; kerjakan yang cepat menang lebih dulu untuk membebaskan SO.",
        correction: "Perbaiki akurasi di hulu. Menambah troubleshooter tanpa memperbaiki SLOC hanya menambah biaya pemadam kebakaran.",
        owner: "Inventory Control",
        trigger: "Troubleshoot FR <90%.",
        evaluate: (value, fmt) => below(value.troubleshoot_fr, 90) ? [`Troubleshoot FR ${fmt.pct("troubleshoot_fr")}`, `Task dibuat ${fmt.num("troubleshoot_created")} vs dikerjakan ${fmt.num("troubleshoot_executed")}`, `Kontribusi ke SO FR ${fmt.pct("troubleshoot_so_contribution", 2)}`] : null,
      },
      {
        id: "service-on-recovery",
        title: "Service ditopang recovery, bukan proses normal",
        floorSymptom: "Fulfillment tercapai, tetapi selalu di menit terakhir dan selalu dengan orang yang sama berlari.",
        dataSignature: "Kontribusi troubleshoot terhadap SO FR terbaca nyata sementara akurasi DCC di bawah guardrail.",
        rootCauses: ["Akurasi SLOC rendah", "Replenish terlambat", "Pickface tidak pernah benar-benar siap saat wave dibuka"],
        containment: "Tetap jalankan recovery hari ini, tetapi catat SKU dan lokasinya untuk perbaikan besok pagi.",
        correction: "Pindahkan usaha dari recovery ke kesiapan pickface; ukur keberhasilan dari turunnya task, bukan naiknya FR recovery.",
        owner: "SPV Inventory + SPV Outbound",
        trigger: "Kontribusi ke SO FR >0 dan akurasi DCC <98%.",
        evaluate: (value, fmt) => {
          if (!above(value.troubleshoot_so_contribution, 0) || !below(value.dcc_accuracy, 98)) return null;
          return [`Kontribusi ke SO FR ${fmt.pct("troubleshoot_so_contribution", 2)}`, `Akurasi DCC ${fmt.pct("dcc_accuracy")}`, `Task dibuat ${fmt.num("troubleshoot_created")}`];
        },
      },
    ],
  },
  {
    id: "replenishment",
    stage: "Inventory",
    title: "Replenishment ke pickface",
    shiftMoment: "Sebelum setiap wave picking dibuka",
    owner: "Leader Replenishment",
    purpose: "Memastikan barang sudah berada di tempat picker mengambilnya, sebelum picker sampai di sana.",
    wmsSteps: [
      "Trigger replenish dari min–max pickface, bukan dari permintaan lisan picker di tengah wave.",
      "Urutkan task mengikuti kebutuhan wave berikutnya, bukan urutan lokasi.",
      "Tutup task replenish sebelum wave dibuka; task yang selesai setelah wave berjalan tidak menolong siapa pun.",
      "Catat pickface yang berulang kosong — itu min–max yang salah, bukan replenish yang lambat.",
    ],
    gembaChecks: [
      "Satu jam sebelum wave, lihat 20 pickface tersibuk: kosong, setengah, atau penuh. Ini prediksi produktivitas picking yang paling murah dan paling akurat.",
      "Cek apakah barang replenish diletakkan menghadap ke depan dan mudah diambil. Pickface penuh yang sulit dijangkau sama saja dengan kosong.",
      "Perhatikan SKU promo dan SKU baru. Keduanya paling sering punya min–max yang belum disesuaikan.",
    ],
    handoffRisk: "Pickface yang tidak siap memaksa picker mengambil dari lokasi cadangan, dan itu langsung terbaca sebagai Pick-to-PF yang turun serta produktivitas picking yang jatuh.",
    signals: ["replenishment_completion", "replenishment_task", "replenishment_done", "replenishment_productivity", "replenishment_productivity_target", "replenishment_actual_mandays", "pick_to_pf"],
    unmeasured: ["Kekosongan pickface per SKU", "Umur task replenish", "Jam penyelesaian terhadap jam wave"],
    failureModes: [
      {
        id: "pickface-not-ready",
        title: "Pickface belum siap saat wave dibuka",
        floorSymptom: "Picker berhenti di depan lokasi kosong dan mulai mencari sendiri ke lokasi cadangan.",
        dataSignature: "Pick-to-PF di bawah 85% atau replenishment completion di bawah 95%.",
        rootCauses: ["Task replenish selesai setelah wave dibuka", "Min–max belum disesuaikan untuk SKU promo", "Orang replenish dipinjam ke picking"],
        containment: "Tahan pembukaan wave sampai pickface untuk SKU teratas terisi; lebih murah menunda 15 menit daripada mengejar seharian.",
        correction: "Pasang cut-off replenish sebelum wave dan review min–max mingguan untuk SKU dengan kekosongan berulang.",
        owner: "Leader Replenishment + SPV Outbound",
        trigger: "Pick-to-PF <85% atau replenishment completion <95%.",
        evaluate: (value, fmt) => {
          if (!below(value.pick_to_pf, 85) && !below(value.replenishment_completion, 95)) return null;
          return [`Pick-to-PF ${fmt.pct("pick_to_pf")}`, `Replenishment completion ${fmt.pct("replenishment_completion")}`, `Task ${fmt.num("replenishment_task")} vs selesai ${fmt.num("replenishment_done")}`];
        },
      },
    ],
  },
  {
    id: "outbound-wave",
    stage: "Outbound",
    title: "Administrasi outbound & assign picker",
    shiftMoment: "Cut-off SO sampai wave terakhir",
    owner: "Admin Outbound + SPV Outbound",
    purpose: "Mengubah kumpulan SO menjadi pekerjaan yang bisa dibagi, diukur, dan diselesaikan sebelum truk datang.",
    wmsSteps: [
      "Bentuk wave berdasarkan rute dan cut-off keberangkatan, bukan urutan SO masuk.",
      "Assign picker per zona; satu picker, satu trolley, satu wave. Trolley berpindah tangan membuat produktivitas per user tidak terbaca.",
      "Cancel SO hanya lewat approval dengan reason code dan bukti kapasitas — sisa volume, sisa jam, dan run-rate saat itu.",
      "Pantau progres wave per jam terhadap jam keberangkatan, bukan terhadap total harian.",
    ],
    gembaChecks: [
      "Hitung berapa picker yang benar-benar login di device dibanding jumlah orang di lantai. Selisihnya adalah pekerjaan yang tidak punya jejak.",
      "Perhatikan trolley yang parkir. Trolley berhenti biasanya berarti menunggu replenish, menunggu troubleshoot, atau menunggu instruksi.",
      "Cek SKU dengan pcs per SO besar. Order besar memerlukan urutan picking yang berbeda; memaksakan urutan biasa membuat picker bolak-balik.",
      "Dengarkan radio atau grup shift: permintaan yang berulang tentang lokasi yang sama menandakan pickface, bukan picker.",
    ],
    handoffRisk: "Wave yang dibentuk tanpa melihat jam keberangkatan membuat picking selesai tepat waktu secara total tetapi terlambat untuk rute tertentu.",
    signals: ["forecast_accuracy", "cancel_rate", "outbound_capacity_utilization", "so_ratio", "seuic_adoption", "productivity_attainment", "picker_productivity", "picker_productivity_target", "picker_regular_productivity", "picker_productivity_user", "actual_picker_mandays", "budget_picker_mandays", "attendance_outbound"],
    unmeasured: ["Progres wave per jam", "Waktu tunggu picker", "Reason code cancel", "Jumlah picker OJT aktif per shift"],
    failureModes: [
      {
        id: "device-adoption-gap",
        title: "Sebagian pekerjaan tidak lewat device",
        floorSymptom: "Lantai terlihat penuh orang, tetapi daftar user aktif di WMS jauh lebih pendek.",
        dataSignature: "Adopsi SEUIC di bawah 98%.",
        rootCauses: ["Device kurang atau baterai habis", "Helper harian tidak punya user", "Kerja manual dianggap lebih cepat saat sedang ramai"],
        containment: "Cukupi device dan charger untuk shift ini; pekerjaan tanpa device dihentikan, bukan ditoleransi.",
        correction: "Buat user sementara untuk tenaga harian dan jadikan rasio device terhadap orang bagian dari kesiapan shift.",
        owner: "SPV Outbound + IT WMS",
        trigger: "Adopsi SEUIC <98%.",
        evaluate: (value, fmt) => below(value.seuic_adoption, 98) ? [`Adopsi SEUIC ${fmt.pct("seuic_adoption")}`, `Output picker per login ${fmt.num("picker_productivity_user")}`, `Output picker kolektif ${fmt.num("picker_productivity")}`] : null,
      },
      {
        id: "cancel-without-proof",
        title: "Demand dibuang sebelum kemampuan dibuktikan",
        floorSymptom: "SO dibatalkan menjelang cut-off, dan lantai justru terlihat sanggup mengerjakannya.",
        dataSignature: "Cancel di atas 2% sementara produktivitas picker tidak ikut membaik.",
        rootCauses: ["Cancel dipakai sebagai katup pengaman rutin", "Tidak ada bukti kapasitas yang disyaratkan", "Cut-off rute tidak dipisahkan dari cut-off harian"],
        containment: "Wajibkan bukti kapasitas untuk setiap cancel berikutnya hari ini: sisa qty, sisa jam, run-rate, dan kehadiran.",
        correction: "Pasang approval gate untuk cancel di atas target dan tandai reason code agar cancel yang benar-benar perlu bisa dibedakan.",
        owner: "SPV Outbound + Planning",
        trigger: "Cancel >2% dan pencapaian produktivitas picker <100%.",
        evaluate: (value, fmt) => {
          if (!above(value.cancel_rate, 2) || !below(value.productivity_attainment, 100)) return null;
          return [`Cancel ${fmt.pct("cancel_rate")}`, `Pencapaian produktivitas picker ${fmt.pct("productivity_attainment")}`, `Manday picker ${fmt.num("actual_picker_mandays", 1)} vs budget ${fmt.num("budget_picker_mandays", 1)}`];
        },
      },
      {
        id: "ojt-dilution",
        title: "Selisih output regular dan kolektif melebar",
        floorSymptom: "Picker berpengalaman mengejar target sementara yang baru masih mencari lokasi.",
        dataSignature: "Output picker regular jauh di atas output kolektif pada hari yang sama.",
        rootCauses: ["Porsi OJT tinggi tanpa pendampingan", "Zona sulit diberikan ke orang baru", "Target kolektif tidak menyesuaikan komposisi tim"],
        containment: "Pasangkan picker baru pada zona yang lebih sederhana untuk sisa shift ini.",
        correction: "Pisahkan target OJT dan regular dalam pengukuran, lalu ukur kurva belajarnya sebagai program, bukan sebagai kegagalan harian.",
        owner: "SPV Outbound + Training",
        trigger: "Output regular ≥1,15× output kolektif.",
        evaluate: (value, fmt) => {
          const regular = value.picker_regular_productivity;
          const collective = value.picker_productivity;
          if (regular === null || collective === null || collective <= 0 || regular < collective * 1.15) return null;
          return [`Output picker regular ${fmt.num("picker_regular_productivity")}`, `Output picker kolektif ${fmt.num("picker_productivity")}`, `Pencapaian ${fmt.pct("productivity_attainment")}`];
        },
      },
    ],
  },
  {
    id: "packing-check",
    stage: "Outbound",
    title: "Packing, checker outbound & staging",
    shiftMoment: "Menempel pada picking sampai koli terakhir naik ke staging",
    owner: "Leader Packing + Checker Outbound",
    purpose: "Memastikan yang dikemas sama dengan yang dipesan, dan setiap koli punya identitas sebelum meninggalkan meja.",
    wmsSteps: [
      "Scan setiap koli ke SO. Sistem harus menolak koli tanpa SO — kalau bisa lolos, itu celah yang akan dipakai saat sedang ramai.",
      "Verifikasi qty per baris saat packing, bukan sampling. Sampling di sini berarti toko yang menjadi penguji akhir.",
      "Barang tidak layak dikembalikan lewat transaksi pick-to-bad dengan reason code, bukan diletakkan kembali ke rak.",
      "Serahkan koli ke staging per rute dan catat jumlahnya; staging tanpa hitungan adalah tempat koli menghilang.",
    ],
    gembaChecks: [
      "Cari koli tanpa label di meja dan di staging. Koli tanpa label hari ini adalah koli hilang besok.",
      "Meja packing tidak menyimpan sisa barang lebih dari satu shift. Sisa yang menginap akan bercampur dengan order berikutnya.",
      "Cek apakah staging dibagi per rute dengan batas yang terlihat. Batas yang samar membuat loader mengambil koli rute lain.",
      "Perhatikan barang yang sering dikembalikan karena kondisi. Kalau SKU-nya berulang, masalahnya di pickface atau di kemasan vendor, bukan di picker.",
    ],
    handoffRisk: "Koli yang tidak terhitung di staging membuat selisih RTS dan penerimaan hub, dan selisih itu baru ketahuan saat hub protes keesokan harinya.",
    signals: ["packer_attainment_source", "packer_productivity", "packer_productivity_target", "actual_packer_mandays", "budget_packer_mandays", "pick_to_lost", "pick_to_lost_qty", "pick_to_bad", "staging_lost_rate", "staging_lost_qty"],
    unmeasured: ["Jumlah koli per rute di staging", "Rework packing", "Waktu tunggu koli di staging"],
    failureModes: [
      {
        id: "staging-leak",
        title: "Koli hilang di staging",
        floorSymptom: "Jumlah koli yang dihitung sebelum truk datang tidak sama dengan yang naik.",
        dataSignature: "Koli hilang di staging melewati ambang kerja 0,1%.",
        rootCauses: ["Koli tanpa label", "Batas rute di staging tidak jelas", "Serah terima loader tanpa hitungan"],
        containment: "Hitung ulang per rute sebelum loading berikutnya dan tolak koli tanpa label naik ke truk.",
        correction: "Wajibkan scan saat koli masuk staging dan saat naik truk; selisih harus nol sebelum truk berangkat.",
        owner: "Leader Packing + Leader Loading",
        trigger: "Koli hilang di staging >0,1%.",
        evaluate: (value, fmt) => above(value.staging_lost_rate, 0.1) ? [`Koli hilang di staging ${fmt.pct("staging_lost_rate", 3)}`, `Jumlah ${fmt.num("staging_lost_qty")} koli`, `Pick-to-lost ${fmt.pct("pick_to_lost", 3)}`] : null,
      },
      {
        id: "pick-quality-loss",
        title: "Barang gagal di titik pengemasan",
        floorSymptom: "Meja packing menumpuk barang yang harus dikembalikan, dan picker bolak-balik mengganti.",
        dataSignature: "Pick-to-lost atau pick-to-bad melewati ambang kerja 0,2%.",
        rootCauses: ["Akurasi SLOC rendah", "FEFO tidak ditegakkan di pickface", "Kemasan rusak sejak inbound"],
        containment: "Tandai SKU yang berulang gagal hari ini dan periksa pickface-nya sebelum wave berikutnya.",
        correction: "Hubungkan SKU tersebut ke akurasi DCC dan ke inbound-to-bad; perbaiki di stasiun asalnya, bukan di meja packing.",
        owner: "SPV Outbound + Inventory Control",
        trigger: "Pick-to-lost >0,2% atau pick-to-bad >0,2%.",
        evaluate: (value, fmt) => {
          if (!above(value.pick_to_lost, 0.2) && !above(value.pick_to_bad, 0.2)) return null;
          return [`Pick-to-lost ${fmt.pct("pick_to_lost", 3)} (${fmt.num("pick_to_lost_qty")} unit)`, `Pick-to-bad ${fmt.pct("pick_to_bad", 3)}`, `Pencapaian packer ${fmt.pct("packer_attainment_source")}`];
        },
      },
    ],
  },
  {
    id: "loading-hub",
    stage: "Dispatch",
    title: "Loading & serah terima ke HUB",
    shiftMoment: "Dari kedatangan truk sampai konfirmasi penerimaan hub",
    owner: "Leader Loading + Fleet",
    purpose: "Memindahkan tanggung jawab dengan bersih: apa yang keluar dari dock harus sama dengan apa yang diakui hub, pada hari yang sama.",
    wmsSteps: [
      "Loading mengikuti manifest per rute; scan koli saat naik truk, bukan menghitung dari catatan staging.",
      "Kunci manifest sebelum truk berangkat. Perubahan setelah berangkat tidak akan pernah cocok dengan penerimaan hub.",
      "Catat jam siap warehouse dan jam berangkat secara terpisah — keduanya milik owner yang berbeda.",
      "Konfirmasi penerimaan hub dan tutup selisih pada hari yang sama, selagi orangnya masih ingat.",
    ],
    gembaChecks: [
      "Hitung koli per rute di staging sebelum truk merapat. Menghitung setelah truk datang berarti menghitung sambil diburu waktu.",
      "Segel dan suhu dicatat sebelum berangkat, dengan foto. Untuk frozen, ini satu-satunya bukti bila hub menolak barang.",
      "Bandingkan jam siap warehouse dengan jam truk tiba. Kalau truk yang selalu terlambat, jangan tambah orang loading.",
      "Perhatikan pemakaian truk on call. Naik terus berarti rencana armada yang kurang, bukan operasional yang boros.",
    ],
    handoffRisk: "Selisih RTS terhadap penerimaan hub yang tidak ditutup hari itu akan berubah menjadi klaim, dan klaim tanpa bukti selalu jatuh ke warehouse.",
    signals: ["loader_attainment_source", "loader_productivity", "loader_productivity_target", "actual_loader_mandays", "budget_loader_mandays", "outbound_rts", "outbound_actual_hub", "outbound_unfulfilled", "fulfillment_hub", "on_time_dispatch", "on_time_depart", "on_time_arrival", "truck_delivered_rate", "truck_dedicated", "actual_truck_delivered", "truck_on_call"],
    unmeasured: [
      "Jam siap warehouse per rute",
      "Owner keterlambatan per tahap",
      "Alasan penolakan di hub",
      "Truck delivered dibandingkan terhadap truk dedicated saja, sementara truk terkirim sudah termasuk on call — angka di atas 100% berarti cadangan sedang dipakai, bukan layanan berlebih",
    ],
    failureModes: [
      {
        id: "rts-hub-gap",
        title: "Selisih antara RTS dan penerimaan hub",
        floorSymptom: "Hub melaporkan kurang, warehouse yakin sudah mengirim, dan tidak ada yang memegang bukti hitungan.",
        dataSignature: "Qty diterima hub lebih kecil dari RTS pada window yang sama.",
        rootCauses: ["Koli tidak di-scan saat naik truk", "Manifest berubah setelah berangkat", "Penerimaan hub dicatat pada hari berbeda"],
        containment: "Rekonsiliasi per rute hari ini; jangan menunggu rekap mingguan.",
        correction: "Wajibkan scan naik truk dan tutup selisih harian dengan owner yang jelas di kedua sisi.",
        owner: "Leader Loading + Fleet",
        trigger: "Qty hub received < RTS.",
        evaluate: (value, fmt) => {
          const rts = value.outbound_rts;
          const hub = value.outbound_actual_hub;
          if (rts === null || hub === null || hub >= rts) return null;
          return [`RTS ${fmt.num("outbound_rts")} vs diterima hub ${fmt.num("outbound_actual_hub")}`, `Selisih ${(rts - hub).toLocaleString("id-ID", { maximumFractionDigits: 0 })} unit`, `FR inbound hub ${fmt.pct("fulfillment_hub", 2)}`];
        },
      },
      {
        id: "fleet-punctuality",
        title: "Ketepatan keberangkatan tidak terjaga",
        floorSymptom: "Truk menunggu muatan, atau muatan menunggu truk — dua hal yang tampak sama dari luar dan berbeda pemiliknya.",
        dataSignature: "On-time dispatch atau on-time depart di bawah 98%.",
        rootCauses: ["Warehouse belum siap pada cut-off", "Armada tiba terlambat", "Rute disusun tanpa memperhitungkan waktu loading"],
        containment: "Pisahkan hari ini juga: tandai setiap keterlambatan sebagai milik warehouse atau milik fleet.",
        correction: "Pasang cut-off jam siap warehouse dan pantau rute yang berulang terlambat, bukan rata-rata harian.",
        owner: "Fleet + SPV Outbound",
        trigger: "On-time dispatch <98% atau on-time depart <98%.",
        evaluate: (value, fmt) => {
          if (!below(value.on_time_dispatch, 98) && !below(value.on_time_depart, 98)) return null;
          return [`On-time dispatch ${fmt.pct("on_time_dispatch")}`, `On-time depart ${fmt.pct("on_time_depart")}`, `On-time arrival ${fmt.pct("on_time_arrival")}`];
        },
      },
      {
        id: "fleet-shortfall",
        title: "Armada yang jalan lebih sedikit dari yang dijanjikan",
        floorSymptom: "Rute digabung di menit terakhir dan sebagian koli menunggu keberangkatan berikutnya.",
        dataSignature: "Truck delivered di bawah 98% terhadap truk dedicated.",
        rootCauses: ["Armada bermasalah tanpa cadangan", "Driver tidak tersedia", "Rencana armada disusun dari volume rata-rata"],
        containment: "Aktifkan truk on call sekarang dan prioritaskan rute dengan koli terbanyak.",
        correction: "Sepakati cadangan armada minimum dan ukur pemakaian on call sebagai indikator kecukupan rencana.",
        owner: "Fleet",
        trigger: "Truck delivered <98%.",
        evaluate: (value, fmt) => below(value.truck_delivered_rate, 98) ? [`Truck delivered ${fmt.pct("truck_delivered_rate")}`, `Dedicated ${fmt.num("truck_dedicated")} vs terkirim ${fmt.num("actual_truck_delivered")}`, `On call ${fmt.num("truck_on_call")}`] : null,
      },
    ],
  },
  {
    id: "quality-value",
    stage: "Mutu",
    title: "Wastage & nilai yang hilang",
    shiftMoment: "Ditutup harian, ditinjau mingguan",
    owner: "QA + Inventory Control",
    purpose: "Mengubah kerusakan dari jumlah kasus menjadi nilai, karena prioritas perbaikan mengikuti nilai dan bukan mengikuti tahap mana yang paling sering dibahas.",
    wmsSteps: [
      "Setiap loss diberi reason code pada hari kejadian. Reason code yang diisi seminggu kemudian adalah tebakan.",
      "Pisahkan empat penyebab: handling, kedaluwarsa, rusak sejak datang, dan lain-lain. Keempatnya punya pemilik yang berbeda.",
      "Loss yang berasal dari vendor masuk jalur klaim, bukan jalur perbaikan internal. Menggabungkan keduanya membuat keduanya tidak selesai.",
      "Tutup angka harian sebelum shift berganti; akumulasi mingguan tidak bisa ditelusuri ke kejadian.",
    ],
    gembaChecks: [
      "Berdirilah di area bad stock dan lihat isinya. Kalau kategori terbesarnya sama setiap minggu, tidak ada yang sedang diperbaiki.",
      "Ambil lima barang kedaluwarsa dan telusuri lokasinya. Hampir selalu lokasi yang sulit dijangkau atau lokasi dengan dua batch.",
      "Bandingkan barang rusak karena handling dengan cara penumpukan di lorong. Sebagian besar penyebabnya terlihat hanya dengan berdiri di sana.",
      "Kalau kategori 'lain-lain' paling besar, yang rusak adalah reason code-nya, bukan barangnya.",
    ],
    handoffRisk: "Loss tanpa penyebab yang jelas akan dibebankan ke gudang secara keseluruhan, dan perbaikan yang benar—di vendor, di putaway, atau di penumpukan—tidak akan pernah dimulai.",
    signals: ["total_wastage_wh", "total_wastage_all", "wastage_handling", "wastage_expired", "wastage_inbound_to_bad", "wastage_others", "gmv"],
    unmeasured: ["Wastage per SKU dan per lokasi", "Nilai klaim yang berhasil ditagih", "Umur barang saat dinyatakan rusak", "Cakupan dan cut-off GMV belum terkonfirmasi sehingga rasio ke GMV belum bisa dipakai"],
    failureModes: [
      {
        id: "unclassified-loss",
        title: "Penyebab terbesar adalah 'lain-lain'",
        floorSymptom: "Rapat mingguan membahas total kerusakan tanpa ada yang bisa menyebut penyebabnya.",
        dataSignature: "Wastage lain-lain melebihi salah satu kategori bernama.",
        rootCauses: ["Reason code diisi belakangan", "Pilihan reason code tidak mencerminkan kejadian nyata", "Tidak ada yang memeriksa isian"],
        containment: "Hari ini, setiap loss di atas nilai tertentu harus punya foto dan penyebab sebelum ditutup.",
        correction: "Rapikan daftar reason code berdasarkan kejadian yang benar-benar terjadi, lalu audit isiannya mingguan.",
        owner: "QA",
        trigger: "Wastage lain-lain lebih besar dari wastage handling atau kedaluwarsa.",
        evaluate: (value, fmt) => {
          const others = value.wastage_others;
          if (others === null) return null;
          const named = [value.wastage_handling, value.wastage_expired].filter((item): item is number => item !== null);
          if (!named.length || others <= Math.max(...named)) return null;
          return [`Lain-lain ${fmt.num("wastage_others")}`, `Handling ${fmt.num("wastage_handling")}`, `Kedaluwarsa ${fmt.num("wastage_expired")}`];
        },
      },
      {
        id: "vendor-loss-absorbed",
        title: "Kerusakan dari vendor diserap gudang",
        floorSymptom: "Barang yang datang sudah rusak tetap masuk hitungan kerusakan gudang.",
        dataSignature: "Wastage inbound-to-bad terbaca nyata terhadap total.",
        rootCauses: ["Bukti kondisi saat bongkar tidak diambil", "Jalur klaim lebih repot daripada menyerap", "Loss tidak dipisahkan sejak awal"],
        containment: "Pisahkan angkanya sekarang, sebelum masuk laporan gabungan.",
        correction: "Jalankan klaim dengan bukti foto saat bongkar; tanpa bukti, klaim tidak akan pernah berjalan.",
        owner: "QA + Buyer",
        trigger: "Wastage inbound-to-bad > 0.",
        evaluate: (value, fmt) => above(value.wastage_inbound_to_bad, 0)
          ? [`Inbound-to-bad ${fmt.num("wastage_inbound_to_bad")}`, `Wastage gudang ${fmt.num("total_wastage_wh")}`, `Wastage total ${fmt.num("total_wastage_all")}`]
          : null,
      },
    ],
  },
];

/* ------------------------------------------------------------------------- */

function scaleValue(rule: FloorMetricRule, value: number | null): number | null {
  if (value === null) return null;
  return rule.scale === "fraction" ? value * 100 : value;
}

export function floorSeverity(rule: FloorMetricRule, value: number | null): Severity {
  if (value === null || rule.target === null) return "neutral";
  if (rule.higher) return value >= rule.target ? "good" : value >= rule.target * 0.92 ? "watch" : "critical";
  // Lower-is-better metrics with a target of zero have no proportional band, so
  // the watch band is expressed in absolute points of the metric itself.
  const watchLimit = rule.target === 0 ? 50 / rule.slope : rule.target * 1.12;
  return value <= rule.target ? "good" : value <= watchLimit ? "watch" : "critical";
}

/** Unrounded on purpose: rounding here would send a deep shortfall to exactly 0
 *  and undo the decay curve's whole point, which is that two failing metrics
 *  stay rankable against each other. The station average rounds once, at the end. */
export function floorScore(rule: FloorMetricRule, value: number | null): number | null {
  if (value === null || rule.target === null) return null;
  return rule.higher ? decayScore(rule.target - value, rule.slope) : decayScore(value - rule.target, rule.slope);
}

interface ResolvedSignal {
  signal: FloorSignal;
  basis: TargetBasis;
  /** Set only for floor-owned rules; engine keys are graded by the engine. */
  score: number | null;
}

function signalFor(key: string, resolve: FloorResolver): ResolvedSignal | null {
  const floorRule = FLOOR_METRIC_RULES[key];
  if (floorRule) {
    const aggregate = resolve.raw(key, floorRule.aggregation);
    const value = scaleValue(floorRule, aggregate.value);
    return {
      signal: {
        key,
        label: floorRule.label,
        value,
        target: floorRule.target,
        unit: floorRule.unit,
        severity: floorSeverity(floorRule, value),
        coverage: aggregate.coverage,
        floorNote: floorRule.floorNote,
      },
      basis: floorRule.basis,
      score: floorScore(floorRule, value),
    };
  }
  const kpi = resolve.kpi(key);
  if (!kpi) return null;
  return {
    signal: {
      key,
      label: kpi.label,
      value: kpi.value,
      target: kpi.target,
      unit: kpi.unit,
      severity: kpi.severity,
      coverage: kpi.coverage,
      floorNote: kpi.interpretation,
    },
    basis: "guardrail",
    score: null,
  };
}

const stateRank: Record<FloorStationState, number> = { breached: 4, pressured: 3, partial: 2, unmeasured: 1, controlled: 0 };

export function buildFloorStations(resolve: FloorResolver, engineScore: (key: string, value: number | null) => number): FloorStation[] {
  return FLOOR_STATIONS.map((config, index) => {
    const resolved = config.signals.map((key) => signalFor(key, resolve)).filter((item): item is ResolvedSignal => item !== null);
    const signals = resolved.map((item) => item.signal);
    const measured = signals.filter((signal) => signal.value !== null);
    const values: Values = Object.fromEntries(signals.map((signal) => [signal.key, signal.value]));
    const formatter: Formatter = {
      pct: (key, precision = 1) => values[key] === null || values[key] === undefined ? "n/a" : `${(values[key] as number).toLocaleString("id-ID", { minimumFractionDigits: precision, maximumFractionDigits: precision })}%`,
      num: (key, precision = 0) => values[key] === null || values[key] === undefined ? "n/a" : (values[key] as number).toLocaleString("id-ID", { maximumFractionDigits: precision }),
    };

    // Station scoring reuses the engine's grade for KPI keys and the floor rule
    // for the rest, so a station cannot grade itself more kindly than the KPI
    // that sits above it.
    const scores = resolved.flatMap(({ signal, score: floorRuleScore }) => {
      if (signal.value === null) return [];
      if (FLOOR_METRIC_RULES[signal.key]) return floorRuleScore === null ? [] : [floorRuleScore];
      return [engineScore(signal.key, signal.value)];
    });
    const score = scores.length ? Math.round(clamp(scores.reduce((sum, item) => sum + item, 0) / scores.length)) : null;

    const failureModes: FloorFailureMode[] = config.failureModes.map((mode) => {
      const evidence = mode.evaluate(values, formatter);
      return {
        id: mode.id,
        title: mode.title,
        floorSymptom: mode.floorSymptom,
        dataSignature: mode.dataSignature,
        rootCauses: mode.rootCauses,
        containment: mode.containment,
        correction: mode.correction,
        owner: mode.owner,
        trigger: mode.trigger,
        active: evidence !== null,
        evidence: evidence ?? [],
      };
    });

    const breaching = measured.filter((signal) => signal.severity === "critical");
    const watching = measured.filter((signal) => signal.severity === "watch");
    const gradable = signals.filter((signal) => signal.target !== null);
    // A live failure mode counts as pressure even when no single signal is over
    // its own line: several modes fire on a relationship between two readings
    // that are each, on their own, inside guardrail.
    const state: FloorStationState = measured.length === 0 ? "unmeasured"
      : breaching.length ? "breached"
        : watching.length || failureModes.some((mode) => mode.active) ? "pressured"
          : measured.length < Math.ceil(signals.length / 2) ? "partial"
            : "controlled";

    const reading = measured.length === 0
      ? "Tidak ada kolom sumber yang terisi untuk stasiun ini pada rentang aktif. Kosong berarti tidak terukur, bukan berarti aman."
      : breaching.length
        ? `${breaching.map((signal) => signal.label).join(", ")} menembus ambang; ${measured.length} dari ${signals.length} sinyal terbaca.`
        : watching.length
          ? `${watching.map((signal) => signal.label).join(", ")} mendekati ambang; ${measured.length} dari ${signals.length} sinyal terbaca.`
          : `Seluruh sinyal terukur berada dalam ambang; ${measured.length} dari ${signals.length} sinyal terbaca.`;

    return {
      id: config.id,
      sequence: index + 1,
      stage: config.stage,
      title: config.title,
      shiftMoment: config.shiftMoment,
      owner: config.owner,
      purpose: config.purpose,
      wmsSteps: config.wmsSteps,
      gembaChecks: config.gembaChecks,
      handoffRisk: config.handoffRisk,
      score: gradable.length ? score : null,
      state,
      reading,
      signals,
      failureModes: failureModes.sort((a, b) => Number(b.active) - Number(a.active)),
      unmeasured: config.unmeasured,
    } satisfies FloorStation;
  });
}

export function buildFloorBriefing(stations: FloorStation[]): FloorBriefing {
  const breached = stations.filter((station) => station.state === "breached");
  const pressured = stations.filter((station) => station.state === "pressured");
  const unmeasured = stations.filter((station) => station.state === "unmeasured");
  const measuredStations = stations.filter((station) => station.state !== "unmeasured");

  // The walk is ordered by state first and station score second, then follows
  // the physical sequence — an upstream station is visited before the station
  // that inherits its output, because fixing it downstream never holds.
  const ranked = [...stations]
    .filter((station) => station.state === "breached" || station.state === "pressured")
    .sort((a, b) => stateRank[b.state] - stateRank[a.state] || (a.score ?? 100) - (b.score ?? 100) || a.sequence - b.sequence);
  const walkOrder = ranked.slice(0, 4).map((station) => {
    const active = station.failureModes.find((mode) => mode.active);
    return {
      stationId: station.id,
      title: station.title,
      reason: active ? active.floorSymptom : station.reading,
      action: active ? active.containment : "Konfirmasi angka di lantai sebelum mengubah alokasi orang.",
    };
  });

  const constraint = ranked[0] ?? null;
  const headline = constraint
    ? `${constraint.title} menjadi titik tersempit pada rentang ini`
    : measuredStations.length === 0
      ? "Belum ada stasiun yang terukur pada rentang ini"
      : "Tidak ada stasiun yang menembus ambang pada rentang ini";
  const narrative = constraint
    ? `${breached.length} stasiun menembus ambang dan ${pressured.length} mendekati ambang. Mulai dari ${constraint.title}: memperbaikinya di stasiun berikutnya tidak akan bertahan. ${unmeasured.length} stasiun belum punya kolom sumber yang terisi dan tidak boleh dibaca sebagai aman.`
    : `Seluruh stasiun terukur berada dalam ambang. ${unmeasured.length} stasiun belum punya kolom sumber yang terisi — itu gap pengukuran, bukan bukti kondisi baik.`;

  return {
    constraintStationId: constraint?.id ?? null,
    headline,
    narrative,
    breachedCount: breached.length,
    pressuredCount: pressured.length,
    unmeasuredCount: unmeasured.length,
    measuredStations: measuredStations.length,
    totalStations: stations.length,
    walkOrder,
  };
}
