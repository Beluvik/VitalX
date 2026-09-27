/**
 * Unit conversion. The app stores metric internally; these helpers convert
 * only at the display boundary.
 *
 * Protein targets are expressed per kg in the spec (1.6 g/kg). When the user
 * works in pounds we must convert the DENSITY too, not just the number,
 * otherwise "1.6x bodyweight" silently becomes 2.8x when typed as pounds.
 */

import { UnitSystem } from '../types';

export const KG_PER_LB = 0.45359237;
export const CM_PER_INCH = 2.54;

export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const inchToCm = (inches: number) => inches * CM_PER_INCH;
export const cmToInch = (cm: number) => cm / CM_PER_INCH;

export const kgToG = (kg: number) => kg * 1000;
export const gToKg = (g: number) => g / 1000;

export function isImperial(u: UnitSystem) {
  return u === 'imperial';
}

/** Convert a metric body weight into the user's display unit. */
export function displayWeight(kg: number, u: UnitSystem): number {
  return isImperial(u) ? round1(kgToLb(kg)) : round1(kg);
}

/** Convert a user-entered body weight into metric for storage. */
export function inputWeightToKg(value: number, u: UnitSystem): number {
  return isImperial(u) ? lbToKg(value) : value;
}

export function displayHeight(cm: number, u: UnitSystem): string {
  if (!isImperial(u)) return `${round1(cm)} cm`;
  const totalInches = cmToInch(cm);
  const ft = Math.floor(totalInches / 12);
  const inch = Math.round(totalInches - ft * 12);
  return inch === 12 ? `${ft + 1}'0"` : `${ft}'${inch}"`;
}

/**
 * Protein density in the user's unit.
 * 1.6 g/kg == 0.726 g/lb. The spec's "1.6x bodyweight" must mean the same
 * thing to a pound user, so we convert the density rather than the result.
 */
export function proteinDensityPerUnit(gPerKg: number, u: UnitSystem): number {
  return isImperial(u) ? gPerKg * KG_PER_LB : gPerKg;
}

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function roundTo(n: number, step: number) {
  return Math.round(n / step) * step;
}
