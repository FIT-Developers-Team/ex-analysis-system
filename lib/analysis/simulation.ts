import type {
  SimulationBaselineInput,
  SimulationConstraint,
  SimulationDelta,
  SimulationInputs,
  SimulationResult,
  SimulationRoleState,
  SimulationScenario,
} from "@/lib/types";

/* ============================================================================
   Scenario model
   ----------------------------------------------------------------------------
   The previous version multiplied the inputs by fitted-looking coefficients
   (0.42, 0.28, 0.55…) that came from nowhere and could not be argued with. This
   one is arithmetic on the warehouse's own identities:

     demand'        = demand × (1 + demandChange)
     afterCancel'   = demand' × (1 − cancelRate')
     throughput_r   = mandays_r × demonstratedRate_r × (1 + processGain)
     ceiling        = min(afterCancel', min_r throughput_r, physical capacity)
     served         = ceiling × executionYield
     demandFill     = served ÷ demand'
     fulfillment    = served ÷ afterCancel'

   Capacity is projected from the rate each bench actually achieved, not from its
   target. The first draft used the target and immediately produced a false
   answer: PGS packers beat their target by 5%, so a target-rate model declared
   packing the constraint on a day it was comfortably keeping up. Targets are the
   standard a role is measured against; demonstrated rate is what it will do
   tomorrow. Attainment is still scored against the target, so beating it shows
   up as a win rather than as a quietly lowered bar.

   Two properties make it trustworthy. It reproduces the observed baseline when
   every input is zero, because executionYield is calibrated to do that. And the
   chain runs at the speed of its slowest station — adding pickers changes
   nothing when the loading dock is the constraint, which is the single most
   common way a staffing decision is wasted.

   executionYield is the one assumption. It absorbs every loss the model does not
   name and is held constant across the scenario. That is stated, not hidden.
   ============================================================================ */

const ROLE_LABEL: Record<string, string> = { picker: "Picker", packer: "Packer", loader: "Loader" };

const emptyScenario = (): SimulationScenario => ({
  demandBeforeCancel: 0,
  cancelPct: 0,
  demandAfterCancel: 0,
  cancelledQty: 0,
  ceiling: 0,
  served: 0,
  unserved: 0,
  demandFillPct: 0,
  fulfillmentPct: 0,
  utilisationPct: null,
  costToServe: null,
  totalMandays: 0,
  roles: [],
  constraint: "demand",
  constraintLabel: "Belum dapat dihitung",
  headroomUnits: 0,
});

