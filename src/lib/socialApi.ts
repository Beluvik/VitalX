/**
 * Client for the VitalX backend's social API: accounts, cross-device sync,
 * public profiles, follow, like, copy, feed.
 *
 * Unlike the food API, none of this has a "no backend" fallback: accounts
 * only exist on the server, so without a backend address these functions
 * simply are not offered in the UI (see socialAvailable below). Nothing here
 * silently invents an account or a follow relationship.
 */

import type { Workout } from '../types/training';
import type { Changes, DataCollection, SyncRecord } from './dataSync';

export interface SocialSettings {
  backendUrl: string;
  appToken: string;
}

export function socialAvailable(s: SocialSettings): boolean {
  return /^https?:\/\/\S+$/i.test(s.backendUrl.trim());
}

export interface SocialUser {
  username: string;
  displayName: string;
  bio: string;
  isPublic: boolean;
  createdAt: number;
}

export interface AuthResult {
  token: string;
  user: SocialUser;
}

export interface SyncedWorkout {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number;
  isPublic: boolean;
  [key: string]: unknown;
}
export interface FeedItem extends SyncedWorkout {
  author: string;
  likes: number;
  likedByMe: boolean;
}
export interface ProfileResult {
  user: SocialUser;
  followers: number;
  following: number;
  isFollowing?: boolean;
  isSelf?: boolean;
  private?: boolean;
  workouts: (SyncedWorkout & { likes?: number; likedByMe?: boolean })[];
}

export class SocialError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const isNum = (n: unknown): n is number => typeof n === 'number' && isFinite(n);
function isSocialUser(u: any): u is SocialUser {
  return u && typeof u.username === 'string' && typeof u.displayName === 'string' && typeof u.bio === 'string' && typeof u.isPublic === 'boolean' && isNum(u.createdAt);
}

