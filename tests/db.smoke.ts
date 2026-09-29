/**
 * Sanity check that fakeD1 actually implements what db.ts's queries need,
 * before trusting it in social.test.ts. Not part of npm test; run directly
 * if fakeD1 or db.ts change shape.
 */
import { createFakeD1 } from '../backend/src/fakeD1';
import * as db from '../backend/src/db';

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
}

async function main() {
  const d = createFakeD1();
  await db.createUser(d, { id: 'u1', username: 'alice', emailLc: 'a@x.com', passwordHash: 'h', passwordSalt: 's', displayName: 'Alice' });
  check('user found by username', (await db.findUserByUsername(d, 'ALICE'))?.id === 'u1');
  check('user found by email', (await db.findUserByEmail(d, 'a@x.com'))?.id === 'u1');
  check('user not found', (await db.findUserByUsername(d, 'bob')) === null);

  await db.createSession(d, 'tok1', 'u1', 1000);
  check('session found', (await db.findSession(d, 'tok1'))?.user_id === 'u1');
  await db.deleteSession(d, 'tok1');
  check('session deleted', (await db.findSession(d, 'tok1')) === null);

  await db.updateProfile(d, 'u1', { bio: 'hi', isPublic: true });
  const u = await db.findUserById(d, 'u1');
  check('profile updated', u?.bio === 'hi' && u?.is_public === 1);

  await db.upsertWorkout(d, 'u1', { id: 'w1', name: 'Push', startedAt: 1, endedAt: 2, isPublic: true, data: '{}' });
  check('workout inserted', (await db.findWorkout(d, 'w1'))?.name === 'Push');
  await db.upsertWorkout(d, 'u1', { id: 'w1', name: 'Push v2', startedAt: 1, endedAt: 2, isPublic: true, data: '{}' });
  check('workout updated on conflict', (await db.findWorkout(d, 'w1'))?.name === 'Push v2');

  await db.createUser(d, { id: 'u2', username: 'mallory', emailLc: 'm@x.com', passwordHash: 'h', passwordSalt: 's', displayName: 'M' });
  const stolen = await db.upsertWorkout(d, 'u2', { id: 'w1', name: 'Stolen', startedAt: 1, endedAt: 2, isPublic: true, data: '{}' });
  check('upsert cannot overwrite another user\'s workout', (await db.findWorkout(d, 'w1'))?.name === 'Push v2');

  check('list user workouts', (await db.listUserWorkouts(d, 'u1')).length === 1);
  check('delete only own workout', (await db.deleteWorkout(d, 'u2', 'w1')) === false);
  check('delete own workout', (await db.deleteWorkout(d, 'u1', 'w1')) === true);

  await db.upsertWorkout(d, 'u1', { id: 'w2', name: 'Pull', startedAt: 5, endedAt: 6, isPublic: true, data: '{}' });
  await db.upsertWorkout(d, 'u1', { id: 'w3', name: 'Legs', startedAt: 10, endedAt: 11, isPublic: false, data: '{}' });
  check('public workouts only', (await db.publicWorkoutsFor(d, 'u1', 10)).length === 1);

  await db.follow(d, 'u2', 'u1');
  check('is following', await db.isFollowing(d, 'u2', 'u1'));
  check('follow counts', (await db.followCounts(d, 'u1')).followers === 1);
  const fd = await db.feedFor(d, 'u2', 10);
  check('feed shows followed public workouts', fd.length === 1 && fd[0].id === 'w2');
  await db.unfollow(d, 'u2', 'u1');
  check('unfollowed', !(await db.isFollowing(d, 'u2', 'u1')));

  await db.like(d, 'u2', 'w2');
  check('like counted', (await db.likeCount(d, 'w2')) === 1);
  check('has liked', await db.hasLiked(d, 'u2', 'w2'));
  await db.unlike(d, 'u2', 'w2');
  check('like removed', (await db.likeCount(d, 'w2')) === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error('smoke test failed');
}
main();
