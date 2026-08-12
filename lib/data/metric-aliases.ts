export const METRIC_ALIASES: Record<string, string[]> = {
  forecast_mpp_inbound: ["forecast mpp inbound"],
  forecast_weekly_inbound: ["forecast weekly inbound"],
  actual_inbound: ["qty actual inbound"],
  incoming_inbound: ["qty incoming inbound"],
  inbound_utilization: ["inbound utilization"],
  inbound_capacity: ["max inbound capacity"],
  sla_checker_inbound: ["sla checker inbound achievement"],
  budget_checker_mandays: ["budget mandays checker inbound"],
  actual_checker_mandays: ["actual mandays checker inbound"],
  checker_productivity: ["checker inbound actual productivity collective"],
  checker_productivity_target: ["checker inbound productivity target"],
  forecast_mpp_putaway: ["forecast mpp putaway"],
  forecast_weekly_putaway: ["forecast weekly putaway"],
  putaway_actual: ["putaway actual"],
  putaway_done: ["putaway done"],
  putaway_utilization: ["putaway utilization"],
  putaway_productivity: ["putaway productivity"],
  putaway_productivity_target: ["putaway productivity target"],
  budget_putaway_mandays: ["budget mandays putaway"],
  actual_putaway_mandays: ["actual mandays putaway"],
  putaway_completion: ["putaway completion %"],
  inventory_actual: ["inventory actual ending (by qty)", "inventory actual max (by qty)"],
  inventory_capacity: ["inventory capacity max (by qty)"],
  inventory_forecast: ["inventory capacity forecast (by qty)"],
  inventory_utilization_max: ["inventory utilization actual (max.) vs max %", "utilization actual vs max %"],
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
  outbound_utilization: ["outbound utilization rate"],
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
