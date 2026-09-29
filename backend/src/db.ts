/**
 * D1 (Cloudflare's SQLite) schema and access layer for accounts and social
 * features. Kept separate from handler.ts, which stays the food/photo API.
 *
 * D1 is the right fit here: it is relational data with real constraints
 * (a username is unique, a follow references two real users), which KV
 * cannot express, and the free tier (5 GB, 5M rows read/day) comfortably
 * covers a hackathon's usage.
 */

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/** Run once against a fresh database (`wrangler d1 execute ... --file=schema.sql`). */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  username_lc   TEXT NOT NULL UNIQUE,
  email_lc      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  is_public     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- One row per workout a user has chosen to sync. is_public controls whether
-- it can appear on their public profile and in others' feeds; it never makes
-- a workout visible on its own; see /profile below.
CREATE TABLE IF NOT EXISTS workouts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER NOT NULL,
  is_public    INTEGER NOT NULL DEFAULT 0,
  data         TEXT NOT NULL, -- JSON: exercises/sets, as the app already models them
  synced_at    INTEGER NOT NULL,
  copied_from  TEXT REFERENCES workouts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_workouts_user ON workouts(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_workouts_public ON workouts(is_public, started_at);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followed_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id);

CREATE TABLE IF NOT EXISTS likes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, workout_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_workout ON likes(workout_id);

-- ---------------------------------------------------------------------------
-- Personal data: everything the app keeps on the phone, mirrored here so it
-- survives a lost phone and follows the user to a new one. Private to its
-- owner; nothing below is ever shown on a profile or in a feed.
--
-- Every table has the same sync columns:
--   id          the app's own id for the record, unique per user
--   updated_at  when a phone last changed it (ms); the newer write wins
--   synced_at   when the server stored it (ms); "changes since" reads this
--   deleted     1 = removed on some phone, kept so other phones remove it too
--   data        the record as JSON, in the app's own shape
-- and a few typed columns copied out of data, so it can be queried directly.
-- ---------------------------------------------------------------------------

