export const METRIC_ALIASES: Record<string, string[]> = {
  forecast_mpp_inbound: ["forecast mpp inbound"],
  forecast_weekly_inbound: ["forecast weekly inbound"],
  actual_inbound: ["qty actual inbound"],
  incoming_inbound: ["qty incoming inbound"],
  inbound_utilization: ["inbound utilization", "inbound utilization %"],
  inbound_capacity: ["max inbound capacity"],
  sla_checker_inbound: ["sla checker inbound achievement"],
  budget_checker_mandays: ["budget mandays checker inbound"],
  actual_checker_mandays: ["actual mandays checker inbound"],
  // STR labels the same column "Checker Productivity Collective" and never
  // reports the longer spelling; the two never appear together in one warehouse,
  // so this is one metric under two names rather than two metrics being merged.
  checker_productivity: ["checker inbound actual productivity collective", "checker productivity collective"],
  checker_productivity_target: ["checker inbound productivity target"],
  // Only PGS suffixes these with "Putaway"; BIT, SRG, and STR carry the bare
  // labels inside the Inv-Putaway block. Both spellings are unique to putaway —
  // inbound and outbound prefix their own forecast columns.
  forecast_mpp_putaway: ["forecast mpp putaway", "forecast mpp"],
  forecast_weekly_putaway: ["forecast weekly putaway", "forecast weekly"],
  putaway_actual: ["putaway actual"],
  putaway_done: ["putaway done"],
  putaway_utilization: ["putaway utilization", "putaway utilization %"],
  putaway_productivity: ["putaway productivity"],
  putaway_productivity_target: ["putaway productivity target"],
  budget_putaway_mandays: ["budget mandays putaway"],
  actual_putaway_mandays: ["actual mandays putaway"],
  putaway_completion: ["putaway completion %"],
  inventory_actual: ["inventory actual ending (by qty)", "inventory actual max (by qty)"],
  inventory_capacity: ["inventory capacity max (by qty)"],
  inventory_forecast: ["inventory capacity forecast (by qty)"],
  inventory_utilization_max: ["inventory utilization actual (max.) vs max %", "inventory utilization actual (max.) vs max. capacity %"],
  inventory_accuracy_qty: ["inventory accuracy by qty (dcc regular)"],
  inventory_accuracy_sloc: ["inventory accuracy by sloc (dcc regular)"],
  sloc_qty_accuracy: ["sloc x qty accuracy (dcc regular)"],
  lbh_qty: ["lbh (by qty)"],
  ldp_qty: ["ldp (by qty)"],
  ldp_value: ["ldp (by value)"],
  found_rate: ["found %"],
  planogram_accuracy: ["planogram accuracy"],
  troubleshoot_created: ["troubleshoot task created"],
  troubleshoot_executed: ["troubleshoot task executed"],
  troubleshoot_fr: ["troubleshoot fr %"],
  forecast_mpp_outbound: ["outbound forecast mpp"],
  forecast_weekly_outbound: ["outbound forecast weekly"],
  outbound_before_cancel: ["outbound qty requested (before cancel)"],
  outbound_requested: ["outbound qty requested"],
  outbound_rts: ["outbound qty rts"],
  outbound_actual_hub: ["outbound qty actual (hub received)"],
  outbound_unfulfilled: ["outbound qty unfulfilled"],
  outbound_capacity: ["max so / outbound capacity"],
  outbound_utilization: ["outbound utilization rate", "outbound utilization rate %"],
  picker_productivity: ["picker actual productivity collective"],
  picker_productivity_target: ["picker productivity target"],
  budget_picker_mandays: ["budget mandays picker"],
  actual_picker_mandays: ["actual mandays picker"],
  budget_packer_mandays: ["budget mandays packer"],
  actual_packer_mandays: ["actual mandays packer"],
  budget_loader_mandays: ["budget mandays loader"],
  actual_loader_mandays: ["actual mandays loader"],
  pick_to_pf: ["pick to pf %", "pick to pf"],
  pick_to_lost: ["pick to lost %"],
  pick_to_bad: ["pick to bad %"],
  fulfillment_rate: ["fulfillment rate % warehouse"],
  fulfillment_excl_troubleshoot: ["fulfillment rate % warehouse exclude troubleshoot"],
  attendance_all: ["all attendance %"],
  churn_all: ["all churn rate %"],
  schedule_accuracy: ["schedule accuracy %"],
  putaway_productivity_attainment: ["productivity collective achievement %"],
  replenishment_completion: ["replenishment completion rate %"],
  replenishment_task: ["replenishment task (by qty)"],
  replenishment_done: ["replenishment done (by qty)"],
  relabel_productivity: ["relable actual productivity collective"],
  relabel_target: ["relable productivity target"],
  relabel_qty: ["relable qty"],
  relabel_share: ["relable % to inbound"],
  replenishment_sla: ["sla replenishment"],
  on_time_dispatch: ["on time dispatch %", "on time dipatch % (by route)"],
  on_time_arrival: ["on time arrival % (by route)"],
  scheduled_mandays: ["scheduled mandays"],
  budget_mandays: ["budgeted mandays", "budget mandays"],
  available_slot_mp: ["current available slot mp"],
  budget_slot_mp: ["budgeted slot mp"],
  mp_fulfill_accuracy: ["mp fulfill accuracy %"],
  truck_delivered_rate: ["truck delivered %"],
  actual_truck_delivered: ["actual truck delivered"],
  truck_dedicated: ["truck dedicated"],
  total_wastage: ["total wastage wh", "total wastage (wh + ib to bad)"],
  wastage_handling: ["wastage due to handling", "wastage handling wh"],
  // Source-computed equivalents, used only to reconcile the engine's own
  // derivations against the spreadsheet. Never rendered as a KPI.
  source_inbound_forecast_accuracy: ["inbound forecast weekly accuracy %"],
  source_outbound_forecast_accuracy: ["outbound forecast weekly accuracy %"],

  // ---------------------------------------------------------------------------
  // Station layer. These columns describe what happens at a physical workstation
  // — the PO desk, the GRN lane, the QC gate, the putaway aisle, the pickface,
  // the packing bench, the loading dock. They feed lib/analysis/floor-operations
  // only. None of them is promoted into KPI_KEYS: adding a metric to the health
  // basket changes what every historical score meant, which is a decision for
  // the metric owner, not a side effect of mapping a column.
  // ---------------------------------------------------------------------------

  // Inbound: PO desk and the GRN lane.
  po_adjustment: ["po adjustment"],
  checker_otif: ["otif %"],
  checker_on_time: ["on time"],
  checker_late: ["late"],
  checker_productivity_individual: ["productivity avg invidual checker inbound"],
  checker_attainment_source: ["productivity collective achievement %"],
  relabel_actual_mandays: ["actual mandays relable"],
  relabel_budget_mandays: ["budget mandays relable"],

  // Inventory: putaway aisle, cycle count, recovery queue, pickface refill.
  putaway_capacity: ["max putaway capacity"],
  putaway_suggestion_accuracy: ["putaway suggestion accuracy %"],
  putaway_sla: ["sla putaway achievement"],
  // BIT reports putaway output under a different column name than PGS/SRG/STR,
  // and PGS/SRG report BOTH with different values. They are kept apart rather
  // than merged: averaging two disagreeing definitions of the same thing would
  // produce a number that matches neither.
  putaway_productivity_collective: ["putaway actual productivity collective"],
  replenishment_actual_mandays: ["actual mandays replenishment"],
  replenishment_budget_mandays: ["budget mandays replenishment"],
  replenishment_productivity: ["replenishment actual productivity collective", "replenishment productivity"],
  replenishment_productivity_target: ["replenishment productivity target"],
  troubleshoot_so_contribution: ["contribution to so fr %"],
  ldp_stock_share: ["ldp vs. inventory stock %", "ldp vs inventory stock %"],
  lbh_value: ["lbh (by value)"],
  lost_to_found: ["lost fo found"],
  badstock_qty: ["badstock qty (actual)"],
  badstock_sla: ["sla bad stock"],
  wastage_expired: ["wastage due to expired"],
  wastage_inbound_to_bad: ["wastage due to inbound to bad"],
  wastage_others: ["wastage due to others"],

  // Outbound: wave desk, picking, packing bench, staging, loading dock.
  seuic_adoption: ["adoption rate seuic %"],
  so_ratio: ["so ratio"],
  outbound_productivity_overall: ["productivity overall %"],
  picker_attainment_source: ["picker productivity collective %"],
  picker_productivity_user: ["picker productivity by user login"],
  picker_regular_productivity: ["picker regular productivity"],
  packer_productivity: ["packer actual productivity collective"],
  packer_productivity_target: ["packer productivity target"],
  packer_attainment_source: ["packer productivity collective %"],
  packer_productivity_user: ["packer productivity by user login"],
  loader_productivity: ["loader actual productivity collective"],
  loader_productivity_target: ["loader productivity target"],
  loader_attainment_source: ["loader productivity collective %"],
  // "bu User Login" is the source's spelling, not a typo on this side.
  loader_productivity_user: ["loader productivity bu user login"],
  inbound_to_bad_rate: ["inbound to bad %"],
  inbound_to_bad_qty: ["inbound to bad (by qty)"],
  inbound_to_lost_rate: ["inbound to lost %"],
  inbound_to_lost_qty: ["inbound to lost (by qty)"],
  pick_to_lost_qty: ["pick to lost (by qty)"],
  pick_to_bad_qty: ["pick to bad (by qty)"],
  staging_lost_rate: ["koli hilang di staging %"],
  staging_lost_qty: ["koli hilang di staging (by qty)"],
  fulfillment_hub: ["fulfillment rate % inbound hub"],

  // Dispatch: departure cut-off and the hub handover.
  on_time_depart: ["on time depart % (by route)"],
  on_time_arrival_driver: ["on time arrival driver % (by vehicle)"],
  on_time_arrival_hub1: ["on time arrival hub-1 % (by route)"],
  on_time_arrival_hub2: ["on time arrival hub-2 % (by route)"],
  on_time_arrival_hub3: ["on time arrival hub-3 % (by route)"],
  truck_on_call: ["on call"],

  // Personalia, split by the function that actually feels the shortfall.
  attendance_inbound: ["inbound attendance %"],
  attendance_inventory: ["inventory attendance %"],
  attendance_outbound: ["outbound attendance %"],
  churn_inbound: ["inbound churn rate %"],
  churn_inventory: ["inventory churn rate %"],
  churn_outbound: ["outbound churn rate %"],
  mandays_daily_worker: ["mandays daily worker"],
};

const normalizedCache = new Map<string, string>();
const aliasCache = new Map<string, Set<string>>();
let reverseAliases: Map<string, string[]> | null = null;

export function normalizeLabel(value: string): string {
  const cached = normalizedCache.get(value);
  if (cached !== undefined) return cached;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalizedCache.size < 5_000) normalizedCache.set(value, normalized);
  return normalized;
}

export function metricMatches(metric: string, key: string): boolean {
  const normalized = normalizeLabel(metric);
  let aliases = aliasCache.get(key);
  if (!aliases) {
    aliases = new Set((METRIC_ALIASES[key] ?? []).map(normalizeLabel));
    aliasCache.set(key, aliases);
  }
  return aliases.has(normalized);
}

export function metricAliasKeys(metric: string): string[] {
  if (!reverseAliases) {
    reverseAliases = new Map();
    for (const [key, aliases] of Object.entries(METRIC_ALIASES)) {
      for (const alias of aliases) {
        const normalized = normalizeLabel(alias);
        reverseAliases.set(normalized, [...(reverseAliases.get(normalized) ?? []), key]);
      }
    }
  }
  return reverseAliases.get(normalizeLabel(metric)) ?? [];
}
