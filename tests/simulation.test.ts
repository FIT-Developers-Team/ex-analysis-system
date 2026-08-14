import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/analysis/simulation";
import type { SimulationBaselineInput, SimulationInputs } from "@/lib/types";

const NONE: SimulationInputs = { demandChange: 0, cancelChange: 0, processGain: 0, pickerMandaysChange: 0, packerMandaysChange: 0, loaderMandaysChange: 0 };

/** 100k demand, 10% cancelled, 90k of the 90k remaining actually shipped.
 *  Picker is the tightest role at 100k throughput; loader has the most slack. */
function baseline(overrides: Partial<SimulationBaselineInput> = {}): SimulationBaselineInput {
  return {
    demandBeforeCancel: 100_000,
    cancelPct: 10,
    served: 88_200,
    outboundCapacity: 200_000,
    roles: [
      { key: "picker", role: "Picker", mandays: 50, targetRate: 2_000, actualRate: 2_000 },
      { key: "packer", role: "Packer", mandays: 40, targetRate: 3_000, actualRate: 3_000 },
      { key: "loader", role: "Loader", mandays: 30, targetRate: 4_500, actualRate: 4_500 },
    ],
    ...overrides,
  };
}

describe("scenario model", () => {
  it("reproduces the observed window when nothing is changed", () => {
    // The whole model is worthless if its own starting point disagrees with the
    // data it was built from.
    const result = runSimulation(baseline(), NONE);
    expect(result.available).toBe(true);
    expect(result.baseline.served).toBeCloseTo(88_200, 0);
    expect(result.baseline.demandBeforeCancel).toBe(100_000);
    expect(result.baseline.demandAfterCancel).toBeCloseTo(90_000, 0);
    expect(result.scenario.served).toBeCloseTo(result.baseline.served, 0);
    expect(result.deltas.every((item) => item.direction === "flat")).toBe(true);
  });

  it("names the slowest role as the constraint, not the busiest", () => {
    // Demand after cancel is 90k. Picker throughput is 100k, packer 120k, loader
    // 135k — nobody binds, so demand is the constraint.
    const slack = runSimulation(baseline(), NONE);
    expect(slack.scenario.constraint).toBe("demand");

    // Push demand to 130k and picker becomes the wall at 100k.
    const stretched = runSimulation(baseline(), { ...NONE, demandChange: 30 });
    expect(stretched.scenario.constraint).toBe("labour");
    expect(stretched.scenario.roles.find((role) => role.binding)?.key).toBe("picker");
    expect(stretched.scenario.constraintLabel).toContain("Picker");
  });

  it("gains nothing from staffing a role that was never the constraint", () => {
    const stretched = { ...NONE, demandChange: 30 };
    const withLoaders = runSimulation(baseline(), { ...stretched, loaderMandaysChange: 40 });
    const without = runSimulation(baseline(), stretched);
    expect(withLoaders.scenario.served).toBeCloseTo(without.scenario.served, 0);

    // Staffing the role that *is* the constraint does move it.
    const withPickers = runSimulation(baseline(), { ...stretched, pickerMandaysChange: 40 });
    expect(withPickers.scenario.served).toBeGreaterThan(without.scenario.served);
  });

  it("shows cancellation flattering fulfillment while demand fill falls", () => {
    const worse = runSimulation(baseline(), { ...NONE, cancelChange: 20 });
    const fulfillment = worse.deltas.find((item) => item.key === "fulfillment");
    const demandFill = worse.deltas.find((item) => item.key === "demand_fill");
    // Fulfillment is measured after cancellation, so removing orders cannot hurt
    // it; demand fill is measured before, so it takes the whole hit.
    expect((fulfillment?.change ?? 0)).toBeGreaterThanOrEqual(0);
    expect(demandFill?.direction).toBe("worse");
    expect(worse.scenario.unserved).toBeGreaterThan(worse.baseline.unserved);
  });

  it("only recovers cancelled demand when there is capacity to absorb it", () => {
    const absorbed = runSimulation(baseline(), { ...NONE, cancelChange: -10 });
    expect(absorbed.scenario.served).toBeGreaterThan(absorbed.baseline.served);
    expect(absorbed.notes.join(" ")).toContain("mengembalikan");

    // Same move on a warehouse whose picker line is already the wall: the units
    // move from "cancelled" to "unserved" and nothing is actually gained.
    const tight = baseline({ roles: [
      { key: "picker", role: "Picker", mandays: 30, targetRate: 2_000, actualRate: 2_000 },
      { key: "packer", role: "Packer", mandays: 40, targetRate: 3_000, actualRate: 3_000 },
      { key: "loader", role: "Loader", mandays: 30, targetRate: 4_500, actualRate: 4_500 },
    ], served: 60_000 });
    const blocked = runSimulation(tight, { ...NONE, cancelChange: -10 });
    expect(blocked.scenario.served).toBeCloseTo(blocked.baseline.served, 0);
    expect(blocked.notes.join(" ")).toContain("belum mampu menyerapnya");
  });

  it("reports dilution when people are added to unchanged volume", () => {
    const diluted = runSimulation(baseline(), { ...NONE, pickerMandaysChange: 20 });
    const attainment = diluted.deltas.find((item) => item.key === "attainment");
    expect(attainment?.direction).toBe("worse");
    expect(diluted.scenario.served).toBeCloseTo(diluted.baseline.served, 0);
    expect(diluted.notes.join(" ")).toContain("dilusi");
  });

  it("keeps a process gain worthless while demand is the constraint", () => {
    const faster = runSimulation(baseline(), { ...NONE, processGain: 15 });
    expect(faster.scenario.served).toBeCloseTo(faster.baseline.served, 0);
    expect(faster.notes.join(" ")).toContain("hari puncak");

    // On a day where labour binds, the same gain is worth real units.
    const stretched = runSimulation(baseline(), { ...NONE, demandChange: 30, processGain: 15 });
    const plain = runSimulation(baseline(), { ...NONE, demandChange: 30 });
    expect(stretched.scenario.served).toBeGreaterThan(plain.scenario.served);
  });

  it("respects the physical capacity ceiling", () => {
    const capped = runSimulation(baseline({ outboundCapacity: 80_000 }), NONE);
    expect(capped.scenario.constraint).toBe("capacity");
    expect(capped.notes.join(" ")).toContain("Batas fisik");
  });

  it("never claims an execution yield above 100%", () => {
    // If the sheet says more shipped than the model's ceiling allows, the model
    // is wrong — it must not respond by inventing superhuman throughput.
    const result = runSimulation(baseline({ served: 500_000 }), NONE);
    expect(result.executionYieldPct).toBeLessThanOrEqual(100);
  });

  it("declines to model a window without target rates", () => {
    const result = runSimulation(baseline({ roles: [{ key: "picker", role: "Picker", mandays: 50, targetRate: null, actualRate: null }] }), NONE);
    expect(result.available).toBe(false);
    expect(result.unavailableReason).toContain("Target produktivitas");
  });

  it("projects capacity from the rate achieved, not the rate targeted", () => {
    // The bug this replaced: PGS packers beat their target by 5%, and a
    // target-rate model called packing the constraint on a day it was keeping up.
    const beatsTarget = baseline({
      served: 88_200,
      roles: [
        { key: "picker", role: "Picker", mandays: 50, targetRate: 2_000, actualRate: 2_400 },
        { key: "packer", role: "Packer", mandays: 40, targetRate: 3_000, actualRate: 3_200 },
        { key: "loader", role: "Loader", mandays: 30, targetRate: 4_500, actualRate: 4_500 },
      ],
    });
    const result = runSimulation(beatsTarget, NONE);
    // 50 × 2,400 = 120k, comfortably over the 90k it has to absorb.
    expect(result.scenario.constraint).toBe("demand");
    expect(result.scenario.roles.find((role) => role.key === "picker")?.throughput).toBeCloseTo(120_000, 0);
    // Attainment still measures against the target, so beating it reads as a win.
    expect(result.scenario.roles.find((role) => role.key === "picker")?.attainmentPct).toBeGreaterThan(80);
  });

  it("falls back to the target when a role has no achieved rate", () => {
    const noActual = baseline({ roles: [{ key: "picker", role: "Picker", mandays: 50, targetRate: 2_000, actualRate: null }] });
    const result = runSimulation(noActual, NONE);
    expect(result.available).toBe(true);
    expect(result.scenario.roles[0].ratePerManday).toBe(2_000);
  });

  it("states every assumption it makes", () => {
    const result = runSimulation(baseline(), NONE);
    expect(result.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(result.assumptions.join(" ")).toContain("laju yang benar-benar dicapai");
    expect(result.assumptions.join(" ")).toContain("rata-rata harian");
  });
});
