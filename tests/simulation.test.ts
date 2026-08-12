import { describe, expect, it } from "vitest";
import { runSimulation } from "@/lib/analysis/simulation";

const baseline = { productivityAttainment: 90, sla: 96, fulfillment: 98, utilization: 75, mandaysGap: 0 };

describe("runSimulation", () => {
  it("shows productivity dilution when mandays rise without volume", () => {
    const result = runSimulation(baseline, { forecastChange: 0, attendanceChange: 10, cancelChange: 0, processGain: 0 });
    expect(result.productivityChange).toBeLessThan(0);
    expect(result.slaChange).toBeGreaterThan(0);
  });

  it("recognizes headroom for cancel reduction", () => {
    const result = runSimulation(baseline, { forecastChange: 0, attendanceChange: 0, cancelChange: -5, processGain: 3 });
    expect(result.notes.some((note) => note.includes("Pengurangan cancel"))).toBe(true);
  });
});