const clampPct = (value: number) => Math.min(100, Math.max(0, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

interface UsableRole {
  key: string;
  role: string;
  mandays: number;
  /** The agreed standard, used for attainment. */
  targetRate: number;
  /** What the bench actually delivered, used for capacity. */
  demonstratedRate: number;
}

function usableRoles(baseline: SimulationBaselineInput): UsableRole[] {
  return baseline.roles.flatMap((role) => {
    if (role.mandays === null || role.mandays <= 0 || role.targetRate === null || role.targetRate <= 0) return [];
    const demonstrated = role.actualRate !== null && role.actualRate > 0 ? role.actualRate : role.targetRate;
    return [{
      key: role.key,
      role: role.role ?? ROLE_LABEL[role.key] ?? role.key,
      mandays: role.mandays,
      targetRate: role.targetRate,
      demonstratedRate: demonstrated,
    }];
  });
}

function buildScenario(
  roles: UsableRole[],
  demandBeforeCancel: number,
  cancelPct: number,
  mandayMultipliers: Record<string, number>,
  rateMultiplier: number,
  physicalCapacity: number | null,
  executionYield: number,
  pickerMandaysForCost: number,
): SimulationScenario {
  const demandAfterCancel = demandBeforeCancel * (1 - clampPct(cancelPct) / 100);

  const roleStates: SimulationRoleState[] = roles.map((role) => {
    const mandays = Math.max(0, role.mandays * (mandayMultipliers[role.key] ?? 1));
    const ratePerManday = role.demonstratedRate * rateMultiplier;
    return {
      key: role.key,
      role: role.role,
      mandays,
      ratePerManday,
      throughput: mandays * ratePerManday,
      // Both filled in below, once the served volume is known.
      attainmentPct: 0,
      requiredMandays: ratePerManday > 0 ? demandAfterCancel / ratePerManday : 0,
      binding: false,
    };
  });

  const labourThroughput = roleStates.length ? Math.min(...roleStates.map((role) => role.throughput)) : Number.POSITIVE_INFINITY;
  const capacity = physicalCapacity !== null && physicalCapacity > 0 ? physicalCapacity : Number.POSITIVE_INFINITY;
  const ceiling = Math.min(demandAfterCancel, labourThroughput, capacity);
  const served = Math.max(0, ceiling * executionYield);

  roleStates.forEach((state, index) => {
    // Attainment is measured against the source's target rate, never against the
    // rate the scenario improved: a process gain should show up as more output,
    // not as a quietly lowered bar.
    const sourceRate = roles[index].targetRate;
    state.attainmentPct = state.mandays > 0 && sourceRate > 0 ? (served / state.mandays / sourceRate) * 100 : 0;
    state.binding = Number.isFinite(labourThroughput) && state.throughput === labourThroughput && labourThroughput < demandAfterCancel;
  });

  const constraint: SimulationConstraint = ceiling === demandAfterCancel
    ? "demand"
    : ceiling === labourThroughput ? "labour" : "capacity";
  const bindingRole = roleStates.find((role) => role.binding);
  const constraintLabel = constraint === "demand"
    ? "Permintaan — kapasitas masih tersisa"
    : constraint === "labour"
      ? `Orang di ${bindingRole?.role ?? "salah satu peran"} — di sinilah alurnya tertahan`
      : "Kapasitas SO harian — batas fisik tercapai";

  const totalMandays = roleStates.reduce((sum, role) => sum + role.mandays, 0);
  const pickerMandays = roleStates.find((role) => role.key === "picker")?.mandays ?? pickerMandaysForCost;

  return {
    demandBeforeCancel,
    cancelPct: clampPct(cancelPct),
    demandAfterCancel,
    cancelledQty: Math.max(0, demandBeforeCancel - demandAfterCancel),
    ceiling: Number.isFinite(ceiling) ? ceiling : demandAfterCancel,
    served,
    unserved: Math.max(0, demandBeforeCancel - served),
    demandFillPct: demandBeforeCancel > 0 ? (served / demandBeforeCancel) * 100 : 0,
    fulfillmentPct: demandAfterCancel > 0 ? (served / demandAfterCancel) * 100 : 0,
    utilisationPct: physicalCapacity !== null && physicalCapacity > 0 ? (demandAfterCancel / physicalCapacity) * 100 : null,
    costToServe: served > 0 && pickerMandays > 0 ? (pickerMandays / served) * 1_000 : null,
    totalMandays,
    roles: roleStates,
    constraint,
    constraintLabel,
    headroomUnits: Number.isFinite(labourThroughput) ? labourThroughput - demandAfterCancel : 0,
  };
}

export function runSimulation(baseline: SimulationBaselineInput, inputs: SimulationInputs): SimulationResult {
  const roles = usableRoles(baseline);
  const demand = baseline.demandBeforeCancel;
  const cancelPct = baseline.cancelPct ?? 0;
  const served = baseline.served;

  if (demand === null || demand <= 0 || served === null || served < 0 || !roles.length) {
    return {
      available: false,
      unavailableReason: !roles.length
        ? "Target produktivitas atau manday per peran belum terbaca pada rentang ini, sehingga kapasitas tidak bisa dihitung."
        : "Volume permintaan atau unit siap kirim belum terbaca pada rentang ini.",
      baseline: emptyScenario(),
      scenario: emptyScenario(),
      deltas: [],
      executionYieldPct: 0,
      notes: [],
      assumptions: [],
    };
  }

  // Calibration. The ceiling the model would predict for the observed window,
  // divided into what the window actually served. Capped at 1: a yield above
  // 100% would mean the warehouse shipped more than its own ceiling, which means
  // the ceiling is wrong rather than the operation being superhuman.
  const referenceCeiling = buildScenario(roles, demand, cancelPct, {}, 1, baseline.outboundCapacity, 1, 0).ceiling;
  const executionYield = referenceCeiling > 0 ? Math.min(1, served / referenceCeiling) : 1;

  const multipliers = {
    picker: 1 + inputs.pickerMandaysChange / 100,
    packer: 1 + inputs.packerMandaysChange / 100,
    loader: 1 + inputs.loaderMandaysChange / 100,
  };
  const pickerBaseline = roles.find((role) => role.key === "picker")?.mandays ?? 0;

  const baselineScenario = buildScenario(roles, demand, cancelPct, {}, 1, baseline.outboundCapacity, executionYield, pickerBaseline);
  const scenario = buildScenario(
    roles,
    demand * (1 + inputs.demandChange / 100),
    cancelPct + inputs.cancelChange,
    multipliers,
    1 + inputs.processGain / 100,
    baseline.outboundCapacity,
    executionYield,
    pickerBaseline,
  );

  const delta = (
    key: string,
    label: string,
    unit: SimulationDelta["unit"],
    before: number | null,
    after: number | null,
    higherIsBetter: boolean,
  ): SimulationDelta => {
    const change = before === null || after === null ? 0 : after - before;
    const meaningful = Math.abs(change) >= (unit === "unit" ? 1 : 0.05);
    return {
      key,
      label,
      unit,
      baseline: before === null ? null : round(before),
      scenario: after === null ? null : round(after),
      change: round(change),
      direction: !meaningful ? "flat" : (change > 0) === higherIsBetter ? "better" : "worse",
    };
  };

  const bindingRole = scenario.roles.find((role) => role.binding) ?? scenario.roles[0];
  const baselineBinding = baselineScenario.roles.find((role) => role.binding) ?? baselineScenario.roles[0];

  const deltas: SimulationDelta[] = [
    delta("demand_fill", "Permintaan terlayani", "pp", baselineScenario.demandFillPct, scenario.demandFillPct, true),
    delta("fulfillment", "Terpenuhi setelah batal", "pp", baselineScenario.fulfillmentPct, scenario.fulfillmentPct, true),
    delta("served", "Unit terlayani", "unit", baselineScenario.served, scenario.served, true),
    delta("unserved", "Permintaan tidak terlayani", "unit", baselineScenario.unserved, scenario.unserved, false),
    delta("attainment", `Produktivitas ${bindingRole?.role ?? "peran utama"}`, "pp", baselineBinding?.attainmentPct ?? null, bindingRole?.attainmentPct ?? null, true),
    delta("utilisation", "Pemakaian kapasitas", "pp", baselineScenario.utilisationPct, scenario.utilisationPct, false),
    delta("mandays", "Total manday outbound", "manday", baselineScenario.totalMandays, scenario.totalMandays, false),
    delta("cost", "Manday per 1.000 unit", "ratio", baselineScenario.costToServe, scenario.costToServe, false),
  ];

  const notes: string[] = [];
  const number = (value: number) => Math.round(value).toLocaleString("id-ID");

  if (scenario.constraint === "demand") {
    notes.push(`Yang membatasi adalah permintaan, bukan orang. Masih ada sisa kemampuan ${number(Math.max(0, scenario.headroomUnits))} unit di stasiun terlambat. Menambah orang pada kondisi ini menurunkan output per manday tanpa menambah satu unit pun.`);
  } else if (scenario.constraint === "labour") {
    notes.push(`Alurnya tertahan di ${bindingRole?.role ?? "salah satu peran"}: kemampuannya ${number(bindingRole?.throughput ?? 0)} unit terhadap permintaan ${number(scenario.demandAfterCancel)} unit. Menambah orang di peran lain tidak akan menaikkan hasil.`);
    if (bindingRole) {
      const extra = Math.max(0, bindingRole.requiredMandays - bindingRole.mandays);
      if (extra > 0) notes.push(`Untuk menutupnya, ${bindingRole.role} perlu tambahan ${extra.toLocaleString("id-ID", { maximumFractionDigits: 1 })} manday pada laju target yang sama.`);
    }
  } else {
    notes.push(`Batas fisik kapasitas SO tercapai pada ${number(scenario.demandAfterCancel)} unit. Menambah orang tidak menembus batas ini—yang perlu diubah adalah gelombang, jadwal keberangkatan, atau kapasitasnya sendiri.`);
  }

  if (inputs.cancelChange < 0) {
    const recovered = scenario.served - baselineScenario.served;
    notes.push(recovered > 1
      ? `Menahan pembatalan mengembalikan ${number(recovered)} unit ke dalam antrean kerja, dan kapasitas saat ini mampu menyerapnya.`
      : "Menahan pembatalan menambah permintaan, tetapi kapasitas saat ini belum mampu menyerapnya—unit itu hanya berpindah dari dibatalkan menjadi tidak terlayani.");
  }
  if (inputs.cancelChange > 0) {
    notes.push("Menaikkan pembatalan memperbaiki angka setelah batal dan memperburuk porsi permintaan yang benar-benar dilayani. Beberapa metrik berbonus ikut membaik karena penyebutnya mengecil.");
  }

  const dilution = deltas.find((item) => item.key === "attainment");
  const mandaysUp = inputs.pickerMandaysChange > 0 || inputs.packerMandaysChange > 0 || inputs.loaderMandaysChange > 0;
  if (mandaysUp && dilution && dilution.direction === "worse") {
    notes.push("Tambahan orang menurunkan output per manday karena volume tidak ikut naik. Ini dilusi, bukan penurunan kinerja.");
  }
  if (inputs.processGain > 0 && scenario.constraint === "demand") {
    notes.push("Perbaikan proses tidak menambah hasil selama permintaan yang membatasi. Nilainya baru terlihat pada hari puncak.");
  }
  if (!notes.length) notes.push("Skenario berada di sekitar kondisi saat ini. Ubah salah satu pengatur untuk melihat batasnya.");

  return {
    available: true,
    unavailableReason: null,
    baseline: baselineScenario,
    scenario,
    deltas,
    executionYieldPct: executionYield * 100,
    notes,
    assumptions: [
      `Kapasitas memakai laju yang benar-benar dicapai pada rentang ini: ${roles.map((role) => `${role.role} ${Math.round(role.demonstratedRate).toLocaleString("id-ID")}/manday`).join(", ")}. Targetnya sendiri dipakai untuk menilai pencapaian, bukan untuk memproyeksikan kemampuan.`,
      `Kehilangan yang tidak dimodelkan—pick gagal, barang ditolak, koli hilang—dipertahankan tetap pada ${(executionYield * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}% dari kemampuan.`,
      "Sebaran beban per jam tidak tersedia, jadi model ini memakai rata-rata harian. Beban yang menumpuk di satu jam tetap butuh lebih banyak orang pada jam itu.",
      "Perbaikan proses dianggap menaikkan laju semua peran secara merata; kalau perbaikannya hanya di satu stasiun, geser manday peran itu saja.",
    ],
  };
}
