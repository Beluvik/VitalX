/**
 * Training engine. Pure functions, no React, no I/O.
 *
 * The important design decision here is that personal-record detection happens
 * at set-completion time against the full known history, not as a batch job
 * afterwards. A PR the user sees 30 seconds late is not a PR, it is a receipt.
 */

import { OverloadBand } from '../types';
import {
  Exercise,
  MuscleGroup,
  MuscleSplitEntry,
  PersonalBest,
  PrKind,
  Workout,
  WorkoutSet,
  WorkoutSummary,
} from '../types/training';
import { OVERLOAD_BANDS, Profile } from '../types';
import { sessionBurn } from './energy';

export type GetExercise = (id: string) => Exercise | undefined;

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

/** Training volume for one set. Warm-ups are excluded: they are not stimulus. */
export function setVolume(set: WorkoutSet): number {
  if (set.isWarmup) return 0;
  return set.weight * set.reps;
}

export function workingSets(sets: WorkoutSet[]): WorkoutSet[] {
  return sets.filter((s) => !s.isWarmup);
}

export function exerciseVolume(sets: WorkoutSet[]): number {
  return workingSets(sets).reduce((a, s) => a + setVolume(s), 0);
}

export function workoutVolume(workout: Workout): number {
  return workout.exercises.reduce((a, we) => a + exerciseVolume(we.sets), 0);
}

// ---------------------------------------------------------------------------
// Personal records
// ---------------------------------------------------------------------------

/**
 * Every completed set for an exercise, oldest first, across all workouts.
 *
 * `excludeWorkoutId` exists because comparing a session against a timestamp
 * cutoff is fragile: set timestamps come from when a row was tapped, not from
 * when the workout began, so a cutoff can accidentally include the very sets
 * being evaluated. Excluding by id is unambiguous.
 */
export function exerciseHistory(
  exerciseId: string,
  workouts: Workout[],
  opts?: { before?: number; excludeWorkoutId?: string }
): WorkoutSet[] {
  const out: WorkoutSet[] = [];
  for (const w of workouts) {
    if (opts?.excludeWorkoutId && w.id === opts.excludeWorkoutId) continue;
    for (const we of w.exercises) {
      if (we.exerciseId !== exerciseId) continue;
      for (const s of we.sets) {
        if (opts?.before !== undefined && s.completedAt >= opts.before) continue;
        out.push(s);
      }
    }
  }
  // Let the caller ask "what had I done before this moment", which is what
  // pre-filling needs.
  return out.sort((a, b) => a.completedAt - b.completedAt);
}

/**
 * Decide whether a just-completed set is a personal record.
 *
 * Two kinds, because they are different achievements:
 *   weight  - heaviest load ever lifted on the exercise
 *   volume  - biggest single set by weight x reps, which rewards the harder
 *             rep range and not just adding plate
 *
 * A set can be both, e.g. the first time you ever bench 100 kg x 5.
 * The very first set on an exercise counts as a record for both, otherwise a
 * new movement would never register anything.
 */
export function detectPr(
  candidate: WorkoutSet,
  history: WorkoutSet[]
): { isPr: boolean; prKind?: PrKind } {
  if (candidate.isWarmup) return { isPr: false };

  const prior = workingSets(
    history.filter((s) => s.completedAt < candidate.completedAt && s.id !== candidate.id)
  );

  if (prior.length === 0) {
    return { isPr: true, prKind: 'both' };
  }

  const maxWeight = prior.reduce((m, s) => Math.max(m, s.weight), 0);
  const maxVolume = prior.reduce((m, s) => Math.max(m, setVolume(s)), 0);

  const newWeight = candidate.weight > maxWeight;
  const newVolume = setVolume(candidate) > maxVolume;

  if (newWeight && newVolume) return { isPr: true, prKind: 'both' };
  if (newWeight) return { isPr: true, prKind: 'weight' };
  if (newVolume) return { isPr: true, prKind: 'volume' };
  return { isPr: false };
}

