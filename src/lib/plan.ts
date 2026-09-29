/**
 * Workout plan generator.
 *
 * This is the feature the hackathon submission leads on: "generates a
 * personalized workout plan based on fitness level, available equipment, and
 * time".
 *
 * Design: templates declare SLOTS (a muscle group plus a preference-ordered
 * list of exercise ids), never concrete exercises. The generator then picks
 * the best exercise per slot that the user actually owns equipment for. That
 * way a person with a single pair of dumbbells and a squat rack still gets a
 * sensible plan instead of a dead template full of cable machines.
 */

import { Equipment, Exercise, Level, MuscleGroup, RoutineExercise } from '../types/training';
import { EXERCISE_BY_ID, exercisesForEquipment } from '../data/exercises';
import { RecoveryAdvice } from './sleep';
import { Goal } from '../types';

export type { Level };

export interface PlanInput {
  goal: Goal;
  level: Level;
  daysPerWeek: number;
  equipment: Equipment[];
  sessionMinutes: number;
  /** Muscles the user wants to prioritise. */
  focus?: MuscleGroup[];
}

export type SessionName =
  | 'Upper A'
  | 'Lower A'
  | 'Upper B'
  | 'Lower B'
  | 'Full Body A'
  | 'Full Body B'
  | 'Full Body C'
  | 'Push'
  | 'Pull'
  | 'Legs';

interface Slot {
  muscle: MuscleGroup;
  /** Exercise ids, best first. The first one the user can perform wins. */
  prefer: string[];
  sets: number;
  repsMin: number;
  repsMax: number;
  restSeconds: number;
  /**
   * Compound slots are the backbone. If nothing is available the slot is
   * dropped; that is what makes the plan adapt to equipment.
   */
  compound?: boolean;
}

const COMPOUND_REST = 150;
const ISOLATION_REST = 90;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const UPPER: Slot[] = [
  { muscle: 'chest', prefer: ['bench-press', 'machine-chest-press', 'flat-db-press', 'incline-db-press', 'push-up'], sets: 3, repsMin: 5, repsMax: 8, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'back', prefer: ['barbell-row', 'pendlay-row', 'seated-cable-row', 't-bar-row', 'db-row'], sets: 3, repsMin: 5, repsMax: 8, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'shoulders', prefer: ['overhead-press', 'db-shoulder-press', 'machine-chest-press'], sets: 3, repsMin: 6, repsMax: 10, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'lats', prefer: ['lat-pulldown', 'pull-up', 'chin-up', 'seated-cable-row'], sets: 3, repsMin: 6, repsMax: 10, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'biceps', prefer: ['barbell-curl', 'db-curl', 'preacher-curl', 'incline-db-curl'], sets: 2, repsMin: 10, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'triceps', prefer: ['triceps-pushdown', 'rope-pushdown', 'skull-crusher', 'overhead-triceps-ext'], sets: 2, repsMin: 8, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'chest', prefer: ['cable-fly', 'pec-deck', 'incline-db-press'], sets: 2, repsMin: 12, repsMax: 15, restSeconds: ISOLATION_REST },
  { muscle: 'shoulders', prefer: ['lateral-raise', 'cable-lateral-raise'], sets: 3, repsMin: 12, repsMax: 15, restSeconds: ISOLATION_REST },
  { muscle: 'back', prefer: ['face-pull', 'rear-delt-fly'], sets: 2, repsMin: 15, repsMax: 20, restSeconds: ISOLATION_REST },
];

