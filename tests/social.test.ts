/**
 * Social API tests: signup/login, sessions, profile privacy, workout sync
 * (ownership enforced), follow, like, copy, feed. Runs against fakeD1, an
 * in-process stand-in verified in db.smoke.ts to implement db.ts's queries
 * correctly.
 *
 * Run with:  npm test
 */
import { createFakeD1 } from '../backend/src/fakeD1';
import { handleSocial } from '../backend/src/social';
import type { D1Database } from '../backend/src/db';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`); }
}

const post = (path: string, body: unknown, token?: string) =>
  new Request(`https://api.test${path}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
const patch = (path: string, body: unknown, token?: string) =>
  new Request(`https://api.test${path}`, {
    method: 'PATCH', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
const get = (path: string, token?: string) =>
  new Request(`https://api.test${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const del = (path: string, token?: string) =>
  new Request(`https://api.test${path}`, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function signupUser(d: D1Database, username: string, email: string, password = 'correcthorse123') {
  const r = await handleSocial(post('/auth/signup', { username, email, password }), d);
  const j: any = await r!.json();
  return { token: j.token as string, user: j.user };
}

async function main() {
  // -------------------------------------------------------------------------
  console.log('\n-- routing --');
  let d = createFakeD1();
  check('an unrelated path returns null (falls through to food routes)', (await handleSocial(get('/foods/search?q=x'), d)) === null);
  check('a social path returns a response', (await handleSocial(get('/auth/me'), d)) !== null);

  // -------------------------------------------------------------------------
  console.log('\n-- signup --');
  d = createFakeD1();
  let r = await handleSocial(post('/auth/signup', { username: 'Alice', email: 'Alice@Example.com', password: 'correcthorse123' }), d);
  let j: any = await r!.json();
  check('signup succeeds and returns a token', r!.status === 201 && typeof j.token === 'string' && j.token.length > 30, JSON.stringify(j));
  check('the stored username is stored as given', j.user.username === 'Alice');
  check('display name defaults to the username', j.user.displayName === 'Alice');
  check('a new account is private by default', j.user.isPublic === false);

  r = await handleSocial(post('/auth/signup', { username: 'alice', email: 'someone.else@x.com', password: 'correcthorse123' }), d);
  check('a taken username (any case) is refused', r!.status === 409);
  r = await handleSocial(post('/auth/signup', { username: 'newperson', email: 'ALICE@EXAMPLE.COM', password: 'correcthorse123' }), d);
  check('a taken email (any case) is refused', r!.status === 409);

  r = await handleSocial(post('/auth/signup', { username: 'ab', email: 'x@x.com', password: 'correcthorse123' }), d);
  check('a too-short username is refused', r!.status === 400);
  r = await handleSocial(post('/auth/signup', { username: 'Has Space', email: 'x2@x.com', password: 'correcthorse123' }), d);
  check('a username with a space is refused', r!.status === 400);
  r = await handleSocial(post('/auth/signup', { username: 'validname', email: 'not-an-email', password: 'correcthorse123' }), d);
  check('an invalid email is refused', r!.status === 400);
  r = await handleSocial(post('/auth/signup', { username: 'validname2', email: 'x3@x.com', password: 'short' }), d);
  check('a short password is refused', r!.status === 400);
  r = await handleSocial(post('/auth/signup', 'not json'), d);
  check('malformed JSON is refused, not a crash', r!.status === 400);

  // -------------------------------------------------------------------------
  console.log('\n-- login --');
  d = createFakeD1();
  await signupUser(d, 'bob', 'bob@x.com', 'correcthorse123');
  r = await handleSocial(post('/auth/login', { emailOrUsername: 'bob@x.com', password: 'correcthorse123' }), d);
  j = await r!.json();
  check('login by email works', r!.status === 200 && typeof j.token === 'string');
  r = await handleSocial(post('/auth/login', { emailOrUsername: 'BOB', password: 'correcthorse123' }), d);
  check('login by username, any case, works', r!.status === 200);
  r = await handleSocial(post('/auth/login', { emailOrUsername: 'bob', password: 'wrongpassword' }), d);
  j = await r!.json();
  check('wrong password is refused with a generic message', r!.status === 401 && j.error.includes('Wrong'));
  r = await handleSocial(post('/auth/login', { emailOrUsername: 'nosuchuser', password: 'whatever123' }), d);
  const noUserMsg = (await r!.json()).error;
  check('an unknown user gets the SAME message as a wrong password (no user enumeration)', noUserMsg === noUserMsg && r!.status === 401);
  const r2 = await handleSocial(post('/auth/login', { emailOrUsername: 'bob', password: 'wrongpassword' }), d);
  check('unknown-user and wrong-password messages are identical', (await r2!.json()).error === noUserMsg);

  // -------------------------------------------------------------------------
  console.log('\n-- sessions and /auth/me --');
  d = createFakeD1();
  const alice = await signupUser(d, 'alice', 'a@x.com');
  r = await handleSocial(get('/auth/me', alice.token), d);
  j = await r!.json();
  check('a valid token returns the signed-in user', r!.status === 200 && j.user.username === 'alice');
  r = await handleSocial(get('/auth/me'), d);
  check('no token is unauthorized', r!.status === 401);
  r = await handleSocial(get('/auth/me', 'not-a-real-token'), d);
  check('a wrong token is unauthorized', r!.status === 401);
  await handleSocial(post('/auth/logout', {}, alice.token), d);
  r = await handleSocial(get('/auth/me', alice.token), d);
  check('a logged-out token no longer works', r!.status === 401);

  // -------------------------------------------------------------------------
  console.log('\n-- profile update --');
  d = createFakeD1();
  const carol = await signupUser(d, 'carol', 'c@x.com');
  r = await handleSocial(patch('/me/profile', { bio: 'Lifter.', isPublic: true, displayName: 'Carol J' }, carol.token), d);
  j = await r!.json();
  check('profile updates apply', j.user.bio === 'Lifter.' && j.user.isPublic === true && j.user.displayName === 'Carol J');
  r = await handleSocial(patch('/me/profile', { bio: 'x' }, undefined), d);
  check('profile update needs a session', r!.status === 401);
  r = await handleSocial(patch('/me/profile', { displayName: '   ' }, carol.token), d);
  check('an empty display name is refused', r!.status === 400);
  const longBio = 'x'.repeat(1000);
  r = await handleSocial(patch('/me/profile', { bio: longBio }, carol.token), d);
  j = await r!.json();
  check('an overlong bio is truncated, not rejected', j.user.bio.length === 300);

  // -------------------------------------------------------------------------
  console.log('\n-- workout sync: ownership --');
  d = createFakeD1();
  const dave = await signupUser(d, 'dave', 'd@x.com');
  const erin = await signupUser(d, 'erin', 'e@x.com');
  const w1 = { id: 'w1', name: 'Push day', startedAt: 100, endedAt: 200, isPublic: false, data: { exercises: [{ exerciseId: 'bench-press' }] } };
  r = await handleSocial(post('/workouts/sync', { workouts: [w1] }, dave.token), d);
  j = await r!.json();
  check('a workout syncs', r!.status === 200 && j.saved === 1 && j.rejected.length === 0);

  r = await handleSocial(get('/workouts/sync', dave.token), d);
  j = await r!.json();
  check('dave can pull his own workout', j.workouts.length === 1 && j.workouts[0].name === 'Push day');
  r = await handleSocial(get('/workouts/sync', erin.token), d);
  j = await r!.json();
  check('erin cannot see daves workout', j.workouts.length === 0);

  // erin tries to overwrite dave's workout by id
  r = await handleSocial(post('/workouts/sync', { workouts: [{ ...w1, name: 'Hijacked' }] }, erin.token), d);
  j = await r!.json();
  const stillDaves = await handleSocial(get('/workouts/sync', dave.token), d);
  const daveNow: any = await stillDaves!.json();
  check('a same-id workout from another user does not overwrite the original', daveNow.workouts[0].name === 'Push day', JSON.stringify(daveNow));

  r = await handleSocial(del('/workouts/w1', erin.token), d);
  j = await r!.json();
  check('erin cannot delete daves workout', j.removed === false);
  r = await handleSocial(del('/workouts/w1', dave.token), d);
  j = await r!.json();
  check('dave can delete his own workout', j.removed === true);
  r = await handleSocial(get('/workouts/sync', dave.token), d);
  check('the deleted workout is gone', (await r!.json()).workouts.length === 0);

  r = await handleSocial(post('/workouts/sync', { workouts: [w1] }), d);
  check('sync needs a session', r!.status === 401);
  r = await handleSocial(post('/workouts/sync', { workouts: 'nope' }, dave.token), d);
  check('a malformed sync body is refused', r!.status === 400);
  const bad = { id: 'bad1' }; // missing required fields
  r = await handleSocial(post('/workouts/sync', { workouts: [bad, w1] }, dave.token), d);
  j = await r!.json();
  check('a bad entry is rejected without failing the whole batch', j.saved === 1 && j.rejected.includes('bad1'));
  const tooMany = Array.from({ length: 201 }, (_, i) => ({ ...w1, id: `w${i}` }));
  r = await handleSocial(post('/workouts/sync', { workouts: tooMany }, dave.token), d);
  check('an oversized batch is refused outright', r!.status === 413);

  // -------------------------------------------------------------------------
  console.log('\n-- profile visibility --');
  d = createFakeD1();
  const frank = await signupUser(d, 'frank', 'f@x.com');
  await handleSocial(post('/workouts/sync', { workouts: [{ id: 'pub1', name: 'Public one', startedAt: 1, endedAt: 2, isPublic: true, data: {} }] }, frank.token), d);
  await handleSocial(post('/workouts/sync', { workouts: [{ id: 'priv1', name: 'Private one', startedAt: 3, endedAt: 4, isPublic: false, data: {} }] }, frank.token), d);

  r = await handleSocial(get('/profile/frank'), d);
  j = await r!.json();
  check('a default (private) profile hides its workouts from a stranger', j.private === true && j.workouts.length === 0);

  await handleSocial(patch('/me/profile', { isPublic: true }, frank.token), d);
  r = await handleSocial(get('/profile/frank'), d);
  j = await r!.json();
  check('a public profile shows only public workouts to a stranger', j.workouts.length === 1 && j.workouts[0].name === 'Public one');
  check('a public profile never shows a private workout to a stranger', !j.workouts.some((w: any) => w.name === 'Private one'));

  r = await handleSocial(get('/profile/frank', frank.token), d);
  j = await r!.json();
  check('the owner sees all of their own workouts, including private', j.workouts.length === 2 && j.isSelf === true);
  r = await handleSocial(get('/profile/nosuchuser'), d);
  check('an unknown profile is a 404', r!.status === 404);

  // -------------------------------------------------------------------------
  console.log('\n-- follow --');
  d = createFakeD1();
  const gina = await signupUser(d, 'gina', 'g@x.com');
  const hank = await signupUser(d, 'hank', 'h@x.com');
  await handleSocial(patch('/me/profile', { isPublic: true }, hank.token), d);

  r = await handleSocial(post('/profile/hank/follow', {}, gina.token), d);
  j = await r!.json();
  check('follow succeeds', r!.status === 200 && j.following === true);
  r = await handleSocial(get('/profile/hank', gina.token), d);
  j = await r!.json();
  check('follower count updates', j.followers === 1);
  r = await handleSocial(del('/profile/hank/follow', gina.token), d);
  j = await r!.json();
  check('unfollow succeeds', j.following === false);
  r = await handleSocial(post('/profile/hank/follow', {}, hank.token), d);
  check('you cannot follow yourself', r!.status === 400);
  r = await handleSocial(post('/profile/hank/follow', {}), d);
  check('follow needs a session', r!.status === 401);
  r = await handleSocial(post('/profile/nosuchuser/follow', {}, gina.token), d);
  check('following an unknown user is a 404', r!.status === 404);

  // -------------------------------------------------------------------------
  console.log('\n-- like and copy --');
  d = createFakeD1();
  const ivy = await signupUser(d, 'ivy', 'i@x.com');
  const jack = await signupUser(d, 'jack', 'j@x.com');
  await handleSocial(patch('/me/profile', { isPublic: true }, ivy.token), d);
  await handleSocial(
    post('/workouts/sync', { workouts: [{
      id: 'pushA', name: 'Push A', startedAt: 1, endedAt: 2, isPublic: true,
      data: { exercises: [{ exerciseId: 'bench-press', sets: [{ isWarmup: true }, {}, {}, {}] }, { exerciseId: 'lateral-raise', sets: [{}, {}] }] },
    }] }, ivy.token), d
  );
  await handleSocial(post('/workouts/sync', { workouts: [{ id: 'privB', name: 'Private B', startedAt: 5, endedAt: 6, isPublic: false, data: {} }] }, ivy.token), d);

  r = await handleSocial(post('/workouts/pushA/like', {}, jack.token), d);
  j = await r!.json();
  check('like succeeds and counts', r!.status === 200 && j.liked === true && j.likes === 1);
  r = await handleSocial(get('/profile/ivy', jack.token), d);
  j = await r!.json();
  check('likedByMe and count show up on the profile', j.workouts[0].likes === 1 && j.workouts[0].likedByMe === true);
  r = await handleSocial(del('/workouts/pushA/like', jack.token), d);
  j = await r!.json();
  check('unlike works', j.liked === false && j.likes === 0);
  r = await handleSocial(post('/workouts/privB/like', {}, jack.token), d);
  check('a private workout cannot be liked by someone else', r!.status === 404);
  r = await handleSocial(post('/workouts/nosuch/like', {}, jack.token), d);
  check('liking an unknown workout is a 404', r!.status === 404);
  r = await handleSocial(post('/workouts/pushA/like', {}), d);
  check('liking needs a session', r!.status === 401);

  r = await handleSocial(post('/workouts/pushA/copy', {}, jack.token), d);
  j = await r!.json();
  check('copy returns an importable routine', r!.status === 200 && j.routine.exercises.length === 2);
  check('warm-up sets do not count toward target sets', j.routine.exercises[0].targetSets === 3, JSON.stringify(j.routine));
  check('copy names the routine after the original', j.routine.name.includes('Push A'));
  check('copy never includes the original lifter\'s actual weights/reps', !JSON.stringify(j.routine).match(/\bweight\b|\breps\b/i));
  r = await handleSocial(post('/workouts/privB/copy', {}, jack.token), d);
  check('a private workout cannot be copied', r!.status === 404);

  // -------------------------------------------------------------------------
  console.log('\n-- feed --');
  d = createFakeD1();
  const kim = await signupUser(d, 'kim', 'k@x.com');
  const leo = await signupUser(d, 'leo', 'l@x.com');
  const mia = await signupUser(d, 'mia', 'm@x.com');
  await handleSocial(post('/workouts/sync', { workouts: [{ id: 'l1', name: 'Leo A', startedAt: 10, endedAt: 11, isPublic: true, data: {} }] }, leo.token), d);
  await handleSocial(post('/workouts/sync', { workouts: [{ id: 'm1', name: 'Mia A', startedAt: 20, endedAt: 21, isPublic: true, data: {} }] }, mia.token), d);
  await handleSocial(post('/workouts/sync', { workouts: [{ id: 'm2', name: 'Mia Private', startedAt: 25, endedAt: 26, isPublic: false, data: {} }] }, mia.token), d);

  r = await handleSocial(get('/feed', kim.token), d);
  j = await r!.json();
  check('an empty feed before following anyone', j.workouts.length === 0);

  await handleSocial(post('/profile/leo/follow', {}, kim.token), d);
  await handleSocial(post('/profile/mia/follow', {}, kim.token), d);
  r = await handleSocial(get('/feed', kim.token), d);
  j = await r!.json();
  check('feed shows public workouts from followed users, newest first', j.workouts.length === 2 && j.workouts[0].name === 'Mia A', JSON.stringify(j));
  check('feed never shows a private workout', !j.workouts.some((w: any) => w.name === 'Mia Private'));
  check('feed items carry the author', j.workouts[0].author === 'mia');
  r = await handleSocial(get('/feed'), d);
  check('feed needs a session', r!.status === 401);
  r = await handleSocial(get('/feed?before=20', kim.token), d);
  j = await r!.json();
  check('feed paging with "before" excludes items at or after that time', j.workouts.length === 1 && j.workouts[0].name === 'Leo A', JSON.stringify(j));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) throw new Error(`${fail} test(s) failed`);
}
main();
