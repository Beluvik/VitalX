/**
 * Training domain types.
 *
 * Kept separate from types.ts because the training model is large enough to
 * deserve its own file, and it evolves on a different schedule to nutrition.
 *
 * Storage convention, same as the rest of the app: weights are ALWAYS kg here.
 * Display conversion happens at render only.
 */

import type { RecoveryAdvice } from '../lib/sleep';

export type MuscleGroup =
  | 'chest'
  | 'lats'
  | 'back'
  | 'traps'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'abs'
  | 'obliques';

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  lats: 'Lats',
  back: 'Back',
  traps: 'Traps',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  abs: 'Abs',
  obliques: 'Obliques',
};

/** Front-of-body and back-of-body groups, for the muscle diagram. */
export const MUSCLE_SIDE: Record<MuscleGroup, 'front' | 'back' | 'both'> = {
  chest: 'front',
  lats: 'back',
  back: 'back',
  traps: 'back',
  shoulders: 'both',
  biceps: 'front',
  triceps: 'back',
  forearms: 'front',
  quads: 'front',
  hamstrings: 'back',
  glutes: 'back',
  calves: 'back',
  abs: 'front',
  obliques: 'front',
};

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'kettlebell'
  | 'band'
  | 'cardio';

/** Training experience. Lives here rather than in lib/plan so types never
 *  depend on the logic layer. */
export type Level = 'beginner' | 'intermediate' | 'advanced';

export const LEVEL_LABELS: Record<Level, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbells',
  machine: 'Machines',
  cable: 'Cables',
  bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell',
  band: 'Bands',
  cardio: 'Cardio',
};

/** A muscle's share of an exercise's stimulus. Weights within one exercise sum to 1. */
export interface MuscleContribution {
  group: MuscleGroup;
  weight: number;
}

// ---------------------------------------------------------------------------
// Exercise library
// ---------------------------------------------------------------------------

export interface Exercise {
  id: string;
  name: string;
  equipment: Equipment;
  /** Compound movements are prioritised by the plan generator. */
  compound: boolean;
  muscles: MuscleContribution[];
  /** key into the machine illustration library */
  machineKey?: string;
  /**
   * Metabolic equivalent, used for cardio only. Strength work is scored by
   * progressive overload instead, where a MET value would be meaningless.
   */
  met?: number;
  isCustom: boolean;
  instructions?: string;
}

// ---------------------------------------------------------------------------
// Routine (a template)
// ---------------------------------------------------------------------------

export interface RoutineExercise {
  exerciseId: string;
  order: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  restSeconds: number;
  /**
   * Which day of a multi-day plan this belongs to, e.g. "Push".
   * Kept flat rather than nesting sessions, but a generated plan needs to know
   * which exercises go together, otherwise a 3-day plan reads as one long list.
   */
  sessionName?: string;
}

export interface Routine {
  id: string;
  name: string;
  exercises: RoutineExercise[];
  /** Day names for a split plan, in order. Absent for a single-session routine. */
  sessionNames?: string[];
  isBuiltIn: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Workout (a logged session)
// ---------------------------------------------------------------------------

export type PrKind = 'weight' | 'volume' | 'both';

export interface WorkoutSet {
  id: string;
  setNumber: number;
  /** kg, always. Convert for display. */
  weight: number;
  reps: number;
  rpe?: number;
  isWarmup: boolean;
  /**
   * Computed at the moment the set is completed, by comparing against every
   * prior set for that exercise. Deliberately NOT a batch job: the user has to
   * see "new PR" the instant they finish the set or the feedback is worthless.
   */
  isPr: boolean;
  prKind?: PrKind;
  completedAt: number;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  order: number;
  /** Exercises sharing a superset group number are performed back to back. */
  supersetGroup: number | null;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  routineId: string | null;
  name: string;
  startedAt: number;
  endedAt: number | null;
  notes: string;
  exercises: WorkoutExercise[];
  /**
   * Recorded when the session was trimmed or extended by recovery data.
   * Kept on the workout so the summary can explain a light session after the
   * fact, instead of the user wondering why it felt easy.
   */
  recovery?: RecoveryAdvice;
}

// ---------------------------------------------------------------------------
// Derived records
// ---------------------------------------------------------------------------

export interface PersonalBest {
  maxWeight: number;
  maxWeightReps: number;
  maxVolume: number;
  maxVolumeSet: { weight: number; reps: number };
  totalSets: number;
  lastPerformed: number;
  /** Highest weight ever used for this exercise, for pre-filling. */
  lastWeight: number;
  lastReps: number;
}

export interface MuscleSplitEntry {
  group: MuscleGroup;
  volume: number;
  percent: number;
}

export interface WorkoutSummary {
  durationMinutes: number;
  totalVolume: number;
  totalSets: number;
  workingSets: number;
  prs: { exerciseId: string; exerciseName: string; set: WorkoutSet }[];
  muscleSplit: MuscleSplitEntry[];
}