const LOWER: Slot[] = [
  { muscle: 'quads', prefer: ['back-squat', 'hack-squat', 'leg-press', 'goblet-squat', 'front-squat'], sets: 3, repsMin: 5, repsMax: 8, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'hamstrings', prefer: ['romanian-deadlift', 'deadlift', 'sumo-deadlift', 'seated-leg-curl'], sets: 3, repsMin: 8, repsMax: 10, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'quads', prefer: ['leg-press', 'leg-extension', 'hack-squat'], sets: 2, repsMin: 10, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'glutes', prefer: ['hip-thrust', 'glute-bridge', 'bulgarian-split-squat'], sets: 2, repsMin: 10, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'hamstrings', prefer: ['lying-leg-curl', 'seated-leg-curl', 'nordic-curl'], sets: 2, repsMin: 10, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'calves', prefer: ['calf-raise', 'seated-calf-raise'], sets: 3, repsMin: 12, repsMax: 15, restSeconds: ISOLATION_REST },
  { muscle: 'abs', prefer: ['cable-crunch', 'plank', 'ab-wheel', 'dead-bug'], sets: 2, repsMin: 12, repsMax: 20, restSeconds: ISOLATION_REST },
];

const FULL_BODY: Slot[] = [
  { muscle: 'quads', prefer: ['back-squat', 'goblet-squat', 'leg-press', 'hack-squat'], sets: 3, repsMin: 5, repsMax: 8, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'back', prefer: ['barbell-row', 'pendlay-row', 'seated-cable-row', 'db-row'], sets: 3, repsMin: 6, repsMax: 10, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'chest', prefer: ['bench-press', 'machine-chest-press', 'flat-db-press', 'push-up'], sets: 2, repsMin: 8, repsMax: 12, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'lats', prefer: ['lat-pulldown', 'pull-up', 'chin-up'], sets: 2, repsMin: 8, repsMax: 12, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'quads', prefer: ['leg-press', 'leg-extension', 'bulgarian-split-squat'], sets: 2, repsMin: 10, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'biceps', prefer: ['db-curl', 'barbell-curl', 'preacher-curl'], sets: 2, repsMin: 10, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'triceps', prefer: ['triceps-pushdown', 'rope-pushdown', 'overhead-triceps-ext'], sets: 2, repsMin: 8, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'abs', prefer: ['cable-crunch', 'plank', 'dead-bug'], sets: 2, repsMin: 12, repsMax: 20, restSeconds: ISOLATION_REST },
];

const PUSH: Slot[] = [
  { muscle: 'chest', prefer: ['bench-press', 'machine-chest-press', 'flat-db-press', 'incline-db-press', 'push-up'], sets: 3, repsMin: 5, repsMax: 8, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'shoulders', prefer: ['overhead-press', 'db-shoulder-press'], sets: 3, repsMin: 6, repsMax: 10, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'chest', prefer: ['incline-db-press', 'machine-chest-press', 'push-up', 'dip'], sets: 3, repsMin: 8, repsMax: 12, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'shoulders', prefer: ['lateral-raise', 'cable-lateral-raise'], sets: 3, repsMin: 12, repsMax: 15, restSeconds: ISOLATION_REST },
  { muscle: 'chest', prefer: ['cable-fly', 'pec-deck'], sets: 2, repsMin: 12, repsMax: 15, restSeconds: ISOLATION_REST },
  { muscle: 'triceps', prefer: ['triceps-pushdown', 'rope-pushdown', 'skull-crusher', 'overhead-triceps-ext'], sets: 3, repsMin: 8, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'shoulders', prefer: ['face-pull', 'rear-delt-fly'], sets: 2, repsMin: 15, repsMax: 20, restSeconds: ISOLATION_REST },
];

const PULL: Slot[] = [
  { muscle: 'back', prefer: ['barbell-row', 'pendlay-row', 'seated-cable-row', 'db-row'], sets: 3, repsMin: 5, repsMax: 8, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'lats', prefer: ['lat-pulldown', 'pull-up', 'chin-up', 'seated-cable-row'], sets: 3, repsMin: 6, repsMax: 10, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'back', prefer: ['seated-cable-row', 't-bar-row', 'straight-arm-pulldown'], sets: 3, repsMin: 8, repsMax: 12, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'biceps', prefer: ['barbell-curl', 'db-curl', 'incline-db-curl', 'preacher-curl'], sets: 3, repsMin: 8, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'back', prefer: ['face-pull', 'straight-arm-pulldown', 'rear-delt-fly'], sets: 2, repsMin: 12, repsMax: 15, restSeconds: ISOLATION_REST },
  { muscle: 'forearms', prefer: ['reverse-curl', 'db-curl'], sets: 2, repsMin: 12, repsMax: 15, restSeconds: ISOLATION_REST },
];

