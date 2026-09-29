-- Run once against a fresh D1 database:
--   npx.cmd wrangler d1 execute vitalx-db --remote --file=schema.sql
-- The same statements also live in src/db.ts (SCHEMA), which is what the
-- tests import, so the two are checked to match by tests/schema.test.ts.

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
