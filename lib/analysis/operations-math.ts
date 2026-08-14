/**
 * Operations mathematics.
 *
 * Everything here answers a question a supervisor actually asks, and every
 * function is computable from columns the sheet already has. Nothing estimates
 * a quantity the source does not carry — there is no lead time, no queue depth,
 * and no WIP in this data, so there is no Little's Law here either.
 *
 * The four questions this module exists to answer:
 *
 *   1. "Is the plan wrong in one direction, or just noisy?"     → forecastQuality
 *   2. "Is today unusual, or is this just how the process runs?" → controlChart
 *   3. "Can I trust a percentage built on eleven observations?"  → wilsonInterval
 *   4. "How many people does this workload actually need?"       → requiredMandays
 */

export interface ForecastQuality {
  /** Days with a usable forecast/actual pair. */
  sampleSize: number;
  /** Mean percentage error. Positive = actual above plan. The systematic part. */
  biasPct: number | null;
  /** Mean absolute percentage error. Total error, direction ignored. */
  mapePct: number | null;
  /** MAPE minus |bias|: the part that cannot be fixed by shifting the plan. */
  dispersionPct: number | null;
  /**
   * `bias` when most of the error points one way — move the plan.
   * `dispersion` when the error is large but cancels out — the plan level is
   * roughly right and the answer is flex capacity, not a new number.
   */
  dominant: "bias" | "dispersion" | "balanced" | "insufficient";
  direction: "over" | "under" | "none";
}

export interface Variability {
  sampleSize: number;
  mean: number | null;
  standardDeviation: number | null;
  /** sd / mean. Above ~0.3 a single staffing number cannot serve every day. */
  coefficientOfVariation: number | null;
  min: number | null;
  max: number | null;
  /** Highest day divided by the median day. What the peak actually demands. */
  peakToMedian: number | null;
}

export interface ControlChart {
  key: string;
  label: string;
  unit: "percent" | "qty" | "ratio";
  sampleSize: number;
  mean: number | null;
  /** Estimated from the mean moving range, not the standard deviation: a shift
   *  in the process inflates sd and hides itself. MR is immune to that. */
  sigma: number | null;
  upperLimit: number | null;
  lowerLimit: number | null;
  points: Array<{ date: string; value: number | null; outOfControl: boolean }>;
  /** `stable` means the variation is the process's own. It does not mean good. */
  state: "stable" | "special_cause" | "shifted" | "insufficient";
  /** The specific rule that fired, in plain language. */
  finding: string;
}

export interface ProportionEstimate {
  key: string;
  label: string;
  successes: number;
  trials: number;
  pointPct: number | null;
  lowPct: number | null;
  highPct: number | null;
  /** Half-width of the interval. Wide means the number cannot settle an argument. */
  marginPct: number | null;
  /** True when the whole interval sits below the target — a real shortfall. */
  belowTarget: boolean | null;
  reliable: boolean;
}

export interface ManpowerRequirement {
  key: string;
  role: string;
  workload: number | null;
  /** Units per manday, taken from the source's own target column. */
  targetRate: number | null;
  requiredMandays: number | null;
  actualMandays: number | null;
  budgetMandays: number | null;
  /** required − actual. Positive means the workload needed more people than it got. */
  gapMandays: number | null;
  verdict: "short" | "matched" | "surplus" | "insufficient";
}

export interface YieldStage {
  key: string;
  label: string;
  value: number | null;
  /** Conversion from the previous stage. */
  stepYieldPct: number | null;
  /** Conversion from the first stage. Where the chain really stands. */
  cumulativeYieldPct: number | null;
  lossQty: number | null;
  /** Share of total chain loss that happens at this step. */
  lossSharePct: number | null;
}

const mean = (values: number[]) => values.reduce((sum, item) => sum + item, 0) / values.length;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Splits forecast error into the part a better number fixes and the part only
 * flex capacity fixes.
 *
 * A single accuracy percentage cannot tell these apart. 80% accuracy that is
 * always 20% under is a planning problem with a one-line fix. 80% accuracy that
 * swings ±40% around a correct average is a capacity problem, and rewriting the
 * forecast will not touch it.
 */
