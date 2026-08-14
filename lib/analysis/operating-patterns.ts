/**
 * Operating patterns.
 *
 * Five questions that only a long window can answer, and that the seven-day
 * cockpit therefore cannot. Each one came out of looking at the source rather
 * than out of a framework, and each one changes the recommendation rather than
 * decorating it:
 *
 *   1. Is cancellation a capacity wall or a decision?     → cancellationDriver
 *   2. Does the crew shrink when the volume does?         → labourElasticity
 *   3. Which weekday is structurally different?           → weekdayProfile
 *   4. What moved over months, not days?                  → longHorizonTrend
 *   5. Did an improvement actually reach its outcome?     → improvementWithoutEffect
 *
 * Everything is measured over no-operation-free days. The methods are simple on
 * purpose: a log-log slope and a banded mean can be checked by hand in a meeting,
 * and anything that cannot be checked by hand does not survive one.
 */

export interface DailyObservation {
  date: string;
  /** Day of week, 0 = Sunday. */
  weekday: number;
  demandBeforeCancel: number | null;
  demandAfterCancel: number | null;
  served: number | null;
  inbound: number | null;
  productivityPct: number | null;
  cancelPct: number | null;
  mandays: Partial<Record<string, number | null>>;
}

export interface CancellationDriver {
  available: boolean;
  correlation: number | null;
  sampleSize: number;
  /** Mean cancellation in the lowest, middle, and highest third of demand days. */
  lowBandPct: number | null;
  midBandPct: number | null;
  highBandPct: number | null;
  /** Difference between the busiest and quietest third. */
  spreadPct: number | null;
  verdict: "capacity" | "policy" | "mixed" | "insufficient";
  headline: string;
  reading: string;
  action: string;
}

export interface RoleElasticity {
  key: string;
  role: string;
  /** d(log mandays) / d(log volume). 1 = crew tracks volume, 0 = fixed crew. */
  elasticity: number | null;
  sampleSize: number;
  behaviour: "flexed" | "partial" | "fixed" | "insufficient";
  /** Attainment on the quietest third of days versus the busiest third. */
  quietAttainmentPct: number | null;
  busyAttainmentPct: number | null;
}

export interface LabourElasticity {
  available: boolean;
  roles: RoleElasticity[];
  headline: string;
  reading: string;
  action: string;
  /** Mandays that would not have been rostered on quiet days at a matched crew. */
  quietDayOvershootMandays: number | null;
}

export interface WeekdayCell {
  weekday: number;
  label: string;
  days: number;
  /** Demand as a percentage of the all-day average. */
  volumeIndexPct: number | null;
  productivityPct: number | null;
  cancelPct: number | null;
}

export interface WeekdayProfile {
  available: boolean;
  cells: WeekdayCell[];
  quietestLabel: string | null;
  busiestLabel: string | null;
  /** Busiest day's demand divided by the quietest day's. */
  peakToTroughRatio: number | null;
  headline: string;
  reading: string;
  action: string;
}

export interface HorizonTrend {
  key: string;
  label: string;
  unit: "percent" | "qty";
  earlyValue: number | null;
  lateValue: number | null;
  changePct: number | null;
  direction: "improved" | "declined" | "flat" | "insufficient";
  /** True when higher is better, so direction reads correctly. */
  higherIsBetter: boolean;
}

export interface EffectCheck {
  driverKey: string;
  driverLabel: string;
  driverChange: number;
  outcomeKey: string;
  outcomeLabel: string;
  outcomeChange: number;
  verdict: "delivered" | "stalled" | "unclear";
  reading: string;
}

export interface OperatingPatterns {
  windowDays: number;
  cancellation: CancellationDriver;
  labour: LabourElasticity;
  weekday: WeekdayProfile;
  trends: HorizonTrend[];
  effects: EffectCheck[];
}

const WEEKDAY_LABEL = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function pearson(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 10) return null;
  const meanX = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const meanY = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  const numerator = pairs.reduce((sum, pair) => sum + (pair[0] - meanX) * (pair[1] - meanY), 0);
  const dx = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair[0] - meanX) ** 2, 0));
  const dy = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair[1] - meanY) ** 2, 0));
  return dx === 0 || dy === 0 ? null : numerator / (dx * dy);
}

