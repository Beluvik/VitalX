/**
 * Accounts and social features: sign up/in, cross-device workout sync,
 * public profiles, follow, like, copy, feed.
 *
 * Same shape as handler.ts (Request in, Response out, D1Database passed in
 * as a plain argument) so it is tested in Node with a fake database and never
 * needs a real deployment to verify.
 *
 * Endpoints:
 *   POST /auth/signup        { username, email, password, displayName? }
 *   POST /auth/login         { emailOrUsername, password }
 *   POST /auth/logout
 *   GET  /auth/me
 *   PATCH /me/profile        { displayName?, bio?, isPublic? }
 *
 *   POST /workouts/sync      { workouts: [...] }              (push local workouts up)
 *   GET  /workouts/sync?since=<ms>                              (pull what's new)
 *   DELETE /workouts/:id
 *
 *   GET  /profile/:username                                    (public profile + their public workouts)
 *   POST /profile/:username/follow
 *   DELETE /profile/:username/follow
 *
 *   POST /workouts/:id/like
 *   DELETE /workouts/:id/like
 *   POST /workouts/:id/copy                                    (returns a routine to import locally)
 *
 *   GET  /feed?before=<ms>
 */

import { hashPassword, newId, newSessionToken, passwordProblem, validEmail, validUsername, verifyPassword } from './auth';
import * as db from './db';
import type { D1Database } from './db';

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const MAX_SYNC_BATCH = 200;
const MAX_BIO = 300;
const MAX_DISPLAY_NAME = 60;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
const fail = (status: number, error: string) => json({ error }, status);

function publicUser(u: db.UserRow) {
  return { username: u.username, displayName: u.display_name, bio: u.bio, isPublic: !!u.is_public, createdAt: u.created_at };
}

/** A workout row as the app's own Workout shape, for the client to consume directly. */
function publicWorkout(w: db.WorkoutRow) {
  let data: unknown = {};
  try {
    data = JSON.parse(w.data);
  } catch {
    data = {};
  }
  return { id: w.id, name: w.name, startedAt: w.started_at, endedAt: w.ended_at, isPublic: !!w.is_public, ...((data as object) ?? {}) };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function currentUser(req: Request, database: D1Database): Promise<db.UserRow | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const session = await db.findSession(database, token);
  if (!session || session.expires_at < Date.now()) return null;
  return db.findUserById(database, session.user_id);
}

async function signup(req: Request, database: D1Database): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Send JSON with username, email and password.');
  }
  const username = String(body?.username ?? '').trim();
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  const displayName = String(body?.displayName ?? username).trim().slice(0, MAX_DISPLAY_NAME) || username;

  if (!validUsername(username)) return fail(400, 'Username must be 3 to 20 characters: lowercase letters, numbers, underscore.');
  if (!validEmail(email)) return fail(400, 'Enter a real email address.');
  const pwProblem = passwordProblem(password);
  if (pwProblem) return fail(400, pwProblem);

  if (await db.findUserByUsername(database, username)) return fail(409, 'That username is taken.');
  if (await db.findUserByEmail(database, email)) return fail(409, 'An account already exists for that email.');

  const { hash, salt } = await hashPassword(password);
  const id = newId('u');
  await db.createUser(database, { id, username, emailLc: email, passwordHash: hash, passwordSalt: salt, displayName });

  const token = newSessionToken();
  await db.createSession(database, token, id, SESSION_TTL_MS);
  const user = await db.findUserById(database, id);
  return json({ token, user: publicUser(user as db.UserRow) }, 201);
}

async function login(req: Request, database: D1Database): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Send JSON with emailOrUsername and password.');
  }
  const idf = String(body?.emailOrUsername ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  if (!idf || !password) return fail(400, 'Enter your email or username and password.');

  const row = idf.includes('@') ? await db.findUserByEmail(database, idf) : await db.findAuthByUsername(database, idf);
  // Deliberately the same message either way, so a login attempt cannot be
  // used to discover which usernames or emails have accounts.
  const wrong = () => fail(401, 'Wrong email/username or password.');
  if (!row) return wrong();

  const good = await verifyPassword(password, row.password_hash, row.password_salt);
  if (!good) return wrong();

  const token = newSessionToken();
  await db.createSession(database, token, row.id, SESSION_TTL_MS);
  return json({ token, user: publicUser(row) });
}

async function logout(req: Request, database: D1Database): Promise<Response> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token) await db.deleteSession(database, token);
  return json({ ok: true });
}

async function me(req: Request, database: D1Database): Promise<Response> {
  const user = await currentUser(req, database);
  if (!user) return fail(401, 'Sign in first.');
  return json({ user: publicUser(user) });
}

