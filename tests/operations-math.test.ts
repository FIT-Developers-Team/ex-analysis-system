import { describe, expect, it } from "vitest";
import { controlChart, forecastQuality, requiredMandays, variability, wilsonInterval, yieldChain } from "@/lib/analysis/operations-math";

describe("forecast quality", () => {
  it("separates a plan that is wrong in one direction from one that is merely noisy", () => {
    // Always 20% under: the plan level is wrong and can be fixed by moving it.
    const systematic = forecastQuality(Array.from({ length: 14 }, () => ({ forecast: 100, actual: 80 })));
    expect(systematic.dominant).toBe("bias");
    expect(systematic.direction).toBe("under");
    expect(systematic.biasPct).toBeCloseTo(-20, 5);
    expect(systematic.dispersionPct).toBeCloseTo(0, 5);

    // Swings ±30% around a correct average: moving the plan changes nothing.
    const noisy = forecastQuality(Array.from({ length: 14 }, (_, index) => ({ forecast: 100, actual: index % 2 ? 130 : 70 })));
    expect(noisy.dominant).toBe("dispersion");
    expect(Math.abs(noisy.biasPct as number)).toBeLessThan(1);
    expect(noisy.mapePct).toBeCloseTo(30, 5);
  });

  it("refuses to judge a handful of days", () => {
    expect(forecastQuality([{ forecast: 100, actual: 80 }]).dominant).toBe("insufficient");
  });

  it("drops pairs with a zero forecast rather than dividing by them", () => {
    const output = forecastQuality([
      ...Array.from({ length: 6 }, () => ({ forecast: 100, actual: 110 })),
      { forecast: 0, actual: 50 },
    ]);
    expect(output.sampleSize).toBe(6);
    expect(output.biasPct).toBeCloseTo(10, 5);
  });
});

describe("variability", () => {
  it("reports spread relative to level, not in raw units", () => {
    const steady = variability([100, 102, 98, 101, 99]);
    const swinging = variability([40, 160, 55, 145, 60]);
    expect(steady.coefficientOfVariation as number).toBeLessThan(0.1);
    expect(swinging.coefficientOfVariation as number).toBeGreaterThan(0.4);
    expect(swinging.peakToMedian as number).toBeGreaterThan(steady.peakToMedian as number);
  });
});

describe("control chart", () => {
  const stable = Array.from({ length: 20 }, (_, index) => ({ date: `2026-06-${String(index + 1).padStart(2, "0")}`, value: 100 + (index % 3) - 1 }));

  it("calls ordinary variation ordinary", () => {
    const chart = controlChart("x", "Uji", "percent", stable);
    expect(chart.state).toBe("stable");
    expect(chart.points.every((point) => !point.outOfControl)).toBe(true);
    expect(chart.upperLimit as number).toBeGreaterThan(chart.mean as number);
  });

  it("flags the day that is genuinely different", () => {
    const withSpike = [...stable];
    withSpike[10] = { date: withSpike[10].date, value: 300 };
    const chart = controlChart("x", "Uji", "percent", withSpike);
    expect(chart.state).toBe("special_cause");
    expect(chart.points.filter((point) => point.outOfControl)).toHaveLength(1);
    expect(chart.finding).toContain("penyebab khusus");
  });

  it("detects a shift that never leaves the limits", () => {
    // Ten days at 100, then ten at 104 — no single point is extreme, but the
    // process has moved and a limits-only check would miss it entirely.
    const shift = Array.from({ length: 20 }, (_, index) => ({
      date: `2026-06-${String(index + 1).padStart(2, "0")}`,
      value: index < 10 ? 100 + (index % 2) : 104 + (index % 2),
    }));
    const chart = controlChart("x", "Uji", "percent", shift);
    expect(chart.state).toBe("shifted");
    expect(chart.finding).toContain("bergeser");
  });

  it("declines to draw limits from too few days", () => {
    const chart = controlChart("x", "Uji", "percent", stable.slice(0, 6));
    expect(chart.state).toBe("insufficient");
    expect(chart.mean).toBeNull();
  });

  it("ignores gaps instead of treating them as zero", () => {
    const withGaps = stable.map((point, index) => index % 5 === 0 ? { ...point, value: null } : point);
    const chart = controlChart("x", "Uji", "percent", withGaps);
    expect(chart.sampleSize).toBe(16);
    expect(chart.mean as number).toBeGreaterThan(90);
  });
});