export function personalBest(
  exerciseId: string,
  workouts: Workout[],
  before?: number
): PersonalBest {
  const history = exerciseHistory(exerciseId, workouts, { before });
  const working = workingSets(history);

  const empty: PersonalBest = {
    maxWeight: 0,
    maxWeightReps: 0,
    maxVolume: 0,
    maxVolumeSet: { weight: 0, reps: 0 },
    totalSets: 0,
    lastPerformed: 0,
    lastWeight: 0,
    lastReps: 0,
  };
  if (working.length === 0) return empty;

  const heaviest = working.reduce((m, s) => (s.weight > m.weight ? s : m));
  const biggest = working.reduce((m, s) => (setVolume(s) > setVolume(m) ? s : m));

  // Pre-fill target: the best set from the most recent session, so the user
  // opens the app already looking at a number worth beating.
  const lastAt = working.reduce((m, s) => Math.max(m, s.completedAt), 0);
  const lastSessionBest = working
    .filter((s) => s.completedAt === lastAt)
    .reduce((m, s) => (setVolume(s) > setVolume(m) ? s : m));

  return {
    maxWeight: heaviest.weight,
    maxWeightReps: heaviest.reps,
    maxVolume: setVolume(biggest),
    maxVolumeSet: { weight: biggest.weight, reps: biggest.reps },
    totalSets: working.length,
    lastPerformed: lastAt,
    lastWeight: lastSessionBest.weight,
    lastReps: lastSessionBest.reps,
  };
}

// ---------------------------------------------------------------------------
// Muscle split
// ---------------------------------------------------------------------------

/**
 * Session volume split across muscle groups.
 *
 * Each completed set's volume is distributed across the exercise's muscles
 * using that exercise's stimulus weights, so a bench press credits chest for
 * most of its volume and triceps for the rest rather than counting the whole
 * set as chest.
 */
