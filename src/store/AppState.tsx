import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DayLog, LoggedFood, Profile, Recipe, SleepScore } from '../types';
import { Exercise, Routine, Workout, WorkoutSet } from '../types/training';
import { EXERCISE_BY_ID } from '../data/exercises';
import { isFinished } from '../lib/training';
import { upsertRecipe } from '../lib/recipes';
import { Changes, SyncableState, applyRemote } from '../lib/dataSync';
import {
  TrainingAction,
  TrainingState,
  emptyTraining,
  trainingReducer,
} from './trainingReducer';

const STORAGE_KEY = 'vitalx.state.v2';

export interface AppState {
  hydrated: boolean;
  profile: Profile | null;
  days: Record<string, DayLog>;
  badges: Record<string, number>;
  training: TrainingState;
  recipes: Recipe[];
}

const initialState: AppState = {
  hydrated: false,
  profile: null,
  days: {},
  badges: {},
  training: emptyTraining,
  recipes: [],
};

type AppAction =
  | { type: 'HYDRATE'; state: Partial<AppState> }
  | { type: 'SET_PROFILE'; profile: Profile }
  | { type: 'LOG_FOOD'; date: string; food: LoggedFood }
  | { type: 'REMOVE_FOOD'; date: string; logId: string }
  | { type: 'SET_DAY'; date: string; patch: Partial<DayLog> }
  | { type: 'SET_SLEEP'; date: string; sleep: SleepScore }
  | { type: 'UNLOCK_BADGE'; badgeId: string }
  | { type: 'SAVE_RECIPE'; recipe: Recipe }
  | { type: 'DELETE_RECIPE'; recipeId: string }
  | { type: 'APPLY_REMOTE'; changes: Changes }
  | TrainingAction;

function upsertDay(state: AppState, date: string, patch: Partial<DayLog>): AppState {
  const existing = state.days[date] ?? { date, foods: [], steps: 0, gymBurn: 0 };
  return { ...state, days: { ...state.days, [date]: { ...existing, ...patch } } };
}

/** The parts of state that sync to the cloud (see lib/dataSync.ts). */
export function syncableOf(state: AppState): SyncableState {
  return {
    profile: state.profile,
    days: state.days,
    badges: state.badges,
    recipes: state.recipes,
    routines: state.training.routines,
    customExercises: state.training.customExercises,
    workouts: state.training.workouts,
  };
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'HYDRATE':
      return {
        ...state,
        ...action.state,
        training: { ...emptyTraining, ...(action.state.training ?? {}) },
        recipes: action.state.recipes ?? [],
        hydrated: true,
      };
    case 'SET_PROFILE':
      return { ...state, profile: action.profile };
    case 'LOG_FOOD': {
      const day = state.days[action.date] ?? { date: action.date, foods: [], steps: 0, gymBurn: 0 };
      return {
        ...state,
        days: { ...state.days, [action.date]: { ...day, foods: [...day.foods, action.food] } },
      };
    }
    case 'REMOVE_FOOD': {
      const day = state.days[action.date];
      if (!day) return state;
      return {
        ...state,
        days: { ...state.days, [action.date]: { ...day, foods: day.foods.filter((f) => f.id !== action.logId) } },
      };
    }
    case 'SET_DAY':
      return upsertDay(state, action.date, action.patch);
    case 'SET_SLEEP':
      return upsertDay(state, action.date, { sleep: action.sleep });
    case 'UNLOCK_BADGE':
      if (state.badges[action.badgeId]) return state;
      return { ...state, badges: { ...state.badges, [action.badgeId]: Date.now() } };
    case 'SAVE_RECIPE':
      return { ...state, recipes: upsertRecipe(state.recipes, action.recipe) };
    case 'DELETE_RECIPE':
      return { ...state, recipes: state.recipes.filter((r) => r.id !== action.recipeId) };
    case 'APPLY_REMOTE': {
      const merged = applyRemote(syncableOf(state), action.changes);
      return {
        ...state,
        profile: merged.profile,
        days: merged.days,
        badges: merged.badges,
        recipes: merged.recipes,
        training: { ...state.training, routines: merged.routines, customExercises: merged.customExercises, workouts: merged.workouts },
      };
    }
    default:
      return { ...state, training: trainingReducer(state.training, action) };
  }
}