-- Body stats, goal and plan settings from onboarding. One row per user (id is always 'profile').
CREATE TABLE IF NOT EXISTS health_profiles (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at  INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,
  weight_kg  REAL,
  goal       TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_health_profiles_sync ON health_profiles(user_id, synced_at);

-- One row per calendar day: steps, gym burn and the sleep score. id is the date, YYYY-MM-DD.
CREATE TABLE IF NOT EXISTS day_logs (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id             TEXT NOT NULL,
  updated_at     INTEGER NOT NULL,
  synced_at      INTEGER NOT NULL,
  deleted        INTEGER NOT NULL DEFAULT 0,
  data           TEXT NOT NULL,
  steps          INTEGER,
  gym_burn_kcal  REAL,
  sleep_recovery REAL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_day_logs_sync ON day_logs(user_id, synced_at);

-- One row per food eaten.
CREATE TABLE IF NOT EXISTS food_logs (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at  INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,
  log_date   TEXT,
  kcal       REAL,
  protein_g  REAL,
  carbs_g    REAL,
  fat_g      REAL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_food_logs_sync ON food_logs(user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_food_logs_date ON food_logs(user_id, log_date);

-- Workout templates the user built, generated or copied.
CREATE TABLE IF NOT EXISTS routines (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at  INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,
  name       TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_routines_sync ON routines(user_id, synced_at);

-- Saved meals with their ingredients.
CREATE TABLE IF NOT EXISTS recipes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at  INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,
  name       TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_recipes_sync ON recipes(user_id, synced_at);

-- Exercises the user added that are not in the built-in library.
CREATE TABLE IF NOT EXISTS custom_exercises (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at  INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,
  name       TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_custom_exercises_sync ON custom_exercises(user_id, synced_at);

-- Achievements unlocked. id is the badge id.
CREATE TABLE IF NOT EXISTS badges (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  synced_at   INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  data        TEXT NOT NULL,
  unlocked_at INTEGER,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_badges_sync ON badges(user_id, synced_at);
`;

// ---------------------------------------------------------------------------
// Rows, as SQLite returns them (snake_case, 0/1 for booleans)
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  is_public: number;
  created_at: number;
}
export interface WorkoutRow {
  id: string;
  user_id: string;
  name: string;
  started_at: number;
  ended_at: number;
  is_public: number;
  data: string;
  synced_at: number;
  copied_from: string | null;
}

const now = () => Date.now();

// ---------------------------------------------------------------------------
// Users and sessions
// ---------------------------------------------------------------------------

export async function createUser(
  db: D1Database,
  row: { id: string; username: string; emailLc: string; passwordHash: string; passwordSalt: string; displayName: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, username, username_lc, email_lc, password_hash, password_salt, display_name, bio, is_public, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', 0, ?)`
    )
    .bind(row.id, row.username, row.username.toLowerCase(), row.emailLc, row.passwordHash, row.passwordSalt, row.displayName, now())
    .run();
}

export async function findUserByEmail(db: D1Database, emailLc: string) {
  return db.prepare(`SELECT * FROM users WHERE email_lc = ?`).bind(emailLc).first<UserRow & { password_hash: string; password_salt: string }>();
}
export async function findUserByUsername(db: D1Database, username: string) {
  return db.prepare(`SELECT * FROM users WHERE username_lc = ?`).bind(username.toLowerCase()).first<UserRow>();
}

/** Same lookup, but including the password fields, for the login check. */
export async function findAuthByUsername(db: D1Database, username: string) {
  return db
    .prepare(`SELECT * FROM users WHERE username_lc = ?`)
    .bind(username.toLowerCase())
    .first<UserRow & { password_hash: string; password_salt: string }>();
}
export async function findUserById(db: D1Database, id: string) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>();
}
export async function updateProfile(db: D1Database, userId: string, patch: { displayName?: string; bio?: string; isPublic?: boolean }) {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.displayName !== undefined) {
    sets.push('display_name = ?');
    args.push(patch.displayName);
  }
  if (patch.bio !== undefined) {
    sets.push('bio = ?');
    args.push(patch.bio);
  }
  if (patch.isPublic !== undefined) {
    sets.push('is_public = ?');
    args.push(patch.isPublic ? 1 : 0);
  }
  if (sets.length === 0) return;
  args.push(userId);
  await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
}

export async function createSession(db: D1Database, token: string, userId: string, ttlMs: number): Promise<void> {
  const t = now();
  await db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).bind(token, userId, t, t + ttlMs).run();
}
export async function findSession(db: D1Database, token: string) {
  return db.prepare(`SELECT user_id, expires_at FROM sessions WHERE token = ?`).bind(token).first<{ user_id: string; expires_at: number }>();
}
export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
}

// ---------------------------------------------------------------------------
// Workouts (sync)
// ---------------------------------------------------------------------------

/** Insert or update one workout. A user can only ever write their own rows: userId is not taken from the caller's body. */
export async function upsertWorkout(
  db: D1Database,
  userId: string,
  w: { id: string; name: string; startedAt: number; endedAt: number; isPublic: boolean; data: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workouts (id, user_id, name, started_at, ended_at, is_public, data, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, started_at = excluded.started_at, ended_at = excluded.ended_at,
         is_public = excluded.is_public, data = excluded.data, synced_at = excluded.synced_at
       WHERE workouts.user_id = ?`
    )
    .bind(w.id, userId, w.name, w.startedAt, w.endedAt, w.isPublic ? 1 : 0, w.data, now(), userId)
    .run();
}

export async function listUserWorkouts(db: D1Database, userId: string, sinceMs = 0) {
  return (
    await db.prepare(`SELECT * FROM workouts WHERE user_id = ? AND synced_at > ? ORDER BY started_at DESC`).bind(userId, sinceMs).all<WorkoutRow>()
  ).results;
}

export async function deleteWorkout(db: D1Database, userId: string, id: string): Promise<boolean> {
  const r = await db.prepare(`DELETE FROM workouts WHERE id = ? AND user_id = ?`).bind(id, userId).run();
  return r.meta.changes > 0;
}

export async function findWorkout(db: D1Database, id: string) {
  return db.prepare(`SELECT * FROM workouts WHERE id = ?`).bind(id).first<WorkoutRow>();
}

export async function publicWorkoutsFor(db: D1Database, userId: string, limit: number) {
  return (
    await db
      .prepare(`SELECT * FROM workouts WHERE user_id = ? AND is_public = 1 ORDER BY started_at DESC LIMIT ?`)
      .bind(userId, limit)
      .all<WorkoutRow>()
  ).results;
}

/** Public workouts from people `userId` follows, newest first. The feed. */
export async function feedFor(db: D1Database, userId: string, limit: number, beforeMs?: number) {
  return (
    await db
      .prepare(
        `SELECT w.* FROM workouts w
         JOIN follows f ON f.followed_id = w.user_id
         WHERE f.follower_id = ? AND w.is_public = 1 ${beforeMs ? 'AND w.started_at < ?' : ''}
         ORDER BY w.started_at DESC LIMIT ?`
      )
      .bind(...(beforeMs ? [userId, beforeMs, limit] : [userId, limit]))
      .all<WorkoutRow>()
  ).results;
}

// ---------------------------------------------------------------------------
// Follows and likes
// ---------------------------------------------------------------------------

export async function follow(db: D1Database, followerId: string, followedId: string): Promise<void> {
  await db.prepare(`INSERT OR IGNORE INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)`).bind(followerId, followedId, now()).run();
}
export async function unfollow(db: D1Database, followerId: string, followedId: string): Promise<void> {
  await db.prepare(`DELETE FROM follows WHERE follower_id = ? AND followed_id = ?`).bind(followerId, followedId).run();
}
export async function isFollowing(db: D1Database, followerId: string, followedId: string): Promise<boolean> {
  return (await db.prepare(`SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?`).bind(followerId, followedId).first()) !== null;
}
export async function followCounts(db: D1Database, userId: string): Promise<{ followers: number; following: number }> {
  const [a, b] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as n FROM follows WHERE followed_id = ?`).bind(userId).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) as n FROM follows WHERE follower_id = ?`).bind(userId).first<{ n: number }>(),
  ]);
  return { followers: a?.n ?? 0, following: b?.n ?? 0 };
}

export async function like(db: D1Database, userId: string, workoutId: string): Promise<void> {
  await db.prepare(`INSERT OR IGNORE INTO likes (user_id, workout_id, created_at) VALUES (?, ?, ?)`).bind(userId, workoutId, now()).run();
}
export async function unlike(db: D1Database, userId: string, workoutId: string): Promise<void> {
  await db.prepare(`DELETE FROM likes WHERE user_id = ? AND workout_id = ?`).bind(userId, workoutId).run();
}
export async function likeCount(db: D1Database, workoutId: string): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) as n FROM likes WHERE workout_id = ?`).bind(workoutId).first<{ n: number }>())?.n ?? 0;
}
export async function hasLiked(db: D1Database, userId: string, workoutId: string): Promise<boolean> {
  return (await db.prepare(`SELECT 1 FROM likes WHERE user_id = ? AND workout_id = ?`).bind(userId, workoutId).first()) !== null;
}

