/**
 * Personal data sync: the health profile, day logs, food logs, routines,
 * recipes, custom exercises and badges. Everything here is private to the
 * signed-in user; none of it appears on profiles or in feeds.
 *
 * Same shape as social.ts (Request in, Response out, database passed in) so
 * it is tested in Node against fakeD1.
 *
 * Conflicts resolve by "newer edit wins", using the phone's updatedAt. A
 * deletion is stored as a tombstone (deleted = true) so other phones learn
 * about it on their next sync.
 *
 * Endpoints (all need Authorization: Bearer <session token>):
 *   POST   /sync                       { since, changes: { <collection>: [record] } }
 *                                      pushes local changes and pulls everything newer than `since`
 *   GET    /data/:collection?since=<ms>
 *   PUT    /data/:collection/:id       { updatedAt?, data }
 *   DELETE /data/:collection/:id
 *
 * A record is { id, updatedAt, deleted?, data? }.
 * Collections: profile, days, foods, routines, recipes, exercises, badges.
 */

import * as db from './db';
import type { D1Database, PersonalTable } from './db';
import { currentUser } from './social';

const MAX_RECORDS_PER_SYNC = 500;
const MAX_RECORD_BYTES = 64_000;
const MAX_ID_LENGTH = 100;
const PULL_LIMIT = 2000;
/** A phone whose clock runs ahead must not win every future conflict, so its timestamps are capped near server time. */
const MAX_CLOCK_AHEAD_MS = 60_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isNum = (n: unknown): n is number => typeof n === 'number' && isFinite(n);
const numOrNull = (n: unknown) => (isNum(n) ? n : null);
const isObj = (o: unknown): o is Record<string, any> => !!o && typeof o === 'object' && !Array.isArray(o);

interface Collection {
  table: PersonalTable;
  /** Checks a record's id and data; returns a reason when it is not acceptable. Not called for deletions. */
  check(id: string, data: Record<string, any>): string | null;
  /** The queryable columns copied out of data. Null for a deletion. */
  typed(data: Record<string, any> | null): Record<string, unknown>;
}

const named = (table: PersonalTable): Collection => ({
  table,
  check: (_id, d) => (typeof d.name === 'string' && d.name.trim() ? null : 'needs a name'),
  typed: (d) => ({ name: typeof d?.name === 'string' ? d.name.slice(0, 120) : null }),
});

export const COLLECTIONS: Record<string, Collection> = {
  profile: {
    table: 'health_profiles',
    check: (id, d) =>
      id !== 'profile' ? 'id must be "profile"' : !isNum(d.weightKg) || d.weightKg <= 0 ? 'needs weightKg' : typeof d.goal !== 'string' ? 'needs a goal' : null,
    typed: (d) => ({ weight_kg: numOrNull(d?.weightKg), goal: typeof d?.goal === 'string' ? d.goal : null }),
  },
  days: {
    table: 'day_logs',
    check: (id) => (DATE_RE.test(id) ? null : 'id must be a date, YYYY-MM-DD'),
    typed: (d) => ({ steps: numOrNull(d?.steps), gym_burn_kcal: numOrNull(d?.gymBurn), sleep_recovery: numOrNull(d?.sleep?.recoveryScore) }),
  },
  foods: {
    table: 'food_logs',
    check: (_id, d) => (typeof d.date !== 'string' || !DATE_RE.test(d.date) ? 'needs a date, YYYY-MM-DD' : !isNum(d.kcal) ? 'needs kcal' : null),
    typed: (d) => ({
      log_date: typeof d?.date === 'string' ? d.date : null,
      kcal: numOrNull(d?.kcal),
      protein_g: numOrNull(d?.protein),
      carbs_g: numOrNull(d?.carbs),
      fat_g: numOrNull(d?.fat),
    }),
  },
  routines: named('routines'),
  recipes: named('recipes'),
  exercises: named('custom_exercises'),
  badges: {
    table: 'badges',
    check: (_id, d) => (isNum(d.unlockedAt) ? null : 'needs unlockedAt'),
    typed: (d) => ({ unlocked_at: numOrNull(d?.unlockedAt) }),
  },
};