const LEGS: Slot[] = [
  { muscle: 'quads', prefer: ['back-squat', 'hack-squat', 'leg-press', 'goblet-squat', 'front-squat'], sets: 4, repsMin: 5, repsMax: 8, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'hamstrings', prefer: ['romanian-deadlift', 'deadlift', 'sumo-deadlift'], sets: 3, repsMin: 8, repsMax: 10, restSeconds: COMPOUND_REST, compound: true },
  { muscle: 'quads', prefer: ['leg-press', 'leg-extension', 'hack-squat'], sets: 3, repsMin: 10, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'glutes', prefer: ['hip-thrust', 'glute-bridge', 'bulgarian-split-squat'], sets: 3, repsMin: 10, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'hamstrings', prefer: ['lying-leg-curl', 'seated-leg-curl', 'nordic-curl'], sets: 2, repsMin: 10, repsMax: 12, restSeconds: ISOLATION_REST },
  { muscle: 'calves', prefer: ['calf-raise', 'seated-calf-raise'], sets: 4, repsMin: 12, repsMax: 15, restSeconds: ISOLATION_REST },
  { muscle: 'abs', prefer: ['cable-crunch', 'plank', 'ab-wheel'], sets: 2, repsMin: 12, repsMax: 20, restSeconds: ISOLATION_REST },
];

/** How the week splits, by available days. */
export function splitFor(days: number): SessionName[] {
  switch (days) {
    case 1:
      return ['Full Body A'];
    case 2:
      return ['Upper A', 'Lower A'];
    case 3:
      return ['Full Body A', 'Full Body B', 'Full Body C'];
    case 4:
      return ['Upper A', 'Lower A', 'Upper B', 'Lower B'];
    case 5:
      return ['Push', 'Pull', 'Legs', 'Push', 'Pull'];
    case 6:
      return ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs'];
    default:
      return ['Full Body A', 'Full Body B', 'Full Body C', 'Full Body A', 'Full Body B', 'Full Body C', 'Full Body A'];
  }
}

function templateFor(name: SessionName): Slot[] {
  if (name.startsWith('Upper')) return UPPER;
  if (name.startsWith('Lower')) return LOWER;
  if (name === 'Push') return PUSH;
  if (name === 'Pull') return PULL;
  if (name === 'Legs') return LEGS;
  return FULL_BODY;
}

// ---------------------------------------------------------------------------
// Time budgeting
// ---------------------------------------------------------------------------

/** Roughly 45 seconds under the bar per working set, plus rest. */
const SECONDS_PER_SET = 45;
const WARMUP_RESERVE = 0.85; // leave 15% of the session for warm-up and notes

function slotSeconds(s: RoutineExercise): number {
  return s.targetSets * (SECONDS_PER_SET + s.restSeconds);
}

