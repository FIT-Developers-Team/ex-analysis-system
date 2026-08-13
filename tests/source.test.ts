import { describe, expect, it } from "vitest";
import { __sourceTest } from "@/lib/data/source";

describe("data source controls", () => {
  it("retries only transient Google errors", () => {
    expect(__sourceTest.retryableStatus(408)).toBe(true);
    expect(__sourceTest.retryableStatus(429)).toBe(true);
    expect(__sourceTest.retryableStatus(503)).toBe(true);
    expect(__sourceTest.retryableStatus(401)).toBe(false);
    expect(__sourceTest.retryableStatus(404)).toBe(false);
  });

  it("maps batch ranges back to their tab name", () => {
    expect(__sourceTest.sheetNameFromRange("'Frozen - PGS'!A1:QZ400")).toBe("Frozen - PGS");
    expect(__sourceTest.sheetNameFromRange("Highlight!A1:D500")).toBe("Highlight");
  });

  it("bounds unsafe environment values", () => {
    expect(__sourceTest.positiveInteger("0", 30, 15, 300)).toBe(15);
    expect(__sourceTest.positiveInteger("9999", 30, 15, 300)).toBe(300);
    expect(__sourceTest.positiveInteger("bad", 30, 15, 300)).toBe(30);
  });

  it("builds a stable revision and counts cells for the sync contract", () => {
    const sheets = { "Frozen - PGS": [["A", 1], ["B", 2]], Highlight: [["x"]] };
    const first = __sourceTest.sourceStats(sheets);
    const second = __sourceTest.sourceStats({ Highlight: [["x"]], "Frozen - PGS": [["A", 1], ["B", 2]] });

    expect(first.cellsLoaded).toBe(5);
    expect(first.revision).toMatch(/^[a-f0-9]{12}$/);
    expect(second.revision).toBe(first.revision);
  });
});
