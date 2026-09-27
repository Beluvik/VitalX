/**
 * Energy expenditure: gym burn and steps.
 *
 * Note the layering. computeNutritionPlan() already produces a TDEE using the
 * standard activity multiplier, which folds training frequency into the
 * baseline. This module exists to (a) show the user what today actually
 * looked like, and (b) let the plan refine itself once real data is flowing.
 *
 * Overload bands come straight from the spec:
 *   strong  -> 350-450 kcal per session
 *   moderate-> 300-350
 *   minimal -> 250+  (full workout completed, no overload)
 *
 * The band is the primary signal. Duration refines it. That ordering matters:
 * two 60-minute sessions can differ hugely in output, and duration alone
 * cannot tell them apart.
 */

import { OverloadBand, OVERLOAD_BANDS } from '../types';

/** Midpoint of the band's range. */
export function bandMidpoint(band: OverloadBand): number {
  const b = OVERLOAD_BANDS[band];
  return (b.min + b.max) / 2;
}

/**
 * Refine a band midpoint by how long the session actually ran.
 * Short sessions scale down, long ones up, but the band stays the dominant
 * term so a punishing 45 minutes is not scored like a casual 90.
 */
export function sessionBurn(band: OverloadBand, durationMinutes: number): number {
  const base = bandMidpoint(band);
  if (durationMinutes <= 0) return 0;

  // 60 minutes is the reference point. +/- 20% at the extremes, clamped.
  const durationFactor = clamp(durationMinutes / 60, 0.5, 1.5) ** 0.5;
  return Math.round(base * durationFactor);
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Step calories. The common linear approximation:
 * kcal ~= steps * 0.0005 * bodyweightKg
 * For a 70 kg person that is ~350 kcal at 10,000 steps.
 */
export function stepBurn(steps: number, weightKg: number): number {
  return Math.round(steps * 0.0005 * weightKg);
}

/**
 * Rough 12,000-step reference for a person, used to express progress as a
 * percentage rather than an absolute number that looks alarming out of context.
 */
export const REFERENCE_DAILY_STEPS = 10000;

export function stepProgress(steps: number): number {
  return Math.round((steps / REFERENCE_DAILY_STEPS) * 100);
}

/** Total burn for a day: planned baseline plus tracked activity. */
export function dayBurn(tdee: number, gymBurnKcal: number, steps: number, weightKg: number) {
  const stepsKcal = stepBurn(steps, weightKg);
  return {
    stepsKcal,
    gymKcal: gymBurnKcal,
    tracked: stepsKcal + gymBurnKcal,
    total: Math.round(tdee + stepsKcal + gymBurnKcal),
  };
}

/**
 * Energy balance for a day, using the maintenance goal's in-equals-out rule.
 * Positive means a surplus, negative means a deficit.
 */
export function energyBalance(targetCalories: number, consumed: number, burned: number) {
  const delta = burned - consumed;
  return {
    delta,
    state: delta > 50 ? ('surplus' as const) : delta < -50 ? ('deficit' as const) : ('balanced' as const),
  };
}
