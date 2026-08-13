import { describe, expect, it } from "vitest";
import { buildMetricSemantic, OPERATION_GLOSSARY, OPERATING_RULES } from "@/lib/analysis/operations-ontology";

describe("operations ontology", () => {
  it("classifies decision-ready mapped metrics with an operational caveat", () => {
    const metric = buildMetricSemantic({
      division: "Outbound",
      role: "Out-All",
      metric: "Fulfillment Rate % Warehouse",
      detail: "RTS per request setelah cancel",
      activeCoverage: 1,
    });
    expect(metric.readiness).toBe("decision_ready");
    expect(metric.decisionRole).toBe("outcome");
    expect(metric.caveat).toMatch(/setelah cancel/i);
    expect(metric.relatedMetrics).toContain("Downstream completion");
  });

  it("does not promote planning outputs or unconfirmed definitions", () => {
    const schedule = buildMetricSemantic({ division: "Personalia", role: "All", metric: "Schedule Accuracy %", detail: "Scheduled / Budgeted Mandays", activeCoverage: 1 });
    const recommendation = buildMetricSemantic({ division: "Personalia", role: "All", metric: "MP Recommendation All Division", detail: "Rekomendasi MP", activeCoverage: 1 });
    const planogram = buildMetricSemantic({ division: "Inventory", role: "Inv-All", metric: "Planogram Accuracy", detail: "TBC", activeCoverage: 0 });
    expect([schedule, recommendation, planogram].every((item) => item.readiness === "unconfirmed")).toBe(true);
    expect(recommendation.definitionStatus).toBe("inferred");
    expect(recommendation.requiredContext).toContain("Formula rekomendasi");
  });

  it("separates documented meaning, safe inference, and unresolved ambiguity", () => {
    const zonalCapacity = buildMetricSemantic({ division: "Inventory", role: "Inventory", metric: "Inventory Capacity Max (By Qty) Chiller", detail: "", activeCoverage: 0 });
    const ambiguousRatio = buildMetricSemantic({ division: "Outbound", role: "Oub-All", metric: "SO Ratio", detail: "", activeCoverage: 1 });
    const documentedOtif = buildMetricSemantic({ division: "Inbound", role: "Inb-Checker", metric: "OTIF %", detail: "", activeCoverage: 1 });
    expect(zonalCapacity.definitionStatus).toBe("inferred");
    expect(zonalCapacity.definition).toMatch(/chiller/i);
    expect(ambiguousRatio.definitionStatus).toBe("unresolved");
    expect(ambiguousRatio.readiness).toBe("unconfirmed");
    expect(documentedOtif.definitionStatus).toBe("documented");
  });

  it("captures the core trade-off rules from the operations glossary", () => {
    expect(OPERATION_GLOSSARY).toHaveLength(233);
    expect(OPERATION_GLOSSARY.some((item) => item.metric === "OTIF %" && `${item.details} ${item.explanation}`.includes("vendor"))).toBe(true);
    expect(OPERATION_GLOSSARY.some((item) => item.metric === "Contribution to SO FR %")).toBe(true);
    expect(OPERATING_RULES.map((item) => item.id)).toEqual(expect.arrayContaining([
      "forecast-to-labor",
      "saving-with-service",
      "sla-productivity-tension",
      "cancel-before-after",
      "inventory-loss-chain",
      "relabel-scope",
    ]));
  });
});
