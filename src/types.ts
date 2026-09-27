/**
 * VitalX domain types.
 *
 * Unit convention: all persistence and all formulas use METRIC internally
 * (kg, cm, kcal). The user's chosen display unit is applied only at render
 * time via lib/units.ts. Never store a user-entered lb value as kg.
 */

export type Sex = 'male' | 'female';

/** kg or lb. Display-only. */
export type UnitSystem = 'metric' | 'imperial';

import type { Equipment, Level } from './types/training';

export type { Equipment, Level };

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

export type BmrFormula = 'mifflin' | 'katch';

/**
 * Goal a) lose weight + gain muscle  -> recomposition
 * Goal b) gain weight + muscle       -> bulk
 * Goal c) maintain weight + gain muscle -> recomp at maintenance
 * Goal d) lose body fat only         -> pure cut
 */
export type Goal = 'cut_recomp' | 'bulk' | 'maintain_recomp' | 'cut_fat_only';

export type CutTier = 'slow' | 'moderate' | 'aggressive';
export type BulkTier = 'slight' | 'moderate' | 'excess';

export type PlanGoal = Goal;

export type Profile = {
  age: number;
  sex: Sex;
  weightKg: number;
  heightCm: number;
  /** Optional. Enables Katch-McArdle. */
  bodyFatPct?: number;
  activityLevel: ActivityLevel;
  unitSystem: UnitSystem;
  bmrFormula: BmrFormula;
  goal: Goal;
  /** Which intensity tier is active for the chosen goal. */
  cutTier?: CutTier;
  bulkTier?: BulkTier;
  sessionsPerWeek: number;
  averageSessionMinutes: number;
  /**
   * Training inputs for plan generation. Optional so profiles saved before the
   * training module still load; the plan builder falls back to defaults.
   */
  level?: Level;
  equipment?: Equipment[];
  createdAt: number;
};

/** A single computed result of the nutrition engine. */
export interface NutritionPlan {
  bmr: number;
  bmrFormulaUsed: BmrFormula;
  tdee: number;
  adjustment: number;
  targetCalories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fatPercent: number;
  carbPercent: number;
  proteinPercent: number;
  /** Simple vs complex split of carbohydrate grams. */
  carbs: {
    simpleG: number;
    complexG: number;
    fibreG: number;
  };
  warnings: NutritionWarning[];
  /** Only present for recomposition goals. Heavily caveated estimate. */
  recomposition?: RecompositionProjection;
  computedAt: number;
}

export type WarningCode =
  | 'protein_over_2x'
  | 'protein_share_high'
  | 'below_safe_floor'
  | 'excess_surplus'
  | 'carbs_very_low'
  | 'recomp_unrealistic';

export interface NutritionWarning {
  code: WarningCode;
  severity: 'info' | 'warning' | 'danger';
  title: string;
  body: string;
}

export interface RecompositionProjection {
  weeklyDeficitKcal: number;
  fatChangeKgPerWeek: number;
  leanChangeKgPerWeek: number;
  /** plain-language honesty line about whether this is realistic for them */
  caveat: string;
}

export type OverloadBand = 'strong' | 'moderate' | 'minimal';

/** Per-session burn bands, kcal. Midpoint used when a band is selected. */
export const OVERLOAD_BANDS: Record<OverloadBand, { min: number; max: number; label: string }> = {
  strong: { min: 350, max: 450, label: 'Strong progressive overload' },
  moderate: { min: 300, max: 350, label: 'A little progressive overload' },
  minimal: { min: 250, max: 250, label: 'Full workout, no overload' },
};

export interface SleepEntry {
  date: string; // YYYY-MM-DD
  bedTime: string; // HH:MM
  wakeTime: string; // HH:MM
  /** User overrides the estimate. */
  remMinutesSelfReported?: number;
  restingHr?: number;
  hrvMs?: number;
}

export interface SleepScore {
  /** Kept so tomorrow's consistency check has something to compare against. */
  bedTime: string;
  wakeTime: string;
  rawDurationH: number;
  /** Raw duration minus the 30 min time-to-fall-asleep allowance. */
  adjustedDurationH: number;
  durationScore: number; // 0-10
  interruptions: number;
  interruptionScore: number; // 4-10
  remMinutes: number;
  remScore: number; // 0-10
  /** Self-report flag so the UI can say where the number came from. */
  remIsEstimated: boolean;
  recoveryScore: number; // 0-10 blended
  consistencyBonus: number; // 0-3
}

export interface FoodItem {
  id: string;
  name: string;
  /** kcal per 100 g */
  kcalPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  fibrePer100: number;
  /** Sugar within carbs, used for the simple/complex split. */
  sugarPer100: number;
  category: FoodCategory;
  /** Indian foods get flagged so they surface first for this audience. */
  region?: 'indian' | 'global';
  /** key into assets/food-icons, or undefined -> category placeholder */
  iconKey?: string;
  verified?: boolean;
}

export type FoodCategory =
  | 'protein'
  | 'carb'
  | 'fat'
  | 'vegetable'
  | 'fruit'
  | 'dairy'
  | 'supplement'
  | 'drink'
  | 'other';

export interface LoggedFood {
  id: string;
  foodId: string;
  name: string;
  grams: number;
  protein: number;
  carbs: number;
  fat: number;
  kcal: number;
  loggedAt: number;
}

export interface DayLog {
  date: string; // YYYY-MM-DD
  foods: LoggedFood[];
  steps: number;
  /** gym burn for the day, kcal */
  gymBurn: number;
  sleep?: SleepScore;
  trainingSessionId?: string;
}

export interface Badges {
  unlocked: Record<string, number>; // badgeId -> timestamp unlocked
}