interface Ctx extends AppState {
  setProfile: (p: Profile) => void;
  logFood: (date: string, f: LoggedFood) => void;
  removeFood: (date: string, logId: string) => void;
  setDay: (date: string, patch: Partial<DayLog>) => void;
  setSleep: (date: string, s: SleepScore) => void;
  unlockBadge: (id: string) => void;
  day: (date: string) => DayLog;
  /** Folds records pulled from the server into state. Used by cloud sync. */
  applyRemote: (changes: Changes) => void;
  resetAll: () => Promise<void>;

  // --- recipes ---
  recipes: Recipe[];
  saveRecipe: (r: Recipe) => void;
  deleteRecipe: (id: string) => void;

  // --- training ---
  routines: Routine[];
  workouts: Workout[];
  activeWorkout: Workout | null;
  dispatchTraining: (a: TrainingAction) => void;
  /** Resolves built-in and user-created exercises. */
  getExercise: (id: string) => Exercise | undefined;
  saveRoutine: (r: Routine) => void;
}

const AppStateContext = createContext<Ctx | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          dispatch({
            type: 'HYDRATE',
            state: {
              profile: parsed.profile ?? null,
              days: parsed.days ?? {},
              badges: parsed.badges ?? {},
              training: parsed.training ?? {},
              recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [],
            },
          });
          return;
        }
      } catch {
        // A corrupt or unreadable store must not stop the app booting.
      }
      dispatch({ type: 'HYDRATE', state: {} });
    })();
  }, []);

  // Debounced persist. Writing on every set completion is wasteful, but losing
  // the last few seconds of a logged session is worse.
  useEffect(() => {
    if (!state.hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          profile: state.profile,
          days: state.days,
          badges: state.badges,
          training: state.training,
          recipes: state.recipes,
        })
      ).catch(() => undefined);
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state.hydrated, state.profile, state.days, state.badges, state.training, state.recipes]);

  const getExercise = useCallback(
    (id: string) => EXERCISE_BY_ID[id] ?? state.training.customExercises.find((e) => e.id === id),
    [state.training.customExercises]
  );

  const value = useMemo<Ctx>(
    () => ({
      ...state,
      setProfile: (profile) => dispatch({ type: 'SET_PROFILE', profile }),
      logFood: (date, food) => dispatch({ type: 'LOG_FOOD', date, food }),
      removeFood: (date, logId) => dispatch({ type: 'REMOVE_FOOD', date, logId }),
      setDay: (date, patch) => dispatch({ type: 'SET_DAY', date, patch }),
      setSleep: (date, sleep) => dispatch({ type: 'SET_SLEEP', date, sleep }),
      unlockBadge: (badgeId) => dispatch({ type: 'UNLOCK_BADGE', badgeId }),
      day: (date) => state.days[date] ?? { date, foods: [], steps: 0, gymBurn: 0 },
      applyRemote: (changes) => dispatch({ type: 'APPLY_REMOTE', changes }),
      resetAll: async () => {
        await AsyncStorage.removeItem(STORAGE_KEY);
        dispatch({
          type: 'HYDRATE',
          state: { profile: null, days: {}, badges: {}, training: emptyTraining, recipes: [] },
        });
      },
      routines: Object.values(state.training.routines).sort((a, b) => a.createdAt - b.createdAt),
      // Saved sessions only. The session being logged is a draft, exposed
      // separately as `activeWorkout`, so it never leaks into history, bests
      // or pre-fill until the user finishes it.
      workouts: Object.values(state.training.workouts)
        .filter(isFinished)
        .sort((a, b) => b.startedAt - a.startedAt),
      recipes: state.recipes,
      saveRecipe: (recipe: Recipe) => dispatch({ type: 'SAVE_RECIPE', recipe }),
      deleteRecipe: (recipeId: string) => dispatch({ type: 'DELETE_RECIPE', recipeId }),
      activeWorkout: state.training.activeWorkoutId
        ? state.training.workouts[state.training.activeWorkoutId] ?? null
        : null,
      dispatchTraining: (a: TrainingAction) => dispatch(a),
      getExercise,
      saveRoutine: (routine: Routine) => dispatch({ type: 'SAVE_ROUTINE', routine }),
    }),
    [state, getExercise]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysAgoKey(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayKey(d);
}

export function shortDate(key: string): string {
  const [, m, d] = key.split('-');
  return `${Number(d)}/${Number(m)}`;
}
