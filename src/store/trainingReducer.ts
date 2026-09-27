/**
 * Training state and its reducer.
 *
 * Split out of AppState.tsx because the training model is a separate concern
 * with its own actions. The app store delegates to this reducer so there is
 * still a single provider and a single persistence path.
 *
 * The reducer is pure, which is what lets the PR and overload logic be tested
 * without a device.
 */

import {
  Exercise,
  Routine,
  RoutineExercise,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '../types/training';
import { detectPr, exerciseHistory, personalBest } from '../lib/training';

export interface TrainingState {
  routines: Record<string, Routine>;
  workouts: Record<string, Workout>;
  activeWorkoutId: string | null;
  customExercises: Exercise[];
  /** Set the moment the user last finished a rest timer, used for the badge. */
  lastCompletedSetAt: number | null;
}

export const emptyTraining: TrainingState = {
  routines: {},
  workouts: {},
  activeWorkoutId: null,
  customExercises: [],
  lastCompletedSetAt: null,
};

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export type TrainingAction =
  | { type: 'SAVE_ROUTINE'; routine: Routine }
  | { type: 'DELETE_ROUTINE'; routineId: string }
  | { type: 'START_WORKOUT'; workout: Workout }
  | { type: 'ADD_WORKOUT_EXERCISE'; workoutId: string; workoutExercise: WorkoutExercise }
  | { type: 'REMOVE_WORKOUT_EXERCISE'; workoutId: string; workoutExerciseId: string }
  | { type: 'REORDER_WORKOUT_EXERCISES'; workoutId: string; orderedIds: string[] }
  | { type: 'COMPLETE_SET'; workoutId: string; workoutExerciseId: string; set: WorkoutSet }
  | { type: 'UPDATE_SET'; workoutId: string; workoutExerciseId: string; set: WorkoutSet }
  | { type: 'REMOVE_SET'; workoutId: string; workoutExerciseId: string; setId: string }
  | { type: 'FINISH_WORKOUT'; workoutId: string; endedAt: number }
  | { type: 'ABANDON_WORKOUT'; workoutId: string }
  | { type: 'DELETE_WORKOUT'; workoutId: string }
  | { type: 'ADD_CUSTOM_EXERCISE'; exercise: Exercise }
  | { type: 'HYDRATE_TRAINING'; state: Partial<TrainingState> };

/**
 * Re-evaluate every PR flag in a workout against the given history.
 *
 * Needed because history grows: a set that was a PR on the day might not be
 * one after the user benches more next week, and a PR recorded against a stale
 * comparison should not stay flagged forever. Cheap, and it keeps the badge
 * wall honest.
 */
function revalidatePrs(workout: Workout, allWorkouts: Workout[]): Workout {
  const others = Object.values(allWorkouts);
  return {
    ...workout,
    exercises: workout.exercises.map((we) => ({
      ...we,
      sets: we.sets.map((s) => {
        const history = exerciseHistory(we.exerciseId, others);
        const { isPr, prKind } = detectPr(s, history);
        if (isPr === s.isPr && prKind === s.prKind) return s;
        return { ...s, isPr, prKind };
      }),
    })),
  };
}

export function trainingReducer(state: TrainingState, action: TrainingAction): TrainingState {
  switch (action.type) {
    case 'HYDRATE_TRAINING':
      return { ...emptyTraining, ...action.state };

    case 'SAVE_ROUTINE':
      return { ...state, routines: { ...state.routines, [action.routine.id]: action.routine } };

    case 'DELETE_ROUTINE':
      return { ...state, routines: omit(state.routines, action.routineId) };

    case 'ADD_CUSTOM_EXERCISE':
      return { ...state, customExercises: [...state.customExercises, action.exercise] };

    case 'START_WORKOUT':
      return {
        ...state,
        activeWorkoutId: action.workout.id,
        workouts: { ...state.workouts, [action.workout.id]: action.workout },
      };

    case 'ADD_WORKOUT_EXERCISE': {
      const w = state.workouts[action.workoutId];
      if (!w) return state;
      return {
        ...state,
        workouts: {
          ...state.workouts,
          [action.workoutId]: {
            ...w,
            exercises: [...w.exercises, { ...action.workoutExercise, order: w.exercises.length }],
          },
        },
      };
    }

    case 'REMOVE_WORKOUT_EXERCISE': {
      const w = state.workouts[action.workoutId];
      if (!w) return state;
      return {
        ...state,
        workouts: {
          ...state.workouts,
          [action.workoutId]: {
            ...w,
            exercises: w.exercises
              .filter((we) => we.id !== action.workoutExerciseId)
              .map((we, i) => ({ ...we, order: i })),
          },
        },
      };
    }

    case 'REORDER_WORKOUT_EXERCISES': {
      const w = state.workouts[action.workoutId];
      if (!w) return state;
      const byId = new Map(w.exercises.map((we) => [we.id, we]));
      const reordered = action.orderedIds
        .map((id) => byId.get(id))
        .filter((x): x is WorkoutExercise => !!x)
        .map((we, i) => ({ ...we, order: i }));
      return {
        ...state,
        workouts: { ...state.workouts, [action.workoutId]: { ...w, exercises: reordered } },
      };
    }

    case 'COMPLETE_SET':
    case 'UPDATE_SET': {
      const w = state.workouts[action.workoutId];
      if (!w) return state;
      const next: Workout = {
        ...w,
        exercises: w.exercises.map((we) =>
          we.id !== action.workoutExerciseId
            ? we
            : {
                ...we,
                sets: we.sets.some((s) => s.id === action.set.id)
                  ? we.sets.map((s) => (s.id === action.set.id ? action.set : s))
                  : [...we.sets, action.set],
              }
        ),
      };
      return {
        ...state,
        lastCompletedSetAt: action.set.completedAt,
        workouts: { ...state.workouts, [action.workoutId]: next },
      };
    }

    case 'REMOVE_SET': {
      const w = state.workouts[action.workoutId];
      if (!w) return state;
      return {
        ...state,
        workouts: {
          ...state.workouts,
          [action.workoutId]: {
            ...w,
            exercises: w.exercises.map((we) =>
              we.id !== action.workoutExerciseId
                ? we
                : { ...we, sets: we.sets.filter((s) => s.id !== action.setId) }
            ),
          },
        },
      };
    }

    case 'FINISH_WORKOUT': {
      const w = state.workouts[action.workoutId];
      if (!w) return state;
      const next: Workout = { ...w, endedAt: action.endedAt };
      return {
        ...state,
        activeWorkoutId: null,
        workouts: { ...state.workouts, [action.workoutId]: revalidatePrs(next, Object.values(state.workouts)) },
      };
    }

    case 'ABANDON_WORKOUT':
    case 'DELETE_WORKOUT': {
      if (!state.workouts[action.workoutId]) return state;
      const remaining = omit(state.workouts, action.workoutId);
      return {
        ...state,
        activeWorkoutId: state.activeWorkoutId === action.workoutId ? null : state.activeWorkoutId,
        // Deleting a workout invalidates records that were set against it, so
        // every remaining PR is re-derived from the trimmed history.
        workouts: revalidateAll(remaining),
      };
    }

    default:
      return state;
  }
}

/** Rebuild every PR flag against the workouts that remain. */
function revalidateAll(workouts: Record<string, Workout>): Record<string, Workout> {
  const list = Object.values(workouts);
  const out: Record<string, Workout> = {};
  for (const w of list) {
    // Only genuine earlier history counts as "prior" for this workout.
    out[w.id] = revalidatePrs(w, list.filter((o) => o.startedAt < w.startedAt));
  }
  return out;
}

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  const { [key]: _drop, ...rest } = obj as Record<string, unknown>;
  return rest as T;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Build a live workout from a routine template. */
export function workoutFromRoutine(
  routine: Routine | null,
  sessionName: string,
  prefill: (exerciseId: string) => { weight: number; reps: number } | null
): Workout {
  return {
    id: uid('w'),
    routineId: routine?.id ?? null,
    name: sessionName || routine?.name || 'Freestyle session',
    startedAt: Date.now(),
    endedAt: null,
    notes: '',
    exercises: (routine?.exercises ?? []).map((re: RoutineExercise) => {
      const last = prefill(re.exerciseId);
      return {
        id: uid('we'),
        exerciseId: re.exerciseId,
        order: re.order,
        supersetGroup: null,
        // Pre-create the first set with last session's numbers already in it.
        // This is the single biggest perceived-speed win in a logging app.
        sets: last
          ? [
              {
                id: uid('s'),
                setNumber: 1,
                weight: last.weight,
                reps: last.reps,
                isWarmup: false,
                isPr: false,
                completedAt: 0,
              },
            ]
          : [],
      };
    }),
  };
}

export function bestFor(exerciseId: string, workouts: Workout[]) {
  return personalBest(exerciseId, Object.values(workouts));
}