// ---------------------------------------------------------------------------
// Personal data (sync)
// ---------------------------------------------------------------------------

/** Table names are only ever taken from this list, never from a request. */
export type PersonalTable = 'health_profiles' | 'day_logs' | 'food_logs' | 'routines' | 'recipes' | 'custom_exercises' | 'badges';

export interface PersonalRow {
  user_id: string;
  id: string;
  updated_at: number;
  synced_at: number;
  deleted: number;
  data: string;
}

/**
 * Insert or update one record, but only if it is at least as new as what is
 * stored: a phone that was offline for a week cannot overwrite a newer edit
 * made on another phone. Returns false when the stored row was newer.
 *
 * `typed` are the table's queryable columns, already extracted from data by
 * the caller. Their names come from code, never from the request.
 */
export async function upsertPersonal(
  db: D1Database,
  table: PersonalTable,
  userId: string,
  rec: { id: string; updatedAt: number; deleted: boolean; data: string; typed: Record<string, unknown> },
  syncedAt: number
): Promise<boolean> {
  const typedCols = Object.keys(rec.typed);
  const cols = ['user_id', 'id', 'updated_at', 'synced_at', 'deleted', 'data', ...typedCols];
  const sets = ['updated_at', 'synced_at', 'deleted', 'data', ...typedCols].map((c) => `${c} = excluded.${c}`);
  const r = await db
    .prepare(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT(user_id, id) DO UPDATE SET ${sets.join(', ')}
       WHERE ${table}.updated_at <= excluded.updated_at`
    )
    .bind(userId, rec.id, rec.updatedAt, syncedAt, rec.deleted ? 1 : 0, rec.data, ...typedCols.map((c) => rec.typed[c]))
    .run();
  return r.meta.changes > 0;
}

export async function findPersonal(db: D1Database, table: PersonalTable, userId: string, id: string) {
  return db.prepare(`SELECT * FROM ${table} WHERE user_id = ? AND id = ?`).bind(userId, id).first<PersonalRow>();
}

/** Everything stored since `sinceMs` (inclusive, so a repeated boundary row is harmless), oldest first. */
export async function listPersonalSince(db: D1Database, table: PersonalTable, userId: string, sinceMs: number, limit: number) {
  return (
    await db
      .prepare(`SELECT * FROM ${table} WHERE user_id = ? AND synced_at >= ? ORDER BY synced_at ASC LIMIT ?`)
      .bind(userId, sinceMs, limit)
      .all<PersonalRow>()
  ).results;
}