export function muscleSplit(workout: Workout, getExercise: GetExercise): MuscleSplitEntry[] {
  const acc = new Map<MuscleGroup, number>();

  for (const we of workout.exercises) {
    const ex = getExercise(we.exerciseId);
    if (!ex) continue;
    const vol = exerciseVolume(we.sets);
    if (vol <= 0) continue;
    for (const m of ex.muscles) {
      acc.set(m.group, (acc.get(m.group) ?? 0) + vol * m.weight);
    }
  }

  const total = [...acc.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];

  return [...acc.entries()]
    .map(([group, volume]) => ({
      group,
      volume: Math.round(volume),
      percent: Math.round((volume / total) * 1000) / 10,
    }))
    .sort((a, b) => b.volume - a.volume);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function summarizeWorkout(workout: Workout, getExercise: GetExercise): WorkoutSummary {
  const allSets = workout.exercises.flatMap((we) => we.sets);
  const working = allSets.filter((s) => !s.isWarmup);
  const end = workout.endedAt ?? Date.now();

  return {
    durationMinutes: Math.max(0, Math.round((end - workout.startedAt) / 60000)),
    totalVolume: workoutVolume(workout),
    totalSets: allSets.length,
    workingSets: working.length,
    prs: allSets
      .filter((s) => s.isPr)
      .map((s) => ({
        exerciseId: workout.exercises.find((we) => we.sets.some((x) => x.id === s.id))!.exerciseId,
        exerciseName: getExercise(
          workout.exercises.find((we) => we.sets.some((x) => x.id === s.id))!.exerciseId
        )?.name ?? 'Unknown',
        set: s,
      })),
    muscleSplit: muscleSplit(workout, getExercise),
  };
}

// ---------------------------------------------------------------------------
// Overload assessment and burn
// ---------------------------------------------------------------------------

/**
 * Estimate how well the user overloaded, by comparing each exercise's best set
 * this session against their previous best.
 *
 * The app historically asked the user to self-report this. Inferring it is
 * better where it works, but it is an estimate, so the UI keeps the option to
 * override the band.
 */
export function assessOverload(
  workout: Workout,
  getExercise: GetExercise,
  allWorkouts: Workout[]
): { band: OverloadBand; improved: number; compared: number } {
  let improved = 0;
  let compared = 0;

  for (const we of workout.exercises) {
    const sessionBest = workingSets(we.sets).reduce<WorkoutSet | null>(
      (m, s) => (m === null || setVolume(s) > setVolume(m) ? s : m),
      null
    );
    if (!sessionBest) continue;

    const previous = workingSets(
      exerciseHistory(we.exerciseId, allWorkouts, { excludeWorkoutId: workout.id })
    );
    if (previous.length === 0) continue; // nothing to compare against yet

    compared++;
    const previousBest = previous.reduce((m, s) => Math.max(m, setVolume(s)), 0);
    if (setVolume(sessionBest) > previousBest) improved++;
  }

  if (compared === 0) return { band: 'moderate', improved: 0, compared: 0 };

  const ratio = improved / compared;
  if (ratio >= 0.6) return { band: 'strong', improved, compared };
  if (ratio >= 0.3) return { band: 'moderate', improved, compared };
  return { band: 'minimal', improved, compared };
}

/**
 * Calories burned by a session.
 *
 * Strength work uses the progressive-overload band, because two 60-minute
 * sessions can differ hugely in output and nothing else distinguishes them.
 * Cardio falls back to MET, where an overload band would be nonsense.
 */
export function workoutBurn(
  workout: Workout,
  getExercise: GetExercise,
  weightKg: number,
  band: OverloadBand
): { kcal: number; method: 'overload' | 'met' } {
  const totalWorking = workout.exercises.reduce((a, we) => a + workingSets(we.sets).length, 0);
  const cardioIds = workout.exercises
    .filter((we) => getExercise(we.exerciseId)?.equipment === 'cardio')
    .map((we) => we.exerciseId);

  if (totalWorking > 0 && cardioIds.length > 0) {
    const cardioShare = cardioIds.reduce(
      (a, id) =>
        a +
        workout.exercises
          .filter((we) => we.exerciseId === id)
          .reduce((b, we) => b + workingSets(we.sets).length, 0),
      0
    ) / totalWorking;

    if (cardioShare > 0.5) {
      const metValues = cardioIds
        .map((id) => getExercise(id)?.met)
        .filter((m): m is number => typeof m === 'number');
      const meanMet = metValues.length
        ? metValues.reduce((a, b) => a + b, 0) / metValues.length
        : 6;
      const hours = Math.max(0.1, ((workout.endedAt ?? Date.now()) - workout.startedAt) / 3600000);
      // MET x kg x hours, the standard formulation.
      return { kcal: Math.round(meanMet * weightKg * hours), method: 'met' };
    }
  }

  const minutes = (workout.endedAt ?? Date.now()) - workout.startedAt;
  return { kcal: sessionBurn(band, minutes / 60000), method: 'overload' };
}

// ---------------------------------------------------------------------------
// Progression helpers
// ---------------------------------------------------------------------------

/**
 * Next-session target for an exercise, from its most recent working set.
 * Returns null for a first attempt, so the UI can ask instead of guessing.
 */
export function progressionTarget(
  exerciseId: string,
  workouts: Workout[]
): { weight: number; reps: number; suggestion: string } | null {
  const history = workingSets(exerciseHistory(exerciseId, workouts));
  if (history.length === 0) return null;

  const last = history[history.length - 1];
  const hitTopOfRange = last.reps >= 10;

  if (hitTopOfRange) {
    return {
      weight: last.weight,
      reps: last.reps - 2,
      suggestion: 'Reps are getting hard. Try the same weight for 2 fewer reps this session.',
    };
  }
  return {
    weight: last.weight,
    reps: last.reps + 1,
    suggestion: 'Add one rep. Two or three in a row earns a weight bump.',
  };
}

/** Progression multiplier from recovery advice, applied to target sets. */
export function adjustedSetCount(base: number, multiplier: number | null): number {
  if (multiplier === null) return 0; // rest day
  return Math.max(1, Math.round(base * multiplier));
}

export function bandLabel(band: OverloadBand): string {
  return OVERLOAD_BANDS[band].label;
}
