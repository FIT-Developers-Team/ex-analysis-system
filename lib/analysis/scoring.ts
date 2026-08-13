/**
 * Shared scoring primitives.
 *
 * Kept in their own module so the KPI engine and the floor-station layer score
 * a shortfall the same way. Two copies of this curve would drift, and a station
 * that graded itself more kindly than the KPI above it is exactly the kind of
 * disagreement this dashboard exists to prevent.
 */

export const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

/**
 * Converts a shortfall into a 0–100 score without ever reaching the floor.
 *
 * A linear penalty hits exactly 0 once the gap passes 100/slope, so a
 * chronically underperforming metric freezes at zero and stops carrying
 * information. This halves the score every `50 / slope` points of shortfall:
 * it matches a linear calibration where it matters (still 50 at the same gap)
 * and keeps ranking things that are all far below target.
 */
export function decayScore(gap: number, slope: number): number {
  if (gap <= 0) return 100;
  return clamp(100 * Math.pow(0.5, (gap * slope) / 50));
}