describe("proportion confidence", () => {
  it("widens the interval when the denominator is small", () => {
    const small = wilsonInterval("a", "Kecil", 9, 10, 95);
    const large = wilsonInterval("b", "Besar", 900, 1000, 95);
    expect(small.marginPct as number).toBeGreaterThan(large.marginPct as number);
    expect(small.reliable).toBe(false);
    expect(large.reliable).toBe(true);
  });

  it("only calls a shortfall real when the whole interval clears the target", () => {
    // 9/10 is 90% against a 95% target, but the interval reaches past 99%.
    expect(wilsonInterval("a", "Kecil", 9, 10, 95).belowTarget).toBe(false);
    expect(wilsonInterval("b", "Besar", 860, 1000, 95).belowTarget).toBe(true);
  });

  it("stays inside 0-100 at the extremes", () => {
    const perfect = wilsonInterval("a", "Sempurna", 20, 20);
    const none = wilsonInterval("b", "Nol", 0, 20);
    expect(perfect.highPct).toBeLessThanOrEqual(100);
    expect(none.lowPct).toBeGreaterThanOrEqual(0);
  });

  it("returns nothing usable when there is no denominator", () => {
    expect(wilsonInterval("a", "Kosong", 0, 0).pointPct).toBeNull();
  });
});

describe("manpower requirement", () => {
  it("reads the source's own target backwards to size the work", () => {
    const short = requiredMandays("picker", "Picker", 24_000, 2_000, 10, 12);
    expect(short.requiredMandays).toBe(12);
    expect(short.gapMandays).toBe(2);
    expect(short.verdict).toBe("short");

    const surplus = requiredMandays("picker", "Picker", 16_000, 2_000, 10, 12);
    expect(surplus.verdict).toBe("surplus");

    const matched = requiredMandays("picker", "Picker", 20_200, 2_000, 10, 12);
    expect(matched.verdict).toBe("matched");
  });

  it("says nothing when the target rate is missing", () => {
    expect(requiredMandays("picker", "Picker", 24_000, null, 10, 12).verdict).toBe("insufficient");
    expect(requiredMandays("picker", "Picker", 24_000, 0, 10, 12).requiredMandays).toBeNull();
  });
});

describe("yield chain", () => {
  it("reports cumulative yield and ranks the leaks by size", () => {
    const chain = yieldChain([
      { key: "plan", label: "Rencana", value: 1_000 },
      { key: "demand", label: "Permintaan", value: 900 },
      { key: "served", label: "Dilayani", value: 500 },
      { key: "hub", label: "Hub", value: 490 },
    ]);
    expect(chain[3].cumulativeYieldPct).toBeCloseTo(49, 5);
    expect(chain[2].stepYieldPct).toBeCloseTo(55.56, 1);
    // 400 of the 510 total loss happens at one step: that is where to start.
    expect(chain[2].lossSharePct).toBeCloseTo(78.43, 1);
    expect(chain[0].stepYieldPct).toBeNull();
  });

  it("leaves gaps null instead of inventing a conversion", () => {
    const chain = yieldChain([
      { key: "plan", label: "Rencana", value: 1_000 },
      { key: "demand", label: "Permintaan", value: null },
      { key: "served", label: "Dilayani", value: 500 },
    ]);
    expect(chain[1].stepYieldPct).toBeNull();
    expect(chain[2].stepYieldPct).toBeNull();
    expect(chain[2].cumulativeYieldPct).toBeCloseTo(50, 5);
  });
});
