import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as RNAppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  Changes,
  Collection,
  LocalRecord,
  Snapshot,
  SyncRecord,
  applyRemote,
  collect,
  countChanges,
  diff,
  fingerprint,
  keyOf,
  nextSnapshot,
} from '../lib/dataSync';
import { deleteRemote, pullWorkouts, syncData, syncPush } from '../lib/socialApi';
import { getAuth, refreshServer, useAuth } from './authStore';
import { syncableOf, useApp } from './AppState';

/**
 * Keeps this phone's data and the user's account in step, in the
 * background, whenever they are signed in:
 *   - right after signing in (which is how a new phone restores everything)
 *   - a few seconds after any local change
 *   - when the app comes back to the foreground
 * Offline is normal: a failed background sync just waits for the next one.
 */

const META_KEY = 'vitalx.sync.v1';
const CHANGE_DEBOUNCE_MS = 5000;
const FOREGROUND_MIN_GAP_MS = 30_000;
const DATA_BATCH = 500; // server limit per /sync
const WORKOUT_BATCH = 200; // server limit per /workouts/sync
const MAX_PULL_ROUNDS = 50;

interface SyncMeta {
  /** Which server and account the snapshot below belongs to. */
  owner: string;
  cursor: number;
  workoutCursor: number;
  snapshot: Snapshot;
  publicWorkoutIds: string[];
  lastSyncedAt: number | null;
}

const emptyMeta = (owner: string): SyncMeta => ({ owner, cursor: 0, workoutCursor: 0, snapshot: {}, publicWorkoutIds: [], lastSyncedAt: null });