/** Ordinary least squares slope on log-log pairs, i.e. an elasticity. */
function logSlope(pairs: Array<[number, number]>): number | null {
  const usable = pairs.filter(([x, y]) => x > 0 && y > 0).map(([x, y]) => [Math.log(x), Math.log(y)] as [number, number]);
  if (usable.length < 20) return null;
  const meanX = usable.reduce((sum, pair) => sum + pair[0], 0) / usable.length;
  const meanY = usable.reduce((sum, pair) => sum + pair[1], 0) / usable.length;
  const variance = usable.reduce((sum, pair) => sum + (pair[0] - meanX) ** 2, 0);
  if (variance === 0) return null;
  return usable.reduce((sum, pair) => sum + (pair[0] - meanX) * (pair[1] - meanY), 0) / variance;
}

const pct = (value: number | null, digits = 1) => value === null ? "n/a" : `${value.toLocaleString("id-ID", { maximumFractionDigits: digits })}%`;

/**
 * Does cancellation rise with the size of the day?
 *
 * If it does, the warehouse is hitting a wall and the answer is capacity. If it
 * is flat across quiet and busy days alike, the wall is not what is driving it,
 * and the answer is to look at the decision. The same 9% cancellation rate means
 * opposite things in those two cases, and the dashboard was previously telling
 * every warehouse the same story about it.
 */
export function cancellationDriver(observations: DailyObservation[]): CancellationDriver {
  const usable = observations.filter((day): day is DailyObservation & { demandBeforeCancel: number; cancelPct: number } =>
    day.demandBeforeCancel !== null && day.demandBeforeCancel > 0 && day.cancelPct !== null);
  if (usable.length < 21) {
    return { available: false, correlation: null, sampleSize: usable.length, lowBandPct: null, midBandPct: null, highBandPct: null, spreadPct: null, verdict: "insufficient", headline: "Belum cukup hari untuk menguji", reading: `Baru ${usable.length} hari terbaca; uji ini perlu minimal 21 hari.`, action: "Lengkapi data harian sebelum menyimpulkan penyebab pembatalan." };
  }

  const correlation = pearson(usable.map((day) => [day.demandBeforeCancel, day.cancelPct]));
  const sorted = [...usable].sort((a, b) => a.demandBeforeCancel - b.demandBeforeCancel);
  const third = Math.floor(sorted.length / 3);
  const lowBandPct = mean(sorted.slice(0, third).map((day) => day.cancelPct));
  const midBandPct = mean(sorted.slice(third, third * 2).map((day) => day.cancelPct));
  const highBandPct = mean(sorted.slice(third * 2).map((day) => day.cancelPct));
  const spreadPct = lowBandPct !== null && highBandPct !== null ? highBandPct - lowBandPct : null;

  const strong = correlation !== null && correlation >= 0.45 && (spreadPct ?? 0) >= 3;
  const weak = correlation !== null && correlation < 0.25 && Math.abs(spreadPct ?? 0) < 3;
  const verdict: CancellationDriver["verdict"] = strong ? "capacity" : weak ? "policy" : "mixed";

  const headline = verdict === "capacity"
    ? "Pembatalan naik mengikuti besarnya hari — ini dinding kapasitas"
    : verdict === "policy"
      ? "Pembatalan hampir sama di hari sepi dan hari ramai — bukan soal kapasitas"
      : "Pembatalan sebagian mengikuti beban, sebagian tidak";

  const reading = `Hari tersepi dibatalkan ${pct(lowBandPct)}, hari tersibuk ${pct(highBandPct)} (r=${correlation === null ? "n/a" : correlation.toFixed(2)}, ${usable.length} hari).`;

  const action = verdict === "capacity"
    ? "Perbaikan yang benar adalah menambah kemampuan di peran penahan atau meratakan beban antar hari. Menyuruh berhenti membatalkan tanpa itu hanya memindahkan kegagalan ke tidak terlayani."
    : verdict === "policy"
      ? "Kapasitas tidak menjelaskan angka ini. Telusuri alasan pembatalan satu per satu: siapa yang menyetujui, jam berapa, dan atas dasar apa."
      : "Pisahkan dulu hari yang benar-benar penuh dari hari yang tidak. Keduanya butuh tindakan berbeda dan sekarang tercampur dalam satu angka.";

  return { available: true, correlation, sampleSize: usable.length, lowBandPct, midBandPct, highBandPct, spreadPct, verdict, headline, reading, action };
}