export function estimateDurationSeconds(exercises: RoutineExercise[]): number {
  return exercises.reduce((a, s) => a + slotSeconds(s), 0);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** First exercise in the preference list the user has the equipment for. */
function pickForSlot(slot: Slot, available: Set<string>): Exercise | undefined {
  for (const id of slot.prefer) {
    if (available.has(id)) {
      const ex = EXERCISE_BY_ID[id];
      if (ex) return ex;
    }
  }
  return undefined;
}

function setsForSlot(slot: Slot, level: Level): number {
  if (level === 'advanced' && slot.compound) return slot.sets + 1;
  if (level === 'beginner' && !slot.compound) return Math.max(1, slot.sets - 1);
  return slot.sets;
}

/**
 * Bias ordering for the user's goal. Cutting leans toward movements that keep
 * muscle under a deficit; bulking adds compounds for volume.
 */
function goalPriority(goal: Goal): number {
  // Higher means "put compounds first". Compounds preserve or add lean mass.
  switch (goal) {
    case 'cut_recomp':
    case 'maintain_recomp':
      return 2;
    case 'bulk':
      return 3;
    case 'cut_fat_only':
      return 0;
  }
}

export interface GeneratedPlan {
  name: string;
  sessions: { name: SessionName; exercises: RoutineExercise[] }[];
  estimatedMinutes: number;
  /** Human-readable notes about what the generator had to compromise on. */
  notes: string[];
}

export function generatePlan(input: PlanInput): GeneratedPlan {
  const available = new Set(exercisesForEquipment(input.equipment).map((e) => e.id));
  const budgetSeconds = input.sessionMinutes * 60 * WARMUP_RESERVE;
  const days = Math.max(1, Math.min(7, Math.round(input.daysPerWeek)));
  const names = splitFor(days);
  const notes: string[] = [];

  // Sort slots by compound-first, then by goal priority. Focus muscles float up.
  const compoundBoost = goalPriority(input.goal) * 0.5;
  const focus = new Set<MuscleGroup>(input.focus ?? []);

  const sessions = names.map((name) => {
    const slots = [...templateFor(name)].sort((a, b) => {
      const score = (s: Slot) => {
        let v = (s.compound ? 10 : 0) + (focus.has(s.muscle) ? 4 : 0) + (s.compound ? compoundBoost : 0);
        return v;
      };
      return score(b) - score(a);
    });

    const chosen: RoutineExercise[] = [];
    const usedIds = new Set<string>();
    let used = 0;

    for (const slot of slots) {
      const ex = pickForSlot(slot, available);
      if (!ex) continue;
      if (usedIds.has(ex.id)) continue; // no duplicates within a session

      const entry: RoutineExercise = {
        exerciseId: ex.id,
        order: chosen.length,
        targetSets: setsForSlot(slot, input.level),
        targetRepsMin: slot.repsMin,
        targetRepsMax: slot.repsMax,
        restSeconds: slot.restSeconds,
      };

      // Compounds are never dropped for time. Isolation only if it fits.
      const wouldBe = used + slotSeconds(entry);
      if (!slot.compound && wouldBe > budgetSeconds) continue;

      chosen.push(entry);
      usedIds.add(ex.id);
      used = wouldBe;
    }

    return { name, exercises: chosen };
  });

  const empty = sessions.filter((s) => s.exercises.length === 0);
  if (empty.length > 0) {
    notes.push(
      `No usable equipment for ${empty.map((s) => s.name).join(', ')}. Add equipment and regenerate.`
    );
  }

  const overBudget = sessions.filter((s) => estimateDurationSeconds(s.exercises) > input.sessionMinutes * 60);
  if (overBudget.length > 0) {
    notes.push(
      'Compound sets were kept even where they push past your time budget. Cutting the session short is better than skipping the main lift.'
    );
  }

  if (input.level === 'beginner' && available.size <= 4) {
    notes.push('You selected very little equipment, so the plan leans on bodyweight progressions.');
  }

  return {
    name: `VitalX ${input.level} plan`,
    sessions,
    estimatedMinutes: Math.round(
      sessions.reduce((a, s) => a + estimateDurationSeconds(s.exercises), 0) / sessions.length / 60
    ),
    notes,
  };
}

// ---------------------------------------------------------------------------
// Recovery-based adjustment
// ---------------------------------------------------------------------------

/**
 * Apply recovery advice to a session.
 *
 * This is the "plan adapts to recovery" behaviour the submission claims: poor
 * sleep trims volume, great sleep plus a strong HRV earns a progression step,
 * and a bad night converts the session into a rest day.
 */
export function applyRecovery(
  exercises: RoutineExercise[],
  advice: RecoveryAdvice
): { exercises: RoutineExercise[]; note: string } {
  if (advice.action === 'rest_day') {
    return {
      exercises: [],
      note: 'Planned as a rest day. Your recovery has not kept up with your training.',
    };
  }

  const mult = advice.volumeMultiplier ?? 1;
  if (mult === 1) return { exercises, note: 'Recovery is normal. Run the plan as written.' };

  if (advice.action === 'progress') {
    return {
      exercises: exercises.map((e) => ({ ...e, targetSets: e.targetSets + 1 })),
      note: 'Recovery is strong, so one extra set per exercise. Watch for a recovery drop and pull back.',
    };
  }

  return {
    exercises: exercises
      .map((e) => ({ ...e, targetSets: Math.max(1, Math.round(e.targetSets * mult)) }))
      // Keep the compounds intact; cut the isolation work first.
      .filter((e) => {
        const ex = EXERCISE_BY_ID[e.exerciseId];
        return ex ? ex.compound || e.targetSets >= 2 : true;
      }),
    note: 'Volume trimmed. Compounds kept, accessory work reduced.',
  };
}

// ---------------------------------------------------------------------------
// Letting the user choose what to do with a recovery warning
// ---------------------------------------------------------------------------

/** 'recommended' follows the recovery advice, 'planned' ignores it. */
export type RecoveryChoice = 'recommended' | 'planned';

/** If someone trains on a recommended rest day, keep it to about half the sets. */
export const LIGHT_SESSION_MULTIPLIER = 0.5;

/** True when the advice actually asks for less training than planned. */
export function adviceCutsTraining(advice: RecoveryAdvice): boolean {
  return advice.action === 'rest_day' || advice.action === 'reduce_volume';
}

/**
 * Decide the session the user will actually train.
 *
 * Poor sleep is advice, never a lock: the user can always run the plan as
 * written. But the default follows the advice, so doing nothing gives them the
 * lighter, safer session.
 */
export function planSession(
  exercises: RoutineExercise[],
  advice: RecoveryAdvice,
  choice: RecoveryChoice
): { exercises: RoutineExercise[]; note: string } {
  if (choice === 'planned') {
    return { exercises, note: 'Running the plan as written.' };
  }
  if (advice.action === 'rest_day') {
    // Rest was recommended and they want to train anyway: a light session is
    // the honest middle ground, not a full one.
    const light = applyRecovery(exercises, {
      ...advice,
      action: 'reduce_volume',
      volumeMultiplier: LIGHT_SESSION_MULTIPLIER,
    });
    return { exercises: light.exercises, note: 'Light session: about half the sets, main lifts kept.' };
  }
  return applyRecovery(exercises, advice);
}

// ---------------------------------------------------------------------------
// Built-in starter routines
// ---------------------------------------------------------------------------

/**
 * A small library the user can duplicate. Without a backend these cannot come
 * from other users, so they are hand-authored and clearly labelled as built-in.
 */
export const BUILTIN_ROUTINES: { name: string; sessions: { name: SessionName; exercises: RoutineExercise[] }[] }[] = [
  {
    name: 'Push Pull Legs',
    sessions: [
      { name: 'Push', exercises: PUSH.slice(0, 5).map(toRoutineExercise) },
      { name: 'Pull', exercises: PULL.slice(0, 5).map(toRoutineExercise) },
      { name: 'Legs', exercises: LEGS.slice(0, 5).map(toRoutineExercise) },
    ],
  },
  {
    name: 'Full Body 3-Day',
    sessions: ['Full Body A', 'Full Body B', 'Full Body C'].map((name) => ({
      name: name as SessionName,
      exercises: FULL_BODY.slice(0, 5).map(toRoutineExercise),
    })),
  },
];

function toRoutineExercise(slot: Slot, index: number): RoutineExercise {
  return {
    exerciseId: slot.prefer[0],
    order: index,
    targetSets: slot.sets,
    targetRepsMin: slot.repsMin,
    targetRepsMax: slot.repsMax,
    restSeconds: slot.restSeconds,
  };
}
