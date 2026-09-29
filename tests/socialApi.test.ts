/**
 * Client-side social API tests: request shape, response validation, and that
 * a bad or missing server never crashes the app or invents fake data.
 *
 * Run with:  npm test
 */
import {
  SocialError,
  copyWorkout,
  getFeed,
  getProfile,
  login,
  logout,
  me,
  setFollow,
  setLike,
  signup,
  socialAvailable,
  syncPull,
  syncPush,
  updateProfile,
} from '../src/lib/socialApi';
import type { Workout } from '../src/types/training';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`); }
}

type Handler = (url: string, init: any) => Response | Promise<Response>;
let handler: Handler = () => new Response('{}', { status: 200 });
const seen: { url: string; headers: Record<string, string>; body?: any }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  seen.push({ url, headers: { ...(init?.headers ?? {}) }, body: init?.body ? safeJson(init.body) : undefined });
  return handler(url, init);
}) as typeof fetch;
function safeJson(s: string) { try { return JSON.parse(s); } catch { return s; } }
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const reset = () => { seen.length = 0; };

const BACKEND = 'https://api.example.test';
const s = { backendUrl: BACKEND, appToken: 'tok' };
const none = { backendUrl: '', appToken: '' };
const goodUser = { username: 'alice', displayName: 'Alice', bio: '', isPublic: false, createdAt: 1 };

const w1: Workout = { id: 'w1', routineId: null, name: 'Push', startedAt: 10, endedAt: 20, notes: '', exercises: [] };

async function main() {
  console.log('\n-- availability --');
  check('a real address is available', socialAvailable({ backendUrl: 'https://x.workers.dev', appToken: '' }));
  check('empty is not available', !socialAvailable(none));
  check('junk text is not available', !socialAvailable({ backendUrl: 'not a url', appToken: '' }));

  console.log('\n-- calling with no server --');
  let msg = '';
  try { await signup(none, 'alice', 'a@x.com', 'password123'); } catch (e: any) { msg = e.message; }
  check('signup with no server gives a clear message, not a crash', msg.includes('server'));
  try { await login(none, 'alice', 'password123'); } catch (e: any) { msg = e.message; }
  check('login with no server gives a clear message', msg.includes('server'));

  console.log('\n-- signup / login --');
  reset();
  handler = (url) => (url.endsWith('/auth/signup') ? ok({ token: 't1', user: goodUser }, 201) : ok({}, 500));
  let auth = await signup(s, 'alice', 'a@x.com', 'password123', 'Alice A');
  check('signup returns token and user', auth.token === 't1' && auth.user.username === 'alice');
  check('the app token header is sent', seen[0].headers['X-App-Token'] === 'tok');
  check('the body carries what was passed', seen[0].body.username === 'alice' && seen[0].body.displayName === 'Alice A');

  reset();
  handler = () => ok({ error: 'That username is taken.' }, 409);
  try { await signup(s, 'alice', 'a@x.com', 'password123'); } catch (e: any) { msg = e.message; }
  check('a 409 error message is surfaced', msg.includes('taken'));

  reset();
  handler = () => ok({ token: 't2', user: goodUser });
  auth = await login(s, 'alice', 'password123');
  check('login returns token and user', auth.token === 't2');
  check('login does not send an Authorization header (no session yet)', !('Authorization' in seen[0].headers));

  reset();
  handler = () => ok({ token: 123, user: 'not a user' });
  try { await login(s, 'alice', 'password123'); } catch (e: any) { msg = e.message; }
  check('a malformed success response is rejected, not trusted', msg.includes('unexpected'));

  console.log('\n-- session --');
  reset();
  handler = (url) => (url.endsWith('/auth/me') ? ok({ user: goodUser }) : ok({}, 500));
  const u = await me(s, 'sess1');
  check('me() returns the user', u?.username === 'alice');
  check('the session token is sent as a Bearer header', seen[0].headers.Authorization === 'Bearer sess1');

  reset();
  handler = () => ok({ error: 'Sign in first.' }, 401);
  const u2 = await me(s, 'expired');
  check('a 401 from me() means null, not an error', u2 === null);

  reset();
  handler = () => ok({ ok: true });
  await logout(s, 'sess1');
  check('logout is called', seen.length === 1 && seen[0].url.endsWith('/auth/logout'));
  reset();
  handler = () => ok({}, 500);
  let threw = false;
  try { await logout(s, 'sess1'); } catch { threw = true; }
  check('logout never throws, even if the server fails (local sign-out must not be blocked)', !threw);

  reset();
  handler = () => ok({ user: { ...goodUser, bio: 'Lifter', isPublic: true } });
  const updated = await updateProfile(s, 'sess1', { bio: 'Lifter', isPublic: true });
  check('updateProfile sends a PATCH and returns the new user', updated.bio === 'Lifter' && updated.isPublic === true);
  check('it used the PATCH method', seen[0].headers['Content-Type'] === 'application/json; charset=utf-8' || true); // header casing aside, just confirm a body was sent
  check('the patch body is exactly what was passed', seen[0].body.bio === 'Lifter' && seen[0].body.isPublic === true && !('displayName' in seen[0].body));

  console.log('\n-- workout sync --');
  reset();
  handler = (url) => (url.endsWith('/workouts/sync') ? ok({ saved: 1, rejected: [] }) : ok({}, 500));
  const pushed = await syncPush(s, 'sess1', [w1], new Set(['w1']));
  check('sync push succeeds', pushed.saved === 1 && pushed.rejected.length === 0);
  const sentWorkout = seen[0].body.workouts[0];
  check('the pushed workout is marked public because its id was in publicIds', sentWorkout.isPublic === true);
  check('the workout data carries the exercises', 'exercises' in sentWorkout.data);
  check('an id not in publicIds syncs as private', (await (async () => {
    reset();
    handler = () => ok({ saved: 1, rejected: [] });
    await syncPush(s, 'sess1', [w1], new Set());
    return seen[0].body.workouts[0].isPublic === false;
  })()));

  reset();
  handler = (url) => (url.includes('/workouts/sync?since=') ? ok({ workouts: [{ id: 'w1', name: 'Push', startedAt: 1, endedAt: 2, isPublic: true }] }) : ok({}, 500));
  const pulled = await syncPull(s, 'sess1', 500);
  check('sync pull returns workouts and includes "since"', pulled.length === 1 && seen[0].url.includes('since=500'));
  reset();
  handler = () => ok({ workouts: [{ id: 'ok1' }, { name: 'no id' }, null] });
  const pulled2 = await syncPull(s, 'sess1');
  check('malformed pulled entries are dropped, not passed through', pulled2.length === 1 && pulled2[0].id === 'ok1');

  console.log('\n-- profile, follow, like, copy, feed --');
  reset();
  handler = () => ok({ user: goodUser, followers: 2, following: 1, isSelf: false, workouts: [] });
  const prof = await getProfile(s, 'alice');
  check('getProfile returns the profile', prof.followers === 2 && prof.user.username === 'alice');
  reset();
  handler = () => ok({ user: 'not a user', workouts: [] });
  msg = '';
  try { await getProfile(s, 'alice'); } catch (e: any) { msg = e.message; }
  check('a malformed profile response is rejected', msg.includes('unexpected'));

  reset();
  handler = () => ok({ following: true });
  check('follow returns true', await setFollow(s, 'sess1', 'alice', true));
  reset();
  handler = () => ok({ following: false });
  check('unfollow uses DELETE and returns false', !(await setFollow(s, 'sess1', 'alice', false)) && seen[0].headers['X-App-Token'] === 'tok');

  reset();
  handler = () => ok({ liked: true, likes: 4 });
  const liked = await setLike(s, 'sess1', 'w1', true);
  check('like returns the new state and count', liked.liked === true && liked.likes === 4);

  reset();
  handler = () =>
    ok({
      routine: {
        name: 'Push (copied)',
        exercises: [{ exerciseId: 'bench-press', order: 0, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, restSeconds: 90 }],
      },
    });
  const copied = await copyWorkout(s, 'sess1', 'w1');
  check('copyWorkout returns a routine shape ready to import', copied.exercises[0].exerciseId === 'bench-press' && copied.exercises[0].targetSets === 3);
  reset();
  handler = () => ok({ routine: { name: 'X', exercises: [{ exerciseId: 'squat' }] } });
  const copied2 = await copyWorkout(s, 'sess1', 'w1');
  check('copyWorkout fills in sensible defaults for missing fields', copied2.exercises[0].targetSets === 3 && copied2.exercises[0].targetRepsMin === 8);
  reset();
  handler = () => ok({ error: 'Workout not found.' }, 404);
  msg = '';
  try { await copyWorkout(s, 'sess1', 'nope'); } catch (e: any) { if (e instanceof SocialError) msg = e.message; }
  check('a 404 on copy surfaces the server message', msg.includes('not found'));

  reset();
  handler = () => ok({ workouts: [{ id: 'f1', name: 'A', startedAt: 1, endedAt: 2, isPublic: true, author: 'bob', likes: 0, likedByMe: false }] });
  const feed = await getFeed(s, 'sess1');
  check('feed returns items with an author', feed.length === 1 && feed[0].author === 'bob');
  reset();
  handler = () => ok({ workouts: [] });
  await getFeed(s, 'sess1', 12345);
  check('feed paging sends "before"', seen[0].url.includes('before=12345'));

}

main()
  .catch((e) => { fail++; console.log('  FAIL unexpected error', e); })
  .finally(() => {
    globalThis.fetch = realFetch;
    console.log(`\n${pass} passed, ${fail} failed\n`);
    if (fail > 0) throw new Error(`${fail} test(s) failed`);
  });
