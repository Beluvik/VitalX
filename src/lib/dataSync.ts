/**
 * Cloud sync for the user's own data: works out what changed on this phone
 * since the last sync, and folds what the server sent back into app state.
 *
 * Pure functions only, so all of it is tested in Node. The screen-side
 * wiring (when to sync, talking to the server) lives in store/cloudSync.tsx.
 *
 * How changes are found: after every sync we keep a fingerprint of each
 * record as the server now has it (the "snapshot"). Next time, any record
 * whose fingerprint differs was edited here, and any record in the snapshot
 * that no longer exists was deleted here. This needs no change to the
 * reducers: they keep editing state exactly as before.
 */

import type { DayLog, LoggedFood, Profile, Recipe } from '../types';
import type { Exercise, Routine, Workout } from '../types/training';

/** Collections the /sync endpoint stores. Workouts use their own endpoints (they can be public). */
export type DataCollection = 'profile' | 'days' | 'foods' | 'routines' | 'recipes' | 'exercises' | 'badges';
export type Collection = DataCollection | 'workouts';

export const DATA_COLLECTIONS: DataCollection[] = ['profile', 'days', 'foods', 'routines', 'recipes', 'exercises', 'badges'];

export interface SyncableState {
  profile: Profile | null;
  days: Record<string, DayLog>;
  badges: Record<string, number>;
  recipes: Recipe[];
  routines: Record<string, Routine>;
  customExercises: Exercise[];
  workouts: Record<string, Workout>;
}

/** One record as sent to and received from the server. */
export interface SyncRecord {
  id: string;
  updatedAt: number;
  deleted?: boolean;
  data?: unknown;
}

export type Changes = Partial<Record<Collection, SyncRecord[]>>;

/** Fingerprint of every record, keyed "collection:id", as last agreed with the server. */
export type Snapshot = Record<string, string>;

export const keyOf = (c: Collection, id: string) => `${c}:${id}`;

/** JSON with object keys sorted and undefined dropped, so equal data always gives an equal string. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  const parts = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`);
  return `{${parts.join(',')}}`;
}

// ---------------------------------------------------------------------------
// App state -> records
// ---------------------------------------------------------------------------

/** The day's own fields. Its foods sync separately, one record each, so two phones logging meals the same day do not overwrite each other. */
function dayData(d: DayLog) {
  return { steps: d.steps, gymBurn: d.gymBurn, sleep: d.sleep, trainingSessionId: d.trainingSessionId };
}
const dayIsEmpty = (d: DayLog) => !d.steps && !d.gymBurn && !d.sleep && !d.trainingSessionId;

function workoutData(w: Workout) {
  return { routineId: w.routineId, name: w.name, startedAt: w.startedAt, endedAt: w.endedAt, notes: w.notes, exercises: w.exercises, recovery: w.recovery };
}

export interface LocalRecord {
  collection: Collection;
  id: string;
  data: unknown;
}

/** Every syncable record in the app, keyed "collection:id". */
export function collect(state: SyncableState): Map<string, LocalRecord> {
  const out = new Map<string, LocalRecord>();
  const add = (collection: Collection, id: string, data: unknown) => out.set(keyOf(collection, id), { collection, id, data });

  if (state.profile) add('profile', 'profile', state.profile);
  for (const day of Object.values(state.days)) {
    if (!dayIsEmpty(day)) add('days', day.date, dayData(day));
    for (const f of day.foods) add('foods', f.id, { ...f, date: day.date });
  }
  for (const r of Object.values(state.routines)) add('routines', r.id, r);
  for (const r of state.recipes) add('recipes', r.id, r);
  for (const e of state.customExercises) add('exercises', e.id, e);
  for (const [id, unlockedAt] of Object.entries(state.badges)) add('badges', id, { unlockedAt });
  // Only finished sessions. A draft being logged right now is not history yet.
  for (const w of Object.values(state.workouts)) if (w.endedAt) add('workouts', w.id, workoutData(w));
  return out;
}

export function fingerprint(current: Map<string, LocalRecord>): Snapshot {
  const snap: Snapshot = {};
  for (const [k, r] of current) snap[k] = stableStringify(r.data);
  return snap;
}

/** What changed here since `snapshot`: edits and additions as full records, deletions as tombstones. */
export function diff(current: Map<string, LocalRecord>, snapshot: Snapshot, now: number): Changes {
  const changes: Changes = {};
  const push = (c: Collection, r: SyncRecord) => (changes[c] ??= []).push(r);

  for (const [k, r] of current) {
    if (snapshot[k] !== stableStringify(r.data)) push(r.collection, { id: r.id, updatedAt: now, data: r.data });
  }
  for (const k of Object.keys(snapshot)) {
    if (current.has(k)) continue;
    const i = k.indexOf(':');
    push(k.slice(0, i) as Collection, { id: k.slice(i + 1), updatedAt: now, deleted: true });
  }
  return changes;
}