async function call(s: SocialSettings, path: string, init: { method?: string; body?: unknown; token?: string } = {}, timeoutMs = 20000): Promise<any> {
  if (!socialAvailable(s)) throw new SocialError('No VitalX server is set up. Add one in Setup.', 0);
  const base = s.backendUrl.trim().replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (s.appToken.trim()) headers['X-App-Token'] = s.appToken.trim();
    if (init.token) headers.Authorization = `Bearer ${init.token}`;

    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // handled below
    }
    if (!res.ok) {
      const msg = typeof data?.error === 'string' ? data.error : `The server answered with an error (${res.status}).`;
      throw new SocialError(msg, res.status);
    }
    if (data === null) throw new SocialError('The server sent something unreadable.', res.status);
    return data;
  } catch (e: any) {
    if (e instanceof SocialError) throw e;
    if (e?.name === 'AbortError') throw new SocialError('The server took too long. Try again.', 0);
    throw new SocialError('Could not reach the server. Check your internet connection.', 0);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function signup(s: SocialSettings, username: string, email: string, password: string, displayName?: string): Promise<AuthResult> {
  const data = await call(s, '/auth/signup', { method: 'POST', body: { username, email, password, displayName } });
  if (typeof data?.token !== 'string' || !isSocialUser(data?.user)) throw new SocialError('The server sent an unexpected reply.', 0);
  return { token: data.token, user: data.user };
}

export async function login(s: SocialSettings, emailOrUsername: string, password: string): Promise<AuthResult> {
  const data = await call(s, '/auth/login', { method: 'POST', body: { emailOrUsername, password } });
  if (typeof data?.token !== 'string' || !isSocialUser(data?.user)) throw new SocialError('The server sent an unexpected reply.', 0);
  return { token: data.token, user: data.user };
}

export async function logout(s: SocialSettings, token: string): Promise<void> {
  try {
    await call(s, '/auth/logout', { method: 'POST', body: {}, token });
  } catch {
    // Logging out still clears the local session even if the server can't
    // be reached; there is nothing more useful to do with that failure.
  }
}

export async function me(s: SocialSettings, token: string): Promise<SocialUser | null> {
  try {
    const data = await call(s, '/auth/me', { token });
    return isSocialUser(data?.user) ? data.user : null;
  } catch (e) {
    if (e instanceof SocialError && e.status === 401) return null;
    throw e;
  }
}

export async function updateProfile(s: SocialSettings, token: string, patch: { displayName?: string; bio?: string; isPublic?: boolean }): Promise<SocialUser> {
  const data = await call(s, '/me/profile', { method: 'PATCH', body: patch, token });
  if (!isSocialUser(data?.user)) throw new SocialError('The server sent an unexpected reply.', 0);
  return data.user;
}

// ---------------------------------------------------------------------------
// Workout sync
// ---------------------------------------------------------------------------

/** The subset of a local Workout that is worth syncing; strips nothing sensitive, just shapes it. */
function toSyncPayload(w: Workout, isPublic: boolean) {
  return {
    id: w.id,
    name: w.name,
    startedAt: w.startedAt,
    endedAt: w.endedAt ?? w.startedAt,
    isPublic,
    data: { routineId: w.routineId, exercises: w.exercises, notes: w.notes, recovery: w.recovery },
  };
}

export interface SyncPushResult {
  saved: number;
  rejected: string[];
}

/** `publicIds` controls which of these workouts are marked public; everything else syncs as private. */
export async function syncPush(s: SocialSettings, token: string, workouts: Workout[], publicIds: Set<string>): Promise<SyncPushResult> {
  const body = { workouts: workouts.map((w) => toSyncPayload(w, publicIds.has(w.id))) };
  const data = await call(s, '/workouts/sync', { method: 'POST', body, token });
  return {
    saved: isNum(data?.saved) ? data.saved : 0,
    rejected: Array.isArray(data?.rejected) ? data.rejected.filter((x: unknown) => typeof x === 'string') : [],
  };
}

export async function syncPull(s: SocialSettings, token: string, since = 0): Promise<SyncedWorkout[]> {
  const data = await call(s, `/workouts/sync?since=${since}`, { token });
  return Array.isArray(data?.workouts) ? data.workouts.filter((w: any) => typeof w?.id === 'string') : [];
}

/** Like syncPull, but also returns the server's clock, to pass as `since` next time. */
export async function pullWorkouts(s: SocialSettings, token: string, since = 0): Promise<{ workouts: SyncedWorkout[]; syncedAt: number }> {
  const data = await call(s, `/workouts/sync?since=${since}`, { token });
  return {
    workouts: Array.isArray(data?.workouts) ? data.workouts.filter((w: any) => typeof w?.id === 'string') : [],
    syncedAt: isNum(data?.syncedAt) ? data.syncedAt : 0,
  };
}

export async function deleteRemote(s: SocialSettings, token: string, workoutId: string): Promise<boolean> {
  const data = await call(s, `/workouts/${encodeURIComponent(workoutId)}`, { method: 'DELETE', token });
  return data?.removed === true;
}

// ---------------------------------------------------------------------------
// Profiles and follow
// ---------------------------------------------------------------------------

export async function getProfile(s: SocialSettings, username: string, token?: string): Promise<ProfileResult> {
  const data = await call(s, `/profile/${encodeURIComponent(username)}`, { token });
  if (!isSocialUser(data?.user) || !Array.isArray(data?.workouts)) throw new SocialError('The server sent an unexpected reply.', 0);
  return data;
}

export async function setFollow(s: SocialSettings, token: string, username: string, on: boolean): Promise<boolean> {
  const data = await call(s, `/profile/${encodeURIComponent(username)}/follow`, { method: on ? 'POST' : 'DELETE', body: on ? {} : undefined, token });
  return data?.following === true;
}

// ---------------------------------------------------------------------------
// Likes and copy
// ---------------------------------------------------------------------------

export async function setLike(s: SocialSettings, token: string, workoutId: string, on: boolean): Promise<{ liked: boolean; likes: number }> {
  const data = await call(s, `/workouts/${encodeURIComponent(workoutId)}/like`, { method: on ? 'POST' : 'DELETE', body: on ? {} : undefined, token });
  return { liked: data?.liked === true, likes: isNum(data?.likes) ? data.likes : 0 };
}

export interface CopiedRoutineExercise {
  exerciseId: string;
  order: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  restSeconds: number;
}

/** Returns a routine shape ready to hand to the local routine store; never includes another person's actual weights. */
export async function copyWorkout(s: SocialSettings, token: string, workoutId: string): Promise<{ name: string; exercises: CopiedRoutineExercise[] }> {
  const data = await call(s, `/workouts/${encodeURIComponent(workoutId)}/copy`, { method: 'POST', body: {}, token });
  const r = data?.routine;
  if (!r || typeof r.name !== 'string' || !Array.isArray(r.exercises)) throw new SocialError('The server sent an unexpected reply.', 0);
  const exercises: CopiedRoutineExercise[] = r.exercises
    .filter((e: any) => typeof e?.exerciseId === 'string')
    .map((e: any, i: number) => ({
      exerciseId: e.exerciseId,
      order: isNum(e.order) ? e.order : i,
      targetSets: isNum(e.targetSets) && e.targetSets > 0 ? e.targetSets : 3,
      targetRepsMin: isNum(e.targetRepsMin) ? e.targetRepsMin : 8,
      targetRepsMax: isNum(e.targetRepsMax) ? e.targetRepsMax : 12,
      restSeconds: isNum(e.restSeconds) ? e.restSeconds : 90,
    }));
  return { name: r.name, exercises };
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export async function getFeed(s: SocialSettings, token: string, before?: number): Promise<FeedItem[]> {
  const data = await call(s, `/feed${before ? `?before=${before}` : ''}`, { token });
  return Array.isArray(data?.workouts) ? data.workouts.filter((w: any) => typeof w?.id === 'string' && typeof w?.author === 'string') : [];
}

// ---------------------------------------------------------------------------
// Personal data sync (profile, food and day logs, routines, recipes, ...)
// ---------------------------------------------------------------------------

export interface DataSyncResult {
  applied: number;
  rejected: { collection: string; id: string; reason: string }[];
  changes: Partial<Record<DataCollection, SyncRecord[]>>;
  cursor: number;
  more: boolean;
}

function isSyncRecord(r: any): r is SyncRecord {
  return typeof r?.id === 'string' && isNum(r?.updatedAt);
}

/** Pushes local changes and pulls everything stored since `since`. Call again with the returned cursor while `more` is true. */
export async function syncData(s: SocialSettings, token: string, since: number, changes: Changes): Promise<DataSyncResult> {
  const { workouts: _workouts, ...data } = changes;
  const res = await call(s, '/sync', { method: 'POST', body: { since, changes: data }, token });
  const out: DataSyncResult['changes'] = {};
  if (res?.changes && typeof res.changes === 'object') {
    for (const [k, list] of Object.entries(res.changes)) {
      if (Array.isArray(list)) out[k as DataCollection] = list.filter(isSyncRecord);
    }
  }
  if (!isNum(res?.cursor)) throw new SocialError('The server sent an unexpected reply.', 0);
  return {
    applied: isNum(res?.applied) ? res.applied : 0,
    rejected: Array.isArray(res?.rejected) ? res.rejected.filter((x: any) => typeof x?.id === 'string') : [],
    changes: out,
    cursor: res.cursor,
    more: res?.more === true,
  };
}
