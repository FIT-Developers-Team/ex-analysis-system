import type { KnowledgeArticle } from "@/lib/types";

/* ============================================================================
   Knowledge base
   ----------------------------------------------------------------------------
   Three kinds of article, kept apart because they carry different authority:

   - Proses: how the work is supposed to run. Standing operating knowledge. It
     covers steps the sheet does not measure, because a supervisor still has to
     run them and a gap in measurement is not a gap in the job.
   - Rumus: every number this product computes, written out. If a formula is not
     here, the product should not be showing the number.
   - Aturan: the decision rules — what you are and are not allowed to conclude
     from a reading, and what has to be checked before acting on it.

   Written in the second person and in short sentences on purpose. This is read
   standing up.
   ============================================================================ */

const process = (
  id: string,
  domain: string,
  title: string,
  summary: string,
  body: string[],
  relatedStationIds: string[] = [],
): KnowledgeArticle => ({ id, group: "Proses", domain, title, summary, body, formula: null, basis: null, relatedStationIds });

const formula = (
  id: string,
  domain: string,
  title: string,
  summary: string,
  formulaText: string,
  basis: string,
  body: string[],
  relatedStationIds: string[] = [],
): KnowledgeArticle => ({ id, group: "Rumus", domain, title, summary, body, formula: formulaText, basis, relatedStationIds });

const rule = (
  id: string,
  domain: string,
  title: string,
  summary: string,
  body: string[],
  basis: string,
): KnowledgeArticle => ({ id, group: "Aturan", domain, title, summary, body, formula: null, basis, relatedStationIds: [] });