/**
 * Does the crew shrink when the volume does?
 *
 * Measured as the slope of log mandays against log volume. A slope near 1 means
 * the roster tracks the work; near 0 means a fixed crew regardless of the day.
 * A fixed crew is a legitimate choice, but it has a consequence the dashboard
 * kept reporting as a performance problem: on a quiet day the same people
 * produce less per head, and no amount of coaching changes that.
 */
export function labourElasticity(
  observations: DailyObservation[],
  roles: Array<{ key: string; role: string; volumeKey: "served" | "inbound" }>,
): LabourElasticity {
  const results: RoleElasticity[] = roles.map(({ key, role, volumeKey }) => {
    const pairs: Array<[number, number]> = [];
    for (const day of observations) {
      const volume = day[volumeKey];
      const mandays = day.mandays[key];
      if (volume !== null && volume !== undefined && volume > 0 && mandays !== null && mandays !== undefined && mandays > 0) pairs.push([volume, mandays]);
    }
    const elasticity = logSlope(pairs);
    const behaviour: RoleElasticity["behaviour"] = elasticity === null ? "insufficient"
      : elasticity >= 0.6 ? "flexed" : elasticity >= 0.25 ? "partial" : "fixed";

    const withAttainment = observations.filter((day) => day.productivityPct !== null && day[volumeKey] !== null && (day[volumeKey] ?? 0) > 0);
    const sorted = [...withAttainment].sort((a, b) => (a[volumeKey] ?? 0) - (b[volumeKey] ?? 0));
    const third = Math.floor(sorted.length / 3);
    return {
      key,
      role,
      elasticity,
      sampleSize: pairs.length,
      behaviour,
      quietAttainmentPct: third ? mean(sorted.slice(0, third).map((day) => day.productivityPct as number)) : null,
      busyAttainmentPct: third ? mean(sorted.slice(third * 2).map((day) => day.productivityPct as number)) : null,
    };
  });

  const measured = results.filter((role) => role.elasticity !== null);
  if (!measured.length) {
    return { available: false, roles: results, headline: "Elastisitas tenaga belum terbaca", reading: "Manday harian atau volume belum lengkap.", action: "Lengkapi manday per peran sebelum menilai pola roster.", quietDayOvershootMandays: null };
  }

  const fixed = measured.filter((role) => role.behaviour === "fixed");
  const reference = measured.find((role) => role.key === "picker") ?? measured[0];
  const gap = reference.quietAttainmentPct !== null && reference.busyAttainmentPct !== null
    ? reference.busyAttainmentPct - reference.quietAttainmentPct
    : null;

  // How many mandays a matched crew would have saved on quiet days: the quiet-day
  // crew minus what the quiet-day volume needed at the busy-day rate per manday.
  const quietDays = [...observations].filter((day) => day.served !== null && day.served > 0 && (day.mandays.picker ?? 0) > 0).sort((a, b) => (a.served ?? 0) - (b.served ?? 0));
  const thirdCount = Math.floor(quietDays.length / 3);
  let overshoot: number | null = null;
  if (thirdCount >= 5) {
    const quiet = quietDays.slice(0, thirdCount);
    const busy = quietDays.slice(thirdCount * 2);
    const busyRate = mean(busy.map((day) => (day.served as number) / (day.mandays.picker as number)));
    if (busyRate && busyRate > 0) {
      overshoot = quiet.reduce((sum, day) => sum + Math.max(0, (day.mandays.picker as number) - (day.served as number) / busyRate), 0);
    }
  }

  const headline = fixed.length >= 2
    ? `Kru ${fixed.map((role) => role.role.toLowerCase()).join(" dan ")} nyaris tetap, berapa pun volumenya`
    : measured.every((role) => role.behaviour === "flexed")
      ? "Jumlah orang sudah mengikuti besarnya hari"
      : "Sebagian peran mengikuti volume, sebagian tetap";

  const reading = `${measured.map((role) => `${role.role} ${role.elasticity === null ? "n/a" : role.elasticity.toFixed(2)}`).join(", ")}. Nilai 1 berarti orang ikut naik-turun bersama volume, 0 berarti kru tetap.${gap === null ? "" : ` Pada hari sepi pencapaian ${reference.role.toLowerCase()} ${pct(reference.quietAttainmentPct)} melawan ${pct(reference.busyAttainmentPct)} di hari ramai — selisih ${pct(gap)}.`}`;

  const action = fixed.length
    ? `Selisih pencapaian antara hari sepi dan hari ramai itu dilusi, bukan kinerja. Yang perlu diubah adalah bentuk roster: turunkan kru pada hari sepi${overshoot ? ` (sekitar ${overshoot.toLocaleString("id-ID", { maximumFractionDigits: 0 })} manday sepanjang rentang ini)` : ""} atau pindahkan orangnya ke fungsi lain, bukan menegur produktivitasnya.`
    : "Bentuk roster sudah mengikuti beban. Perbedaan pencapaian yang tersisa layak ditelusuri sebagai proses, bukan sebagai jumlah orang.";

  return { available: true, roles: results, headline, reading, action, quietDayOvershootMandays: overshoot };
}