export interface SyncRecord {
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: unknown;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
const fail = (status: number, error: string) => json({ error }, status);

function toRecord(row: db.PersonalRow): SyncRecord {
  let data: unknown = null;
  if (!row.deleted) {
    try {
      data = JSON.parse(row.data);
    } catch {
      data = null;
    }
  }
  return { id: row.id, updatedAt: row.updated_at, deleted: !!row.deleted, data };
}

/**
 * Validates and stores one record. Returns 'applied', 'stale' (the server
 * already had a newer version) or a rejection reason.
 */
async function write(database: D1Database, userId: string, coll: Collection, raw: any, now: number): Promise<'applied' | 'stale' | { reason: string }> {
  const id = raw?.id;
  if (typeof id !== 'string' || !id || id.length > MAX_ID_LENGTH) return { reason: 'needs an id' };
  if (!isNum(raw?.updatedAt) || raw.updatedAt <= 0) return { reason: 'needs updatedAt' };
  const deleted = raw?.deleted === true;

  let dataStr = '{}';
  if (!deleted) {
    if (!isObj(raw?.data)) return { reason: 'needs data' };
    const problem = coll.check(id, raw.data);
    if (problem) return { reason: problem };
    dataStr = JSON.stringify(raw.data);
    if (dataStr.length > MAX_RECORD_BYTES) return { reason: 'too large' };
  }

  const ok = await db.upsertPersonal(
    database,
    coll.table,
    userId,
    {
      id,
      updatedAt: Math.min(raw.updatedAt, now + MAX_CLOCK_AHEAD_MS),
      deleted,
      data: dataStr,
      typed: coll.typed(deleted ? null : raw.data),
    },
    now
  );
  return ok ? 'applied' : 'stale';
}

// ---------------------------------------------------------------------------
// POST /sync
// ---------------------------------------------------------------------------

async function sync(req: Request, database: D1Database): Promise<Response> {
  const user = await currentUser(req, database);
  if (!user) return fail(401, 'Sign in first.');
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Send JSON with "since" and "changes".');
  }
  const since = isNum(body?.since) && body.since > 0 ? body.since : 0;
  const changes = isObj(body?.changes) ? body.changes : {};

  const unknown = Object.keys(changes).filter((k) => !COLLECTIONS[k]);
  if (unknown.length) return fail(400, `Unknown collection: ${unknown.join(', ')}.`);
  const total = Object.values(changes).reduce((n: number, list) => n + (Array.isArray(list) ? list.length : 0), 0);
  if (total > MAX_RECORDS_PER_SYNC) return fail(413, `Send at most ${MAX_RECORDS_PER_SYNC} records per sync.`);

  const now = Date.now();
  let applied = 0;
  const rejected: { collection: string; id: string; reason: string }[] = [];
  // What this request wrote, so the pull below does not echo it straight back.
  const written = new Set<string>();
  // Records the server already had newer versions of: the phone must be sent those versions.
  const stale: { collection: string; id: string }[] = [];

  for (const [name, list] of Object.entries(changes)) {
    if (!Array.isArray(list)) continue;
    const coll = COLLECTIONS[name];
    for (const raw of list) {
      const result = await write(database, user.id, coll, raw, now);
      if (result === 'applied') {
        applied++;
        written.add(`${name}:${raw.id}`);
      } else if (result === 'stale') {
        stale.push({ collection: name, id: raw.id });
      } else {
        rejected.push({ collection: name, id: typeof raw?.id === 'string' ? raw.id : '', reason: result.reason });
      }
    }
  }