export function forecastQuality(pairs: Array<{ forecast: number; actual: number }>): ForecastQuality {
  const usable = pairs.filter((pair) => Number.isFinite(pair.forecast) && Number.isFinite(pair.actual) && pair.forecast > 0);
  if (usable.length < 5) {
    return { sampleSize: usable.length, biasPct: null, mapePct: null, dispersionPct: null, dominant: "insufficient", direction: "none" };
  }
  const errors = usable.map((pair) => ((pair.actual - pair.forecast) / pair.forecast) * 100);
  const biasPct = mean(errors);
  const mapePct = mean(errors.map(Math.abs));
  const dispersionPct = Math.max(0, mapePct - Math.abs(biasPct));
  const dominant = Math.abs(biasPct) >= mapePct * 0.6 ? "bias" : Math.abs(biasPct) <= mapePct * 0.3 ? "dispersion" : "balanced";
  return {
    sampleSize: usable.length,
    biasPct,
    mapePct,
    dispersionPct,
    dominant,
    direction: Math.abs(biasPct) < 2 ? "none" : biasPct > 0 ? "over" : "under",
  };
}

/** Day-to-day spread. A high CV is why one staffing number cannot fit every day. */
export function variability(values: number[]): Variability {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length < 3) return { sampleSize: usable.length, mean: null, standardDeviation: null, coefficientOfVariation: null, min: null, max: null, peakToMedian: null };
  const average = mean(usable);
  const variance = usable.reduce((sum, value) => sum + (value - average) ** 2, 0) / (usable.length - 1);
  const standardDeviation = Math.sqrt(variance);
  const middle = median(usable);
  return {
    sampleSize: usable.length,
    mean: average,
    standardDeviation,
    coefficientOfVariation: average === 0 ? null : standardDeviation / Math.abs(average),
    min: Math.min(...usable),
    max: Math.max(...usable),
    peakToMedian: middle === 0 ? null : Math.max(...usable) / middle,
  };
}

/**
 * Individuals control chart (XmR).
 *
 * The point is to stop treating every bad day as an event. Sigma comes from the
 * mean moving range divided by 1.128 — the standard unbiasing constant for a
 * two-point range — rather than from the standard deviation, because a genuine
 * process shift inflates sd and thereby widens the limits enough to hide itself.
 *
 * Two Nelson rules are applied: a point outside three sigma (rule 1) and eight
 * consecutive points on one side of the mean (rule 2, a shift). Eight is the
 * conventional run length; at that point the odds of it being chance are under
 * one in a hundred.
 */
export function controlChart(
  key: string,
  label: string,
  unit: ControlChart["unit"],
  series: Array<{ date: string; value: number | null }>,
): ControlChart {
  const observed = series.filter((point): point is { date: string; value: number } => point.value !== null && Number.isFinite(point.value));
  if (observed.length < 12) {
    return {
      key, label, unit,
      sampleSize: observed.length,
      mean: null, sigma: null, upperLimit: null, lowerLimit: null,
      points: series.map((point) => ({ ...point, outOfControl: false })),
      state: "insufficient",
      finding: `Baru ${observed.length} hari terbaca. Batas kendali perlu minimal 12 hari.`,
    };
  }
  const values = observed.map((point) => point.value);
  const centre = mean(values);
  const movingRanges = values.slice(1).map((value, index) => Math.abs(value - values[index]));
  const sigma = mean(movingRanges) / 1.128;
  const upperLimit = centre + 3 * sigma;
  const lowerLimit = centre - 3 * sigma;

  const outside = observed.filter((point) => point.value > upperLimit || point.value < lowerLimit);
  let run = 0;
  let runSide = 0;
  let shifted = false;
  for (const point of observed) {
    const side = Math.sign(point.value - centre);
    if (side === 0) { run = 0; runSide = 0; continue; }
    run = side === runSide ? run + 1 : 1;
    runSide = side;
    if (run >= 8) shifted = true;
  }

  const state: ControlChart["state"] = outside.length ? "special_cause" : shifted ? "shifted" : "stable";
  const finding = outside.length
    ? `${outside.length} hari di luar batas kendali (${outside.slice(0, 3).map((point) => point.date.slice(5)).join(", ")}). Ada penyebab khusus—telusuri harinya, jangan ubah prosesnya.`
    : shifted
      ? "Delapan hari berturut-turut di satu sisi rata-rata. Prosesnya bergeser, bukan sekadar naik-turun harian."
      : "Naik-turun harian masih dalam batas prosesnya sendiri. Mengejar satu hari jelek tidak akan mengubah rata-rata.";

  const flagged = new Set(outside.map((point) => point.date));
  return {
    key, label, unit,
    sampleSize: observed.length,
    mean: centre,
    sigma,
    upperLimit,
    lowerLimit,
    points: series.map((point) => ({ ...point, outOfControl: point.value !== null && flagged.has(point.date) })),
    state,
    finding,
  };
}