export const KNOWLEDGE_BASE: KnowledgeArticle[] = [
  /* --- Proses: inbound ---------------------------------------------------- */
  process(
    "proc-dock-schedule", "Inbound", "Menyusun jadwal dock",
    "Bagi slot dock mengikuti jam kedatangan yang nyata, bukan dibagi rata sepanjang shift.",
    [
      "Ambil realisasi jam bongkar empat minggu terakhir dan buat kurvanya per jam. Hampir selalu ada dua puncak, bukan aliran rata.",
      "Satu slot satu PO. Menggabung dua PO dalam satu slot membuat selisih tidak bisa ditelusuri ke vendor mana pun.",
      "Sisakan satu slot kosong per puncak. Slot itu bukan pemborosan—itu yang membuat satu truk terlambat tidak mengunci tiga truk di belakangnya.",
      "Konfirmasi ETA H-1 sore. Konfirmasi pagi hari-H sudah terlambat untuk memindahkan orang.",
      "Vendor yang berulang meleset tidak diberi slot puncak. Ini keputusan penjadwalan, bukan hukuman.",
    ],
    ["po-arrival"],
  ),
  process(
    "proc-grn-discipline", "Inbound", "Disiplin GRN",
    "Semua yang salah harus ditandai sebelum posting. Setelah posting, itu jadi pekerjaan inventory.",
    [
      "Baris discrepancy—kurang, lebih, rusak—diselesaikan di baris GR-nya, bukan lewat penyesuaian setelahnya.",
      "Tanggal expired diketik dari kemasan fisik. Menyalin dari baris sebelumnya adalah cara termurah menciptakan wastage expired tiga bulan lagi.",
      "Satu user satu device. Kalau scanner dipakai bergantian, produktivitas per orang berhenti berarti dan Anda kehilangan satu-satunya alat untuk memisahkan orang lambat dari proses lambat.",
      "Garis lantai memisahkan palet yang sudah GRN dari yang belum. Kalau garisnya belum ada, buat hari ini; ini perbaikan paling murah di seluruh area inbound.",
      "SLA yang sebenarnya adalah selisih jam bongkar terakhir dengan jam posting terakhir. Bukan angka di laporan.",
    ],
    ["grn-checker"],
  ),
  process(
    "proc-cold-chain", "Inbound", "Rantai dingin",
    "Suhu dicatat di titik bongkar, bukan di ruang admin, dan chiller tidak pernah antre di ambient.",
    [
      "Foto segel dan suhu sebelum pintu truk dibuka. Setelah dibuka, bukti itu hilang dan klaim ke vendor tidak bisa ditegakkan.",
      "Frozen di bawah −18°C, chiller 0–4°C. Di luar itu barang ditahan, bukan diterima lalu dikeluhkan.",
      "Kalau QC antre, QC yang mendatangi barang. Barang dingin yang menunggu giliran di ambient sudah rusak sebelum diperiksa.",
      "Pantau lama pintu chiller dan frozen terbuka saat putaway ramai. Itu biaya energi sekaligus risiko mutu, dan tidak ada di laporan mana pun.",
    ],
    ["qc-badstock", "zone-capacity"],
  ),
  process(
    "proc-fefo", "Inventory", "FEFO ditegakkan di lokasi, bukan di sistem",
    "Urutan kedaluwarsa ditentukan saat menaruh barang. Yang tidak ditegakkan di rak tidak bisa diperbaiki di picking.",
    [
      "Batch lama di depan, batch baru di belakang. Kalau tidak muat, batch baru masuk lokasi lain—jangan ditumpuk di depan yang lama.",
      "Satu SLOC satu batch. Campur batch adalah penyebab LDP yang paling sering ditemukan saat penghitungan ulang.",
      "SKU dengan umur simpan pendek tidak masuk lokasi yang sulit dijangkau. Barang yang susah diambil akan dilewati sampai kedaluwarsa.",
      "Wastage expired hari ini adalah keputusan putaway tiga bulan lalu. Menelusurinya ke picker tidak akan menemukan apa pun.",
    ],
    ["putaway", "dcc-sloc"],
  ),
  process(
    "proc-cycle-count", "Inventory", "Merancang cycle count",
    "Hitung buta, hitung yang berisiko lebih sering, dan tutup koreksinya di hari yang sama.",
    [
      "Penghitung tidak boleh melihat angka sistem. Kalau terlihat, yang Anda uji adalah kemampuan menyalin.",
      "Frekuensi mengikuti risiko: lokasi bernilai tinggi, SKU cepat bergerak, dan SLOC yang berulang bermasalah dihitung lebih sering daripada sisanya.",
      "Rekonsiliasi SLOC × qty, bukan qty total. Qty benar di lokasi salah tetap membuat picker gagal.",
      "LDP dan LBH di lokasi bersebelahan yang saling meniadakan berarti salah taruh, bukan barang hilang. Dua hal itu punya tindakan yang berbeda.",
      "SLOC yang sama muncul tiga kali berturut-turut adalah masalah lokasi—label buram, akses sulit, dua batch—bukan masalah orang.",
    ],
    ["dcc-sloc"],
  ),
  process(
    "proc-slotting", "Inventory", "Penempatan SKU (slotting)",
    "SKU tercepat ditaruh paling dekat dan paling mudah dijangkau. Ini menghemat langkah setiap hari, bukan sekali.",
    [
      "Urutkan SKU berdasarkan frekuensi pengambilan, bukan berdasarkan volume stok. Yang sering diambil dan kecil harus di zona emas.",
      "Zona emas adalah ketinggian pinggang sampai bahu di lorong terdekat dengan staging. Di luar itu setiap pengambilan menambah gerakan.",
      "Tinjau ulang setelah promo besar dan setelah SKU baru masuk. Penempatan yang benar tahun lalu adalah penempatan yang salah sekarang.",
      "Sumber belum menyediakan data pengambilan per SKU, jadi keputusan ini masih perlu observasi langsung dan ekspor WMS terpisah.",
    ],
    ["putaway", "replenishment"],
  ),
  process(
    "proc-replenish-minmax", "Inventory", "Menentukan min–max pickface",
    "Min–max yang benar membuat replenish berhenti menjadi pekerjaan darurat.",
    [
      "Min = pengambilan rata-rata selama waktu isi ulang, ditambah cadangan untuk hari sibuk. Kalau min terlalu rendah, pickface kosong di tengah wave.",
      "Max = yang muat di lokasi tanpa menghalangi lokasi sebelah. Mengisi melebihi itu memindahkan masalah, bukan menyelesaikannya.",
      "SKU promo dan SKU baru hampir selalu punya min–max yang belum disesuaikan. Itu penyebab kekosongan yang paling sering dan paling mudah diperbaiki.",
      "Pickface yang berulang kosong tiga hari berturut-turut adalah masalah min–max, bukan masalah kecepatan tim replenish.",
    ],
    ["replenishment"],
  ),
  process(
    "proc-wave-design", "Outbound", "Menyusun wave",
    "Wave dibentuk dari jam keberangkatan, bukan dari urutan SO masuk.",
    [
      "Kelompokkan per rute dan per cut-off. Wave yang selesai tepat waktu secara total tetapi terlambat untuk satu rute adalah wave yang gagal.",
      "Ukuran wave mengikuti kapasitas staging, bukan jumlah picker. Wave yang lebih besar dari staging hanya memindahkan antrean.",
      "Buka wave berikutnya hanya setelah pickface untuk SKU teratasnya terisi. Menunda 15 menit lebih murah daripada mengejar seharian.",
      "Satu picker satu trolley satu wave. Trolley berpindah tangan menghapus jejak produktivitas per orang.",
    ],
    ["outbound-wave", "replenishment"],
  ),
  process(
    "proc-staging", "Outbound", "Mengatur staging",
    "Staging harus punya batas per rute yang terlihat dan hitungan yang tercatat.",
    [
      "Batas rute ditandai fisik di lantai. Batas yang samar membuat loader mengambil koli rute lain, dan itu muncul sebagai koli hilang.",
      "Hitung koli per rute sebelum truk merapat. Menghitung setelah truk datang berarti menghitung sambil diburu waktu.",
      "Koli tanpa label tidak boleh masuk staging. Satu koli tanpa label hari ini adalah satu toko yang komplain besok.",
      "Staging bukan penyimpanan. Koli yang menginap di staging akan bercampur dengan wave berikutnya.",
    ],
    ["packing-check", "loading-hub"],
  ),
  process(
    "proc-handover", "Outbound", "Serah terima ke hub",
    "Selisih ditutup di hari yang sama, selagi orangnya masih ingat.",
    [
      "Scan koli saat naik truk. Menghitung dari catatan staging berarti Anda memverifikasi catatan, bukan barang.",
      "Kunci manifest sebelum berangkat. Perubahan setelah truk jalan tidak akan pernah cocok dengan penerimaan hub.",
      "Catat jam siap warehouse terpisah dari jam berangkat. Keduanya milik owner yang berbeda, dan menggabungkannya membuat keterlambatan tidak bisa dibagi.",
      "Selisih yang dibiarkan sampai rekap mingguan akan berubah menjadi klaim, dan klaim tanpa bukti hitungan selalu jatuh ke warehouse.",
    ],
    ["loading-hub"],
  ),
  process(
    "proc-shift-handover", "Lintas fungsi", "Serah terima antar shift",
    "Lima menit yang menentukan apakah shift berikutnya mulai bekerja atau mulai mencari tahu.",
    [
      "Tiga hal yang wajib diserahkan: pekerjaan yang belum tutup, kejadian yang belum selesai, dan barang yang berpindah tanpa transaksi.",
      "Palet yang masih di staging disebutkan beserta jam GRN-nya, bukan hanya jumlahnya. Umur lebih penting daripada jumlah.",
      "Task yang menggantung di WMS ditutup atau diserahkan dengan nama. Task tanpa pemilik adalah task yang tidak akan dikerjakan.",
      "Shift yang menerima berjalan sendiri ke area sebelum menerima laporan. Laporan menjelaskan apa yang sudah diketahui; berjalan menemukan apa yang belum.",
    ],
    ["grn-checker", "putaway", "outbound-wave"],
  ),
  process(
    "proc-roster", "Personalia", "Menyusun roster dan tenaga cadangan",
    "Jumlah orang mengikuti sebaran beban, bukan rata-rata beban.",
    [
      "Hitung kebutuhan per hari dalam seminggu, bukan satu angka untuk semua hari. Hari puncak dan hari sepi memerlukan tim yang berbeda.",
      "Tentukan siapa yang boleh dipindah antar fungsi dan pada jam berapa. Tanpa aturan itu, peminjaman terjadi diam-diam dan SLA fungsi asal turun tanpa penjelasan.",
      "Porsi tenaga harian yang tinggi berarti hasil hari itu bergantung pada orang yang paling sedikit dilatih. Itu risiko, bukan penghematan.",
      "Ketidakhadiran ditutup sebelum lembur dibuka. Lembur menutup gejala dengan biaya paling mahal.",
    ],
    ["grn-checker", "outbound-wave"],
  ),
  process(
    "proc-ojt", "Personalia", "Kurva belajar orang baru",
    "Orang baru bukan versi lambat dari orang lama. Mereka sedang menaiki kurva yang bisa diukur.",
    [
      "Pisahkan output regular dan OJT dalam pengukuran. Menggabungkannya membuat target kolektif menghukum tim yang sedang melatih.",
      "Orang baru ditempatkan di zona sederhana dulu. Zona sulit untuk orang baru menghasilkan dua kerugian: lambat dan salah.",
      "Ukur berapa lama sampai mencapai target, bukan hanya apakah sudah mencapai. Waktunya adalah biaya pelatihan yang sebenarnya.",
      "Selisih besar antara output regular dan kolektif adalah biaya kurva belajar—informasi tentang komposisi tim, bukan kegagalan metode.",
    ],
    ["outbound-wave"],
  ),
  process(
    "proc-device", "Lintas fungsi", "Disiplin device dan master data",
    "Pekerjaan yang tidak lewat device tidak punya jejak, dan yang tidak punya jejak tidak bisa dinilai.",
    [
      "Rasio device terhadap orang dicek di awal shift bersama baterai dan charger. Device habis baterai di tengah gelombang adalah penyebab berhenti yang paling sering dan paling murah dicegah.",
      "Tenaga harian tetap dibuatkan user sementara. User bersama menghapus seluruh kemampuan menelusuri.",
      "Master SKU—barcode, dimensi, satuan—diperbaiki di sumbernya. Setiap koreksi manual di lantai akan terulang besok.",
      "Adopsi device di bawah 98% berarti sebagian pekerjaan berjalan tanpa catatan. Angka produktivitas hari itu mengukur sebagian orang saja.",
    ],
    ["grn-checker", "outbound-wave"],
  ),
  process(
    "proc-housekeeping", "Lintas fungsi", "Kerapian yang berdampak ke angka",
    "Tiga hal fisik yang muncul di laporan dua minggu kemudian.",
    [
      "Lorong yang terhalang membuat putaway lambat. Yang terlihat di laporan adalah produktivitas putaway, bukan lorongnya.",
      "Label lokasi yang buram membuat picker mengambil dari lokasi sebelah. Yang terlihat di laporan adalah akurasi SLOC.",
      "Palet kosong yang menempati slot mengurangi kapasitas nyata. Yang terlihat di laporan adalah utilisasi yang tampak aman padahal ruang sudah habis.",
    ],
    ["putaway", "zone-capacity", "dcc-sloc"],
  ),

  /* --- Rumus -------------------------------------------------------------- */
  formula(
    "form-demand-fill", "Outbound", "Permintaan terlayani",
    "Porsi permintaan awal yang benar-benar dilayani. Tidak bisa diperbaiki dengan membatalkan order.",
    "Siap kirim ÷ permintaan sebelum dibatalkan × 100",
    "Target 97% diturunkan dari guardrail yang sudah dipakai: FR 99% × (100% − target batal 2%).",
    [
      "Bacalah berdampingan dengan fulfillment setelah pembatalan. Selisih keduanya adalah porsi permintaan yang ditolak, bukan dilayani.",
      "Fulfillment setelah pembatalan bisa naik justru ketika layanan memburuk, karena penyebutnya ikut mengecil.",
    ],
    ["outbound-wave", "loading-hub"],
  ),
  formula(
    "form-productivity", "Lintas fungsi", "Pencapaian produktivitas",
    "Output nyata dibandingkan target, ditimbang oleh manday yang menghasilkannya.",
    "Σ(produktivitas harian × manday harian) ÷ Σ(target harian × manday harian) × 100",
    "Target diambil dari kolom target di sumber.",
    [
      "Ditimbang, bukan dirata-rata. Merata-ratakan persentase harian memberi hari sepi bobot yang sama dengan hari sibuk.",
      "Pembilangnya barang yang benar-benar diproses, bukan rencana. Rencana hanya menentukan kecukupan orang.",
    ],
    ["grn-checker", "putaway", "outbound-wave", "packing-check", "loading-hub"],
  ),
  formula(
    "form-manday-need", "Personalia", "Kebutuhan manday",
    "Berapa orang yang sebenarnya dibutuhkan beban kerja kemarin.",
    "Volume ÷ target produktivitas per manday",
    "Bukan standar baru—ini definisi kolom target produktivitas dibaca terbalik.",
    [
      "Bandingkan dengan manday yang benar-benar hadir. Selisihnya adalah kekurangan atau kelebihan yang nyata, bukan dugaan.",
      "Ini kebutuhan rata-rata harian. Beban yang menumpuk di satu jam tetap membutuhkan lebih banyak orang pada jam itu.",
    ],
    ["outbound-wave", "grn-checker"],
  ),
  formula(
    "form-forecast-split", "Planning", "Arah error vs naik-turun",
    "Memisahkan rencana yang salah arah dari permintaan yang memang bergejolak.",
    "Arah = rata-rata (aktual − rencana) ÷ rencana. Total error = rata-rata nilai mutlaknya. Naik-turun = total error − |arah|",
    "Metode standar pemisahan bias dan dispersi pada error peramalan.",
    [
      "Kalau sebagian besar error mengarah satu sisi, ubah angka rencananya.",
      "Kalau error besar tapi saling meniadakan, angka rencana sudah cukup benar dan yang dibutuhkan adalah tenaga cadangan.",
      "Satu angka akurasi tidak bisa membedakan keduanya, dan keduanya menuntut tindakan yang berlawanan.",
    ],
    ["po-arrival", "outbound-wave"],
  ),
  formula(
    "form-control-limit", "Lintas fungsi", "Batas kendali harian",
    "Memisahkan hari yang benar-benar aneh dari naik-turun biasa.",
    "Rata-rata ± 3σ, dengan σ = rata-rata selisih antar hari berurutan ÷ 1,128",
    "Peta kendali individual (XmR) dengan aturan Nelson 1 dan 2.",
    [
      "σ diambil dari selisih antar hari, bukan dari simpangan baku. Pergeseran proses membesarkan simpangan baku dan menyembunyikan dirinya sendiri.",
      "Titik di luar batas = ada penyebab khusus hari itu. Telusuri harinya.",
      "Delapan hari berturut di satu sisi rata-rata = prosesnya bergeser, bukan kebetulan.",
      "Stabil tidak berarti bagus. Artinya: hasil ini yang akan terus keluar kalau prosesnya tidak diubah.",
    ],
    [],
  ),
  formula(
    "form-wilson", "Lintas fungsi", "Rentang kepercayaan persentase",
    "Seberapa jauh sebuah persentase bisa meleset karena sampelnya kecil.",
    "Selang Wilson 95% atas p = keberhasilan ÷ percobaan",
    "Dipakai karena pendekatan normal meleset di dekat 0% dan 100%, tempat angka ketepatan waktu berada.",
    [
      "Persentase dari 20 pengamatan bisa meleset belasan poin. Persentase dari 300 pengamatan tidak.",
      "Kalau seluruh rentang masih di bawah target, kekurangannya nyata. Kalau rentangnya melewati target, belum bisa disimpulkan.",
    ],
    ["po-arrival", "loading-hub"],
  ),
  formula(
    "form-yield-chain", "Outbound", "Rantai hasil",
    "Berapa persen rencana awal yang benar-benar sampai ke hub, dan bocornya paling besar di mana.",
    "Hasil kumulatif = nilai tahap ÷ nilai tahap pertama. Porsi kebocoran = kebocoran tahap ÷ total kebocoran",
    "Dekomposisi rantai hasil standar.",
    [
      "Konversi per tahap terlihat baik-baik saja secara terpisah; yang menentukan adalah hasil kumulatifnya.",
      "Porsi kebocoran menentukan urutan perbaikan berdasarkan ukuran, bukan berdasarkan tahap mana yang kebetulan dibahas duluan.",
    ],
    ["outbound-wave", "packing-check", "loading-hub"],
  ),
  formula(
    "form-cost-to-serve", "Personalia", "Intensitas tenaga kerja",
    "Berapa manday yang dipakai untuk melayani seribu unit.",
    "Manday picker aktual ÷ unit siap kirim × 1.000",
    "Proksi operasional, bukan nilai rupiah. Sumber tidak memuat data upah.",
    [
      "Naik berarti tiap unit menjadi lebih mahal dalam tenaga. Turun belum tentu efisiensi—periksa dulu apakah permintaannya yang dibuang.",
    ],
    ["outbound-wave"],
  ),
  formula(
    "form-decay", "Lintas fungsi", "Skor 0–100",
    "Kekurangan diubah menjadi skor tanpa pernah menyentuh nol.",
    "Skor = 100 × 0,5^(kekurangan × kemiringan ÷ 50)",
    "Menggantikan penalti linier yang mentok di nol.",
    [
      "Penalti linier membuat metrik yang jauh di bawah target semuanya bernilai nol, sehingga tidak bisa diurutkan lagi.",
      "Dengan peluruhan, dua metrik yang sama-sama buruk tetap bisa dibandingkan.",
    ],
    [],
  ),

  /* --- Aturan ------------------------------------------------------------- */
  rule(
    "rule-cancel-first", "Outbound", "Hemat manday tidak dinilai selama pembatalan tinggi",
    "Membatalkan permintaan menurunkan kebutuhan orang dan menaikkan output per orang sekaligus.",
    [
      "Ketiga angka—manday, produktivitas, SLA—akan terlihat sehat, tapi ketiganya diukur setelah sebagian beban dibuang.",
      "Turunkan pembatalan ke bawah target dulu, baru ukur ulang kebutuhan orang pada beban penuh.",
      "Jangan mengubah baseline budget berdasarkan periode dengan pembatalan tinggi.",
    ],
    "Aturan mesin: hemat manday hanya disebut efisiensi bila permintaan terlayani ≥97%, batal ≤2%, SLA ≥98%, dan produktivitas ≥100%.",
  ),
  rule(
    "rule-breach-not-averaged", "Lintas fungsi", "Satu pelanggaran tidak bisa dirata-ratakan",
    "KPI mana pun yang menembus batasnya menahan status terkendali, berapa pun skor agregatnya.",
    [
      "Rata-rata basket bisa menyembunyikan dua pelanggaran di balik lima metrik sehat.",
      "Skor tetap ditampilkan, tetapi statusnya mengikuti pelanggaran, bukan rata-rata.",
    ],
    "Aturan mesin di healthFrom().",
  ),
  rule(
    "rule-blank-not-good", "Data", "Kosong bukan berarti aman",
    "Stasiun atau metrik tanpa data ditandai tidak terukur, tidak pernah dihitung sebagai baik.",
    [
      "Metrik yang dulu pernah dilaporkan lalu kosong adalah kemunduran pelaporan, dan itu dimunculkan sebagai peringatan.",
      "Metrik yang memang tidak pernah dilacak adalah keputusan cakupan, dan itu masuk daftar gap.",
      "Pilar yang hilang menurunkan kesetaraan perbandingan antar gudang, bukan menaikkan peringkatnya.",
    ],
    "Aturan mesin: pilar yang absen menurunkan comparable dan memunculkan jumlah pilar.",
  ),
  rule(
    "rule-correlation", "Data", "Hubungan bukan sebab",
    "Angka hubungan 84 hari adalah petunjuk untuk diuji, bukan dasar mengubah kebijakan.",
    [
      "Keyakinan mengikuti p-value dengan koreksi untuk seluruh kumpulan hipotesis, bukan mengikuti jumlah sampel.",
      "Pasangan yang berbagi satu variabel—produktivitas picker adalah volume dibagi manday—sebagian korelasinya dijamin oleh rumus dan tidak membuktikan apa pun.",
      "Hari tanpa operasi dikeluarkan. Nol bukan pengukuran.",
    ],
    "Ambang Bonferroni atas seluruh kumpulan hipotesis.",
  ),
  rule(
    "rule-threshold-basis", "Data", "Setiap ambang menyebut asalnya",
    "Ambang dari sumber, ambang yang sudah disepakati, dan ambang kerja mesin diperlakukan berbeda.",
    [
      "Ambang dari sumber berasal dari kolom target di sheet.",
      "Ambang guardrail sudah dipakai di tempat lain pada produk ini.",
      "Ambang kerja ditetapkan mesin karena sumber tidak punya—yang ini memang untuk didebat, bukan dipatuhi.",
      "Kalau tidak satu pun dari ketiganya jujur, angkanya ditampilkan sebagai konteks dan tidak dinilai.",
    ],
    "Aturan lapisan lantai.",
  ),
  rule(
    "rule-upstream-first", "Lintas fungsi", "Perbaiki di stasiun asalnya",
    "Masalah yang ditambal di hilir akan kembali besok.",
    [
      "Barang rusak yang lolos QC muncul sebagai pick-to-bad, dan yang disalahkan picker.",
      "Salah taruh saat putaway muncul sebagai selisih pada penghitungan, lalu sebagai task pencarian.",
      "Pickface yang tidak siap muncul sebagai produktivitas picking yang jatuh.",
      "Rute inspeksi selalu dimulai dari stasiun paling hulu yang bermasalah.",
    ],
    "Urutan rute inspeksi pada lapisan lantai.",
  ),
  rule(
    "rule-recovery-mask", "Inventory", "Recovery menutupi masalah akurasi",
    "Fulfillment yang ditopang pencarian barang terlihat sehat sambil menyembunyikan penyebabnya.",
    [
      "Kontribusi troubleshoot terhadap fulfillment yang naik berarti layanan bergantung pada pemadam kebakaran.",
      "Ukur keberhasilan dari turunnya jumlah task, bukan dari naiknya tingkat keberhasilan pencarian.",
      "Menambah troubleshooter tanpa memperbaiki akurasi hanya menambah biaya.",
    ],
    "Aturan lapisan lantai pada stasiun movement & troubleshoot.",
  ),
];

export function buildKnowledgeBase(): KnowledgeArticle[] {
  return KNOWLEDGE_BASE;
}