async function updateMe(req: Request, database: D1Database): Promise<Response> {
  const user = await currentUser(req, database);
  if (!user) return fail(401, 'Sign in first.');
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Send JSON to update.');
  }
  const patch: { displayName?: string; bio?: string; isPublic?: boolean } = {};
  if (typeof body?.displayName === 'string') {
    const d = body.displayName.trim();
    if (!d) return fail(400, 'Display name cannot be empty.');
    patch.displayName = d.slice(0, MAX_DISPLAY_NAME);
  }
  if (typeof body?.bio === 'string') patch.bio = body.bio.slice(0, MAX_BIO);
  if (typeof body?.isPublic === 'boolean') patch.isPublic = body.isPublic;
  await db.updateProfile(database, user.id, patch);
  const updated = await db.findUserById(database, user.id);
  return json({ user: publicUser(updated as db.UserRow) });
}

// ---------------------------------------------------------------------------
// Workout sync
// ---------------------------------------------------------------------------

function validWorkoutInput(w: any): w is { id: string; name: string; startedAt: number; endedAt: number; isPublic: boolean; data: unknown } {
  return (
    typeof w?.id === 'string' &&
    w.id.length > 0 &&
    w.id.length <= 100 &&
    typeof w?.name === 'string' &&
    typeof w?.startedAt === 'number' &&
    isFinite(w.startedAt) &&
    typeof w?.endedAt === 'number' &&
    isFinite(w.endedAt) &&
    typeof w?.isPublic === 'boolean'
  );
}

async function syncPush(req: Request, database: D1Database): Promise<Response> {
  const user = await currentUser(req, database);
  if (!user) return fail(401, 'Sign in first.');
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Send JSON with a "workouts" array.');
  }
  const list = Array.isArray(body?.workouts) ? body.workouts : null;
  if (!list) return fail(400, 'Send JSON with a "workouts" array.');
  if (list.length > MAX_SYNC_BATCH) return fail(413, `Send at most ${MAX_SYNC_BATCH} workouts per sync.`);

  let saved = 0;
  const rejected: string[] = [];
  for (const w of list) {
    if (!validWorkoutInput(w)) {
      if (typeof w?.id === 'string') rejected.push(w.id);
      continue;
    }
    const dataStr = JSON.stringify(w.data ?? {});
    if (dataStr.length > 100_000) {
      rejected.push(w.id);
      continue;
    }
    // The signed-in user owns every row they write; there is no way to pass
    // someone else's id in and have it accepted.
    await db.upsertWorkout(database, user.id, {
      id: w.id,
      name: w.name.slice(0, 120),
      startedAt: w.startedAt,
      endedAt: w.endedAt,
      isPublic: w.isPublic,
      data: dataStr,
    });
    saved++;
  }
  return json({ saved, rejected });
}

async function syncPull(url: URL, req: Request, database: D1Database): Promise<Response> {
  const user = await currentUser(req, database);
  if (!user) return fail(401, 'Sign in first.');
  const since = parseInt(url.searchParams.get('since') ?? '0', 10);
  const rows = await db.listUserWorkouts(database, user.id, isFinite(since) && since > 0 ? since : 0);
  return json({ workouts: rows.map(publicWorkout), syncedAt: Date.now() });
}

async function deleteWorkout(id: string, req: Request, database: D1Database): Promise<Response> {
  const user = await currentUser(req, database);
  if (!user) return fail(401, 'Sign in first.');
  const removed = await db.deleteWorkout(database, user.id, id);
  return json({ removed });
}

// ---------------------------------------------------------------------------
// Profiles and follows
// ---------------------------------------------------------------------------

async function profile(username: string, req: Request, database: D1Database): Promise<Response> {
  const target = await db.findUserByUsername(database, username);
  if (!target) return fail(404, 'No account with that username.');

  const viewer = await currentUser(req, database);
  const counts = await db.followCounts(database, target.id);
  const isSelf = viewer?.id === target.id;

  if (!target.is_public && !isSelf) {
    return json({ user: publicUser(target), followers: counts.followers, following: counts.following, workouts: [], private: true });
  }

  const workouts = isSelf ? await db.listUserWorkouts(database, target.id) : await db.publicWorkoutsFor(database, target.id, 50);
  const withLikes = await Promise.all(
    workouts.map(async (w) => ({
      ...publicWorkout(w),
      likes: await db.likeCount(database, w.id),
      likedByMe: viewer ? await db.hasLiked(database, viewer.id, w.id) : false,
    }))
  );

  return json({
    user: publicUser(target),
    followers: counts.followers,
    following: counts.following,
    isFollowing: viewer ? await db.isFollowing(database, viewer.id, target.id) : false,
    isSelf,
    workouts: withLikes,
  });
}