async function loadMeta(): Promise<SyncMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as SyncMeta) : null;
  } catch {
    return null;
  }
}
function saveMeta(meta: SyncMeta) {
  AsyncStorage.setItem(META_KEY, JSON.stringify(meta)).catch(() => undefined);
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error';

export interface SyncReport {
  pushed: number;
  received: number;
  rejected: number;
}

interface Ctx {
  status: SyncStatus;
  lastSyncedAt: number | null;
  lastError: string | null;
  /** Syncs now. Rejects with a readable message if the server cannot be reached. */
  syncNow: () => Promise<SyncReport>;
  isWorkoutPublic: (id: string) => boolean;
  setWorkoutPublic: (id: string, on: boolean) => void;
}

const CloudSyncContext = createContext<Ctx | null>(null);

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Splits changes into batches of at most `size` records in total. */
function batches(changes: Changes, size: number): Changes[] {
  const flat: [Collection, SyncRecord][] = [];
  for (const [c, list] of Object.entries(changes) as [Collection, SyncRecord[]][]) for (const r of list) flat.push([c, r]);
  return chunk(flat, size).map((part) => {
    const b: Changes = {};
    for (const [c, r] of part) (b[c] ??= []).push(r);
    return b;
  });
}

export function CloudSyncProvider({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const auth = useAuth();
  const signedIn = !!auth.sessionToken && !!auth.user;

  const [status, setStatus] = useState<SyncStatus>('off');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [publicIds, setPublicIds] = useState<Set<string>>(new Set());

  // Always the latest app state, so a sync that started earlier still merges into current data.
  const stateRef = useRef(app);
  stateRef.current = app;
  const running = useRef<Promise<SyncReport> | null>(null);
  const pending = useRef(false);
  const lastRun = useRef(0);

  useEffect(() => {
    loadMeta().then((m) => {
      if (!m) return;
      setLastSyncedAt(m.lastSyncedAt);
      setPublicIds(new Set(m.publicWorkoutIds));
    });
  }, []);

  const runOnce = useCallback(async (): Promise<SyncReport> => {
    await refreshServer();
    const { backendUrl, appToken, sessionToken, user } = getAuth();
    if (!sessionToken || !user) return { pushed: 0, received: 0, rejected: 0 };
    const server = { backendUrl, appToken };
    const owner = `${backendUrl.trim().replace(/\/+$/, '')}|${user.username.toLowerCase()}`;

    let meta = await loadMeta();
    if (!meta || meta.owner !== owner) {
      // First sync for this account on this phone. If a *different* account
      // synced here before, what is on the phone belongs to that account, so
      // it is not uploaded into this one.
      const otherAccount = !!meta?.owner;
      const keptPublic = otherAccount ? [] : meta?.publicWorkoutIds ?? [];
      meta = { ...emptyMeta(owner), publicWorkoutIds: keptPublic };
      if (otherAccount) meta.snapshot = fingerprint(collect(syncableOf(stateRef.current)));
    }

    const local = syncableOf(stateRef.current);
    const changes = diff(collect(local), meta.snapshot, Date.now());
    const pushedCount = countChanges(changes);
    const publicSet = new Set(meta.publicWorkoutIds);

    // Workouts go through their own endpoints, because they can be public.
    const { workouts: workoutChanges = [], ...dataChanges } = changes;
    const toUpload = workoutChanges.filter((r) => !r.deleted).map((r) => local.workouts[r.id]).filter(Boolean);
    for (const part of chunk(toUpload, WORKOUT_BATCH)) await syncPush(server, sessionToken, part, publicSet);
    for (const r of workoutChanges.filter((x) => x.deleted)) await deleteRemote(server, sessionToken, r.id).catch(() => false);

    // Push in batches, then keep pulling while the server says there is more.
    const received = new Map<string, [Collection, SyncRecord]>();
    let rejected = 0;
    let since = meta.cursor;
    let cursor = since;
    let more = false;
    const rounds = batches(dataChanges, DATA_BATCH);
    if (rounds.length === 0) rounds.push({});
    for (let i = 0; i < MAX_PULL_ROUNDS && (i < rounds.length || more); i++) {
      const res = await syncData(server, sessionToken, i < rounds.length ? since : cursor, rounds[i] ?? {});
      for (const [c, list] of Object.entries(res.changes) as [Collection, SyncRecord[]][]) {
        for (const r of list) received.set(keyOf(c, r.id), [c, r]);
      }
      rejected += res.rejected.length;
      cursor = res.cursor;
      more = res.more;
    }

    const pulled = await pullWorkouts(server, sessionToken, Math.max(0, meta.workoutCursor - 5000));
    for (const w of pulled.workouts) {
      if (!w.endedAt) continue;
      received.set(keyOf('workouts', w.id), ['workouts', { id: w.id, updatedAt: w.endedAt, data: w }]);
      if (w.isPublic) publicSet.add(w.id);
      else publicSet.delete(w.id);
    }

    const incoming: Changes = {};
    for (const [c, r] of received.values()) (incoming[c] ??= []).push(r);
    if (received.size) stateRef.current.applyRemote(incoming);

    // Fingerprint what was received in its local form, so it does not look like a local edit next time.
    const afterMerge: Map<string, LocalRecord> = collect(applyRemote(syncableOf(stateRef.current), incoming));
    const now = Date.now();
    const next: SyncMeta = {
      owner,
      cursor,
      workoutCursor: pulled.syncedAt || meta.workoutCursor,
      snapshot: nextSnapshot(meta.snapshot, changes, afterMerge, [...received.keys()]),
      publicWorkoutIds: [...publicSet],
      lastSyncedAt: now,
    };
    saveMeta(next);
    setPublicIds(publicSet);
    setLastSyncedAt(now);
    return { pushed: pushedCount, received: received.size, rejected };
  }, []);

  const sync = useCallback(async (): Promise<SyncReport> => {
    if (running.current) {
      pending.current = true;
      return running.current;
    }
    setStatus('syncing');
    const p = runOnce()
      .then((report) => {
        setStatus('idle');
        setLastError(null);
        return report;
      })
      .catch((e: any) => {
        setStatus('error');
        setLastError(e?.message ?? 'Sync failed.');
        throw e;
      })
      .finally(() => {
        running.current = null;
        lastRun.current = Date.now();
        if (pending.current) {
          pending.current = false;
          sync().catch(() => undefined);
        }
      });
    running.current = p;
    return p;
  }, [runOnce]);

  // On sign-in (and on app start while signed in).
  useEffect(() => {
    if (!signedIn) {
      setStatus('off');
      return;
    }
    if (app.hydrated) sync().catch(() => undefined);
  }, [signedIn, app.hydrated, auth.user?.username, sync]);

  // A few seconds after local changes. Checks locally first, so merging
  // pulled data (which also changes state) does not trigger a pointless sync.
  useEffect(() => {
    if (!signedIn || !app.hydrated) return;
    const t = setTimeout(async () => {
      const meta = await loadMeta();
      if (!meta) return;
      if (countChanges(diff(collect(syncableOf(stateRef.current)), meta.snapshot, Date.now())) > 0) sync().catch(() => undefined);
    }, CHANGE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [signedIn, app.hydrated, app.profile, app.days, app.badges, app.recipes, app.training.routines, app.training.customExercises, app.training.workouts, sync]);

  // Coming back to the app: pick up what other phones did meanwhile.
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active' && getAuth().sessionToken && Date.now() - lastRun.current > FOREGROUND_MIN_GAP_MS) sync().catch(() => undefined);
    });
    return () => sub.remove();
  }, [sync]);

  const setWorkoutPublic = useCallback(
    (id: string, on: boolean) => {
      setPublicIds((cur) => {
        const next = new Set(cur);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
      (async () => {
        // Before the first sync there is no account yet; the choice is kept and applied then.
        const meta = (await loadMeta()) ?? emptyMeta('');
        const ids = new Set(meta.publicWorkoutIds);
        if (on) ids.add(id);
        else ids.delete(id);
        // Forget its fingerprint so the next sync uploads it with the new setting.
        const snapshot = { ...meta.snapshot };
        delete snapshot[keyOf('workouts', id)];
        saveMeta({ ...meta, publicWorkoutIds: [...ids], snapshot });
        if (getAuth().sessionToken) sync().catch(() => undefined);
      })();
    },
    [sync]
  );

  const value = useMemo<Ctx>(
    () => ({
      status,
      lastSyncedAt,
      lastError,
      syncNow: sync,
      isWorkoutPublic: (id) => publicIds.has(id),
      setWorkoutPublic,
    }),
    [status, lastSyncedAt, lastError, sync, publicIds, setWorkoutPublic]
  );

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}

export function useCloudSync(): Ctx {
  const ctx = useContext(CloudSyncContext);
  if (!ctx) throw new Error('useCloudSync must be used inside CloudSyncProvider');
  return ctx;
}