/** Which weekday is structurally different, in volume, output, and cancellation. */
export function weekdayProfile(observations: DailyObservation[]): WeekdayProfile {
  const usable = observations.filter((day) => day.demandBeforeCancel !== null && day.demandBeforeCancel > 0);
  if (usable.length < 21) {
    return { available: false, cells: [], quietestLabel: null, busiestLabel: null, peakToTroughRatio: null, headline: "Belum cukup hari untuk pola mingguan", reading: `Baru ${usable.length} hari terbaca.`, action: "Kumpulkan minimal tiga minggu penuh." };
  }
  const overall = mean(usable.map((day) => day.demandBeforeCancel as number)) ?? 0;
  const cells: WeekdayCell[] = WEEKDAY_LABEL.map((label, weekday) => {
    const days = usable.filter((day) => day.weekday === weekday);
    const volume = mean(days.map((day) => day.demandBeforeCancel as number));
    return {
      weekday,
      label,
      days: days.length,
      volumeIndexPct: volume === null || overall === 0 ? null : (volume / overall) * 100,
      productivityPct: mean(days.flatMap((day) => day.productivityPct === null ? [] : [day.productivityPct])),
      cancelPct: mean(days.flatMap((day) => day.cancelPct === null ? [] : [day.cancelPct])),
    };
  });

  const ranked = cells.filter((cell) => cell.volumeIndexPct !== null).sort((a, b) => (a.volumeIndexPct ?? 0) - (b.volumeIndexPct ?? 0));
  const quietest = ranked[0] ?? null;
  const busiest = ranked.at(-1) ?? null;
  const ratio = quietest?.volumeIndexPct && busiest?.volumeIndexPct ? busiest.volumeIndexPct / quietest.volumeIndexPct : null;

  const headline = quietest && busiest
    ? `${busiest.label} membawa ${pct((busiest.volumeIndexPct ?? 0) - 100, 0)} lebih banyak dari rata-rata, ${quietest.label} ${pct((quietest.volumeIndexPct ?? 0) - 100, 0)}`
    : "Pola mingguan belum terbaca";
  const reading = quietest
    ? `Pada ${quietest.label} pencapaian rata-rata ${pct(quietest.productivityPct)} dan pembatalan ${pct(quietest.cancelPct)}; pada ${busiest?.label} ${pct(busiest?.productivityPct ?? null)} dan ${pct(busiest?.cancelPct ?? null)}.`
    : "";
  const action = ratio && ratio > 1.15
    ? `Beban ${busiest?.label} ${ratio.toFixed(2)}× beban ${quietest?.label}. Satu angka roster untuk semua hari pasti salah dua kali: kelebihan orang di ${quietest?.label}, kekurangan di ${busiest?.label}.`
    : "Beban antar hari relatif rata; roster tunggal masih masuk akal.";

  return { available: true, cells, quietestLabel: quietest?.label ?? null, busiestLabel: busiest?.label ?? null, peakToTroughRatio: ratio, headline, reading, action };
}