export function countChanges(c: Changes): number {
  return Object.values(c).reduce((n, list) => n + (list?.length ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Server records -> app state
// ---------------------------------------------------------------------------

const isObj = (o: unknown): o is Record<string, any> => !!o && typeof o === 'object' && !Array.isArray(o);
const emptyDay = (date: string): DayLog => ({ date, foods: [], steps: 0, gymBurn: 0 });

/**
 * Folds server records into state. Records that are malformed are skipped
 * rather than trusted: a bad row on the server must never break the app.
 */
export function applyRemote<S extends SyncableState>(state: S, changes: Changes): S {
  let days = state.days;
  let routines = state.routines;
  let recipes = state.recipes;
  let customExercises = state.customExercises;
  let badges = state.badges;
  let workouts = state.workouts;
  let profile = state.profile;

  const touchDays = () => (days === state.days ? (days = { ...state.days }) : days);

  for (const r of changes.profile ?? []) {
    // A profile is never removed by sync: without one the app would drop back to onboarding.
    if (!r.deleted && isObj(r.data) && typeof r.data.weightKg === 'number') profile = r.data as Profile;
  }

  for (const r of changes.days ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.id)) continue;
    const d = touchDays();
    const cur = d[r.id] ?? emptyDay(r.id);
    if (r.deleted) d[r.id] = { ...cur, steps: 0, gymBurn: 0, sleep: undefined, trainingSessionId: undefined };
    else if (isObj(r.data)) {
      d[r.id] = {
        ...cur,
        steps: typeof r.data.steps === 'number' ? r.data.steps : 0,
        gymBurn: typeof r.data.gymBurn === 'number' ? r.data.gymBurn : 0,
        sleep: isObj(r.data.sleep) ? (r.data.sleep as DayLog['sleep']) : undefined,
        trainingSessionId: typeof r.data.trainingSessionId === 'string' ? r.data.trainingSessionId : undefined,
      };
    }
  }

  for (const r of changes.foods ?? []) {
    const d = touchDays();
    // Remove it wherever it is first, so a meal moved to another day is not left behind.
    for (const [date, day] of Object.entries(d)) {
      if (day.foods.some((f) => f.id === r.id)) d[date] = { ...day, foods: day.foods.filter((f) => f.id !== r.id) };
    }
    if (r.deleted || !isObj(r.data) || typeof r.data.date !== 'string' || typeof r.data.kcal !== 'number') continue;
    const { date, ...food } = r.data;
    const day = d[date] ?? emptyDay(date);
    const foods = [...day.foods, { ...(food as LoggedFood), id: r.id }].sort((a, b) => a.loggedAt - b.loggedAt);
    d[date] = { ...day, foods };
  }

  for (const r of changes.routines ?? []) {
    routines = { ...routines };
    if (r.deleted) delete routines[r.id];
    else if (isObj(r.data) && typeof r.data.name === 'string' && Array.isArray(r.data.exercises)) routines[r.id] = { ...(r.data as Routine), id: r.id };
  }

  for (const r of changes.recipes ?? []) {
    recipes = recipes.filter((x) => x.id !== r.id);
    if (!r.deleted && isObj(r.data) && typeof r.data.name === 'string' && Array.isArray(r.data.ingredients)) recipes = [...recipes, { ...(r.data as Recipe), id: r.id }];
  }

  for (const r of changes.exercises ?? []) {
    customExercises = customExercises.filter((x) => x.id !== r.id);
    if (!r.deleted && isObj(r.data) && typeof r.data.name === 'string') customExercises = [...customExercises, { ...(r.data as Exercise), id: r.id }];
  }

  for (const r of changes.badges ?? []) {
    badges = { ...badges };
    if (r.deleted) delete badges[r.id];
    else if (isObj(r.data) && typeof r.data.unlockedAt === 'number') badges[r.id] = r.data.unlockedAt;
  }

  for (const r of changes.workouts ?? []) {
    workouts = { ...workouts };
    if (r.deleted) delete workouts[r.id];
    else if (isObj(r.data) && typeof r.data.name === 'string' && typeof r.data.startedAt === 'number' && Array.isArray(r.data.exercises)) {
      workouts[r.id] = {
        id: r.id,
        routineId: typeof r.data.routineId === 'string' ? r.data.routineId : null,
        name: r.data.name,
        startedAt: r.data.startedAt,
        endedAt: typeof r.data.endedAt === 'number' ? r.data.endedAt : r.data.startedAt,
        notes: typeof r.data.notes === 'string' ? r.data.notes : '',
        exercises: r.data.exercises,
        recovery: isObj(r.data.recovery) ? (r.data.recovery as Workout['recovery']) : undefined,
      };
    }
  }

  return { ...state, profile, days, routines, recipes, customExercises, badges, workouts };
}

/**
 * The snapshot after a sync: the old one, plus what this phone pushed, plus
 * what it received. Built from what was actually exchanged, not from current
 * state, so an edit made while the request was in flight is still seen as
 * unsynced next time instead of being silently marked done.
 */
export function nextSnapshot(snapshot: Snapshot, pushed: Changes, receivedAsLocal: Map<string, LocalRecord>, receivedKeys: string[]): Snapshot {
  const next = { ...snapshot };
  for (const [c, list] of Object.entries(pushed) as [Collection, SyncRecord[]][]) {
    for (const r of list) {
      const k = keyOf(c, r.id);
      if (r.deleted) delete next[k];
      else next[k] = stableStringify(r.data);
    }
  }
  for (const k of receivedKeys) {
    const local = receivedAsLocal.get(k);
    if (local) next[k] = stableStringify(local.data);
    else delete next[k];
  }
  return next;
}