  // Read the cursor before reading rows: anything stored after this moment is
  // picked up next time, and ">=" makes a repeated boundary row harmless.
  const cursorBase = Date.now();
  const out: Record<string, SyncRecord[]> = {};
  let more = false;
  let cursor = cursorBase;

  for (const [name, coll] of Object.entries(COLLECTIONS)) {
    const rows = await db.listPersonalSince(database, coll.table, user.id, since, PULL_LIMIT);
    if (rows.length === PULL_LIMIT) {
      more = true;
      cursor = Math.min(cursor, rows[rows.length - 1].synced_at);
    }
    const records = rows.filter((r) => !written.has(`${name}:${r.id}`)).map(toRecord);
    if (records.length) out[name] = records;
  }

  for (const s of stale) {
    const row = await db.findPersonal(database, COLLECTIONS[s.collection].table, user.id, s.id);
    if (!row) continue;
    const list = (out[s.collection] ??= []);
    if (!list.some((r) => r.id === row.id)) list.push(toRecord(row));
  }

  return json({ applied, rejected, changes: out, cursor, more });
}

// ---------------------------------------------------------------------------
// /data/:collection[/:id]
// ---------------------------------------------------------------------------

async function list(name: string, url: URL, req: Request, database: D1Database): Promise<Response> {
  const user = await currentUser(req, database);
  if (!user) return fail(401, 'Sign in first.');
  const since = parseInt(url.searchParams.get('since') ?? '0', 10);
  const cursor = Date.now();
  const rows = await db.listPersonalSince(database, COLLECTIONS[name].table, user.id, isFinite(since) && since > 0 ? since : 0, PULL_LIMIT);
  const more = rows.length === PULL_LIMIT;
  return json({ records: rows.map(toRecord), cursor: more ? rows[rows.length - 1].synced_at : cursor, more });
}

async function put(name: string, id: string, req: Request, database: D1Database): Promise<Response> {
  const user = await currentUser(req, database);
  if (!user) return fail(401, 'Sign in first.');
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Send JSON with "data".');
  }
  const now = Date.now();
  const updatedAt = isNum(body?.updatedAt) ? body.updatedAt : now;
  const result = await write(database, user.id, COLLECTIONS[name], { id, updatedAt, data: body?.data }, now);
  if (typeof result === 'object') return fail(400, `Not saved: ${result.reason}.`);
  const row = await db.findPersonal(database, COLLECTIONS[name].table, user.id, id);
  return json({ applied: result === 'applied', record: row ? toRecord(row) : null });
}

async function remove(name: string, id: string, req: Request, database: D1Database): Promise<Response> {
  const user = await currentUser(req, database);
  if (!user) return fail(401, 'Sign in first.');
  const now = Date.now();
  const result = await write(database, user.id, COLLECTIONS[name], { id, updatedAt: now, deleted: true }, now);
  if (typeof result === 'object') return fail(400, `Not deleted: ${result.reason}.`);
  return json({ applied: result === 'applied' });
}

// ---------------------------------------------------------------------------

export async function handleData(req: Request, database: D1Database): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  try {
    if (m === 'POST' && path === '/sync') return await sync(req, database);

    const coll = path.match(/^\/data\/([^/]+)$/);
    if (coll && m === 'GET') {
      const name = decodeURIComponent(coll[1]);
      return COLLECTIONS[name] ? await list(name, url, req, database) : fail(404, 'Unknown collection.');
    }

    const item = path.match(/^\/data\/([^/]+)\/([^/]+)$/);
    if (item && (m === 'PUT' || m === 'DELETE')) {
      const name = decodeURIComponent(item[1]);
      const id = decodeURIComponent(item[2]);
      if (!COLLECTIONS[name]) return fail(404, 'Unknown collection.');
      return m === 'PUT' ? await put(name, id, req, database) : await remove(name, id, req, database);
    }
  } catch (e) {
    console.error('data handler error', e instanceof Error ? e.message : 'unknown');
    return fail(500, 'Something went wrong on the server.');
  }

  return null;
}