/**
 * What moved over months rather than days.
 *
 * The cockpit reads a week at a time and therefore cannot see an eight-month
 * improvement or an eight-month slide. Compared as the mean of the first third
 * of the window against the last third, which is robust to a single odd week at
 * either end.
 */
export function longHorizonTrend(
  series: Array<{ key: string; label: string; unit: "percent" | "qty"; higherIsBetter: boolean; values: Array<number | null> }>,
): HorizonTrend[] {
  return series.map((item) => {
    const usable = item.values.filter((value): value is number => value !== null && Number.isFinite(value));
    if (usable.length < 21) {
      return { key: item.key, label: item.label, unit: item.unit, earlyValue: null, lateValue: null, changePct: null, direction: "insufficient", higherIsBetter: item.higherIsBetter };
    }
    const third = Math.floor(usable.length / 3);
    const earlyValue = mean(usable.slice(0, third));
    const lateValue = mean(usable.slice(-third));
    const changePct = earlyValue !== null && lateValue !== null && earlyValue !== 0 ? ((lateValue - earlyValue) / Math.abs(earlyValue)) * 100 : null;
    const moved = changePct !== null && Math.abs(changePct) >= 5;
    const better = changePct !== null && (changePct > 0) === item.higherIsBetter;
    return {
      key: item.key,
      label: item.label,
      unit: item.unit,
      earlyValue,
      lateValue,
      changePct,
      direction: !moved ? "flat" : better ? "improved" : "declined",
      higherIsBetter: item.higherIsBetter,
    };
  });
}

/**
 * Did an improvement reach the thing it was supposed to improve?
 *
 * At PGS, location accuracy went from 57% to 98% and device adoption from 51%
 * to 100% across eight months while picker output per manday stayed where it
 * was. Both programmes hit their own targets. Neither showed up downstream, and
 * that is worth knowing before the next one is funded.
 */
export function improvementWithoutEffect(
  trends: HorizonTrend[],
  pairs: Array<{ driverKey: string; outcomeKey: string }>,
): EffectCheck[] {
  const byKey = new Map(trends.map((trend) => [trend.key, trend]));
  return pairs.flatMap(({ driverKey, outcomeKey }) => {
    const driver = byKey.get(driverKey);
    const outcome = byKey.get(outcomeKey);
    if (!driver || !outcome || driver.changePct === null || outcome.changePct === null) return [];
    if (driver.direction !== "improved" || Math.abs(driver.changePct) < 10) return [];

    const outcomeMoved = Math.abs(outcome.changePct) >= 5 && outcome.direction === "improved";
    const verdict: EffectCheck["verdict"] = outcomeMoved ? "delivered" : Math.abs(outcome.changePct) < 5 ? "stalled" : "unclear";
    const reading = verdict === "delivered"
      ? `${driver.label} naik ${pct(driver.changePct, 0)} dan ${outcome.label.toLowerCase()} ikut naik ${pct(outcome.changePct, 0)}. Perbaikannya sampai ke tujuan.`
      : verdict === "stalled"
        ? `${driver.label} naik ${pct(driver.changePct, 0)} sepanjang rentang panjang, tetapi ${outcome.label.toLowerCase()} praktis tidak bergerak (${pct(outcome.changePct, 0)}). Programnya berhasil pada ukurannya sendiri dan belum terlihat di hilir.`
        : `${driver.label} naik ${pct(driver.changePct, 0)} sementara ${outcome.label.toLowerCase()} justru bergerak ${pct(outcome.changePct, 0)}. Hubungan yang diasumsikan perlu diperiksa ulang.`;
    return [{ driverKey, driverLabel: driver.label, driverChange: driver.changePct, outcomeKey, outcomeLabel: outcome.label, outcomeChange: outcome.changePct, verdict, reading }];
  });
}