/**
 * Wilson score interval for a proportion.
 *
 * Used wherever a percentage rests on a countable denominator. Vendor OTIF at
 * 86% reads as a firm fact until you notice it is 90 on-time out of 103 — the
 * interval is roughly ±7 points, which is wide enough that "86% vs 95% target"
 * is a real gap but "86% vs 89% last week" is not a movement.
 *
 * Wilson rather than the normal approximation because the latter misbehaves
 * badly near 0 and 1, which is exactly where punctuality metrics live.
 */
export function wilsonInterval(
  key: string,
  label: string,
  successes: number,
  trials: number,
  targetPct: number | null = null,
  z = 1.96,
): ProportionEstimate {
  if (!Number.isFinite(successes) || !Number.isFinite(trials) || trials <= 0 || successes < 0) {
    return { key, label, successes: 0, trials: 0, pointPct: null, lowPct: null, highPct: null, marginPct: null, belowTarget: null, reliable: false };
  }
  const bounded = Math.min(successes, trials);
  const p = bounded / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = (p + (z * z) / (2 * trials)) / denominator;
  const half = (z / denominator) * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  const lowPct = Math.max(0, centre - half) * 100;
  const highPct = Math.min(1, centre + half) * 100;
  return {
    key,
    label,
    successes: bounded,
    trials,
    pointPct: p * 100,
    lowPct,
    highPct,
    marginPct: ((highPct - lowPct) / 2),
    belowTarget: targetPct === null ? null : highPct < targetPct,
    reliable: trials >= 30,
  };
}

/**
 * How many mandays the workload needed, using the source's own target rate.
 *
 * required = workload ÷ target units per manday. This is not a new standard —
 * it is the definition of the productivity target column read backwards, which
 * is why it can be stated without inventing anything.
 */
export function requiredMandays(
  key: string,
  role: string,
  workload: number | null,
  targetRate: number | null,
  actualMandays: number | null,
  budgetMandays: number | null,
): ManpowerRequirement {
  const required = workload !== null && targetRate !== null && targetRate > 0 ? workload / targetRate : null;
  const gap = required !== null && actualMandays !== null ? required - actualMandays : null;
  const verdict: ManpowerRequirement["verdict"] = gap === null || required === null || required === 0
    ? "insufficient"
    : gap / required > 0.05 ? "short"
      : gap / required < -0.05 ? "surplus" : "matched";
  return { key, role, workload, targetRate, requiredMandays: required, actualMandays, budgetMandays, gapMandays: gap, verdict };
}

/**
 * Turns a funnel into a yield chain: step conversion, cumulative yield, and each
 * step's share of total loss — so the biggest leak is identified by size rather
 * than by whichever step happens to be discussed first.
 */
export function yieldChain(stages: Array<{ key: string; label: string; value: number | null }>): YieldStage[] {
  const origin = stages[0]?.value ?? null;
  const totalLoss = stages.reduce((sum, stage, index) => {
    if (index === 0) return sum;
    const previous = stages[index - 1].value;
    if (previous === null || stage.value === null) return sum;
    return sum + Math.max(0, previous - stage.value);
  }, 0);
  return stages.map((stage, index) => {
    const previous = index > 0 ? stages[index - 1].value : null;
    const lossQty = previous !== null && stage.value !== null ? Math.max(0, previous - stage.value) : null;
    return {
      key: stage.key,
      label: stage.label,
      value: stage.value,
      stepYieldPct: previous !== null && previous > 0 && stage.value !== null ? (stage.value / previous) * 100 : null,
      cumulativeYieldPct: origin !== null && origin > 0 && stage.value !== null ? (stage.value / origin) * 100 : null,
      lossQty,
      lossSharePct: lossQty !== null && totalLoss > 0 ? (lossQty / totalLoss) * 100 : null,
    };
  });
}