async function setFollow(username: string, req: Request, database: D1Database, on: boolean): Promise<Response> {
  const viewer = await currentUser(req, database);
  if (!viewer) return fail(401, 'Sign in first.');
  const target = await db.findUserByUsername(database, username);
  if (!target) return fail(404, 'No account with that username.');
  if (target.id === viewer.id) return fail(400, 'You cannot follow yourself.');
  if (on) await db.follow(database, viewer.id, target.id);
  else await db.unfollow(database, viewer.id, target.id);
  return json({ following: on });
}

// ---------------------------------------------------------------------------
// Likes and copy
// ---------------------------------------------------------------------------

async function setLike(workoutId: string, req: Request, database: D1Database, on: boolean): Promise<Response> {
  const viewer = await currentUser(req, database);
  if (!viewer) return fail(401, 'Sign in first.');
  const w = await db.findWorkout(database, workoutId);
  if (!w || !w.is_public) return fail(404, 'Workout not found.');
  if (on) await db.like(database, viewer.id, workoutId);
  else await db.unlike(database, viewer.id, workoutId);
  return json({ liked: on, likes: await db.likeCount(database, workoutId) });
}

async function copyWorkout(workoutId: string, req: Request, database: D1Database): Promise<Response> {
  const viewer = await currentUser(req, database);
  if (!viewer) return fail(401, 'Sign in first.');
  const w = await db.findWorkout(database, workoutId);
  if (!w || !w.is_public) return fail(404, 'Workout not found.');
  let data: any = {};
  try {
    data = JSON.parse(w.data);
  } catch {
    data = {};
  }
  // Copying hands back a routine shape (exercises and target sets, no one
  // else's logged weights), which the app imports as a new local routine.
  const exercises = Array.isArray(data?.exercises)
    ? data.exercises.map((e: any, i: number) => ({
        exerciseId: e?.exerciseId,
        order: i,
        targetSets: Array.isArray(e?.sets) ? e.sets.filter((s: any) => !s?.isWarmup).length || 3 : 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        restSeconds: 90,
      }))
    : [];
  return json({ routine: { name: `${w.name} (copied)`, exercises } });
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

async function feed(url: URL, req: Request, database: D1Database): Promise<Response> {
  const viewer = await currentUser(req, database);
  if (!viewer) return fail(401, 'Sign in first.');
  const before = parseInt(url.searchParams.get('before') ?? '', 10);
  const rows = await db.feedFor(database, viewer.id, 30, isFinite(before) ? before : undefined);
  const withLikes = await Promise.all(
    rows.map(async (w) => ({
      ...publicWorkout(w),
      author: await db.findUserById(database, w.user_id).then((u) => u?.username ?? 'unknown'),
      likes: await db.likeCount(database, w.id),
      likedByMe: await db.hasLiked(database, viewer.id, w.id),
    }))
  );
  return json({ workouts: withLikes });
}

// ---------------------------------------------------------------------------

export async function handleSocial(req: Request, database: D1Database): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  try {
    if (m === 'POST' && path === '/auth/signup') return await signup(req, database);
    if (m === 'POST' && path === '/auth/login') return await login(req, database);
    if (m === 'POST' && path === '/auth/logout') return await logout(req, database);
    if (m === 'GET' && path === '/auth/me') return await me(req, database);
    if (m === 'PATCH' && path === '/me/profile') return await updateMe(req, database);

    if (m === 'POST' && path === '/workouts/sync') return await syncPush(req, database);
    if (m === 'GET' && path === '/workouts/sync') return await syncPull(url, req, database);

    const del = path.match(/^\/workouts\/([^/]+)$/);
    if (m === 'DELETE' && del) return await deleteWorkout(decodeURIComponent(del[1]), req, database);

    const wLike = path.match(/^\/workouts\/([^/]+)\/like$/);
    if (wLike && (m === 'POST' || m === 'DELETE')) return await setLike(decodeURIComponent(wLike[1]), req, database, m === 'POST');

    const wCopy = path.match(/^\/workouts\/([^/]+)\/copy$/);
    if (m === 'POST' && wCopy) return await copyWorkout(decodeURIComponent(wCopy[1]), req, database);

    const prof = path.match(/^\/profile\/([^/]+)$/);
    if (m === 'GET' && prof) return await profile(decodeURIComponent(prof[1]), req, database);

    const pFollow = path.match(/^\/profile\/([^/]+)\/follow$/);
    if (pFollow && (m === 'POST' || m === 'DELETE')) return await setFollow(decodeURIComponent(pFollow[1]), req, database, m === 'POST');

    if (m === 'GET' && path === '/feed') return await feed(url, req, database);
  } catch (e) {
    console.error('social handler error', e instanceof Error ? e.message : 'unknown');
    return fail(500, 'Something went wrong on the server.');
  }

  return null; // not a social route: let the caller try the food/photo routes
}
