/**
 * Cloud sync engine tests (src/lib/dataSync.ts), plus a two-phone
 * simulation: the real client (syncData) talking to the real server
 * handlers over a stubbed fetch, backed by fakeD1.
 *
 * Run with:  npm test
 */
import { Changes, SyncableState, applyRemote, collect, countChanges, diff, fingerprint, keyOf, nextSnapshot, stableStringify } from '../src/lib/dataSync';
import { syncData } from '../src/lib/socialApi';
import { createFakeD1 } from '../backend/src/fakeD1';
import { handleData } from '../backend/src/data';
import { handleSocial } from '../backend/src/social';
import type { Profile } from '../src/types';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`); }
}

const PROFILE: Profile = {
  age: 28, sex: 'male', weightKg: 80, heightCm: 178, activityLevel: 'moderate', unitSystem: 'metric', bmrFormula: 'mifflin',
  goal: 'cut_recomp', sessionsPerWeek: 4, averageSessionMinutes: 60, createdAt: 1,
};
const food = (id: string, kcal = 250, loggedAt = 1) => ({ id, foodId: 'usda:1', name: 'Paneer', grams: 100, protein: 18, carbs: 3, fat: 20, kcal, loggedAt });

function emptyState(): SyncableState {
  return { profile: null, days: {}, badges: {}, recipes: [], routines: {}, customExercises: [], workouts: {} };
}
function fullState(): SyncableState {
  return {
    profile: PROFILE,
    days: {
      '2026-09-29': { date: '2026-09-29', foods: [food('lf_1'), food('lf_2', 400, 2)], steps: 8000, gymBurn: 300 },
      '2026-09-28': { date: '2026-09-28', foods: [food('lf_3')], steps: 0, gymBurn: 0 },
    },
    badges: { first_workout: 999 },
    recipes: [{ id: 'rec1', name: 'Dal', ingredients: [], servings: 2, createdAt: 1, updatedAt: 1 }],
    routines: { r1: { id: 'r1', name: 'Push day', exercises: [], isBuiltIn: false, createdAt: 1 } },
    customExercises: [],
    workouts: {
      w1: { id: 'w1', routineId: 'r1', name: 'Push day', startedAt: 10, endedAt: 20, notes: '', exercises: [] },
      draft: { id: 'draft', routineId: null, name: 'In progress', startedAt: 30, endedAt: null, notes: '', exercises: [] },
    },
  };
}

async function main() {
  // -------------------------------------------------------------------------
  console.log('\n-- fingerprints --');
  check('key order does not change the fingerprint', stableStringify({ a: 1, b: { c: 2, d: 3 } }) === stableStringify({ b: { d: 3, c: 2 }, a: 1 }));
  check('undefined fields are ignored', stableStringify({ a: 1, b: undefined }) === stableStringify({ a: 1 }));

  // -------------------------------------------------------------------------
  console.log('\n-- collect --');
  const recs = collect(fullState());
  check('the profile is one record', recs.has('profile:profile'));
  check('each food is its own record, carrying its date', (recs.get('foods:lf_3')?.data as any)?.date === '2026-09-28');
  check('a day with steps is a record', recs.has('days:2026-09-29'));
  check('a day with only food (no steps, burn or sleep) is not', !recs.has('days:2026-09-28'));
  check('routines, recipes and badges are records', recs.has('routines:r1') && recs.has('recipes:rec1') && recs.has('badges:first_workout'));
  check('a finished workout is a record', recs.has('workouts:w1'));
  check('a workout still being logged is not', !recs.has('workouts:draft'));

  // -------------------------------------------------------------------------
  console.log('\n-- diff --');
  let changes = diff(recs, {}, 5000);
  check('with no snapshot, everything is new', countChanges(changes) === recs.size, `${countChanges(changes)} vs ${recs.size}`);
  check('changes carry the given time', changes.foods!.every((r) => r.updatedAt === 5000));

  const snap = fingerprint(recs);
  check('with a current snapshot, nothing changed', countChanges(diff(recs, snap, 1)) === 0);

  const edited = fullState();
  edited.days['2026-09-29'].foods[0] = { ...food('lf_1'), kcal: 300 };
  delete edited.routines.r1;
  changes = diff(collect(edited), snap, 6000);
  check('an edited food is found', changes.foods?.length === 1 && changes.foods[0].id === 'lf_1');
  check('a deleted routine becomes a tombstone', changes.routines?.length === 1 && changes.routines[0].deleted === true && changes.routines[0].id === 'r1');
  check('nothing else is sent', countChanges(changes) === 2);

  // -------------------------------------------------------------------------
  console.log('\n-- applyRemote --');
  let s = applyRemote(emptyState(), {
    profile: [{ id: 'profile', updatedAt: 1, data: PROFILE }],
    foods: [{ id: 'lf_9', updatedAt: 1, data: { ...food('lf_9'), date: '2026-09-27' } }],
    days: [{ id: '2026-09-27', updatedAt: 1, data: { steps: 5000, gymBurn: 100 } }],
    routines: [{ id: 'r2', updatedAt: 1, data: { id: 'r2', name: 'Legs', exercises: [], isBuiltIn: false, createdAt: 1 } }],
    badges: [{ id: 'streak', updatedAt: 1, data: { unlockedAt: 42 } }],
    workouts: [{ id: 'w9', updatedAt: 1, data: { name: 'Legs', startedAt: 1, endedAt: 2, exercises: [], isPublic: true } }],
  });
  check('a profile arrives', s.profile?.weightKg === 80);
  check('a food lands in its day, without a stray date field', s.days['2026-09-27']?.foods[0]?.id === 'lf_9' && !('date' in s.days['2026-09-27'].foods[0]));
  check('the day keeps its food and gets its steps', s.days['2026-09-27'].steps === 5000 && s.days['2026-09-27'].foods.length === 1);
  check('a routine arrives', s.routines.r2?.name === 'Legs');
  check('a badge arrives', s.badges.streak === 42);
  check('a workout arrives as a finished session', s.workouts.w9?.endedAt === 2 && s.workouts.w9.routineId === null);

  s = applyRemote(s, { foods: [{ id: 'lf_9', updatedAt: 2, deleted: true }], routines: [{ id: 'r2', updatedAt: 2, deleted: true }] });
  check('a deleted food is removed', s.days['2026-09-27'].foods.length === 0);
  check('a deleted routine is removed', !s.routines.r2);
  s = applyRemote(s, { profile: [{ id: 'profile', updatedAt: 3, deleted: true }] });
  check('a profile is never removed by sync', s.profile !== null);

  s = applyRemote(s, { foods: [{ id: 'lf_9', updatedAt: 4, data: { ...food('lf_9'), date: '2026-09-26' } }] });
  s = applyRemote(s, { foods: [{ id: 'lf_9', updatedAt: 5, data: { ...food('lf_9'), date: '2026-09-25' } }] });
  check('a food moved to another day is not left behind', !s.days['2026-09-26'].foods.length && s.days['2026-09-25'].foods.length === 1);

  const before = emptyState();
  const after = applyRemote(before, { foods: [{ id: 'x', updatedAt: 1, data: { date: 'not a date' } }], routines: [{ id: 'y', updatedAt: 1, data: 'junk' }] } as Changes);
  check('malformed server records are skipped, not trusted', Object.keys(after.days).length === 0 || Object.values(after.days).every((d) => d.foods.length === 0));
  check('and do not add routines', Object.keys(after.routines).length === 0);

  // -------------------------------------------------------------------------
  console.log('\n-- round trip: received data does not look like a local edit --');
  const remote: Changes = { foods: [{ id: 'lf_9', updatedAt: 1, data: { ...food('lf_9'), date: '2026-09-27' } }], profile: [{ id: 'profile', updatedAt: 1, data: PROFILE }] };
  const merged = applyRemote(emptyState(), remote);
  const snap2 = nextSnapshot({}, {}, collect(merged), [keyOf('foods', 'lf_9'), keyOf('profile', 'profile')]);
  check('after merging, a sync finds nothing to send back', countChanges(diff(collect(merged), snap2, 1)) === 0, JSON.stringify(diff(collect(merged), snap2, 1)));

  const pushed = diff(recs, {}, 1);
  const edits = fullState();
  edits.badges.new_one = 7; // made while the request was in flight
  const snap3 = nextSnapshot({}, pushed, new Map(), []);
  const pending = diff(collect(edits), snap3, 2);
  check('an edit made during a sync is still sent next time', pending.badges?.length === 1 && pending.badges[0].id === 'new_one');

  // -------------------------------------------------------------------------
  console.log('\n-- two phones, one account (real client and server) --');
  const d = createFakeD1();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const req = new Request(typeof input === 'string' ? input : input.url, init);
    return (await handleSocial(req, d)) ?? (await handleData(req, d)) ?? new Response('{}', { status: 404 });
  }) as typeof fetch;
  try {
    const server = { backendUrl: 'https://api.test', appToken: '' };
    const r = await handleSocial(new Request('https://api.test/auth/signup', { method: 'POST', body: JSON.stringify({ username: 'alice', email: 'a@x.com', password: 'correcthorse123' }) }), d);
    const token = ((await r!.json()) as any).token as string;

    // Phone A: has been used for a while, signs in, first sync uploads everything.
    let phoneA = fullState();
    let snapA = {};
    const { workouts: _w, ...upA } = diff(collect(phoneA), snapA, Date.now());
    const resA = await syncData(server, token, 0, upA);
    snapA = nextSnapshot(snapA, upA, new Map(), []);
    check('phone A uploads its data', resA.applied === countChanges(upA) && resA.rejected.length === 0, JSON.stringify(resA));

    // Phone B: fresh install, signs in, pulls everything.
    let phoneB = emptyState();
    const resB = await syncData(server, token, 0, {});
    phoneB = applyRemote(phoneB, resB.changes);
    check('phone B gets the profile', phoneB.profile?.goal === 'cut_recomp');
    check('phone B gets every food on the right day', phoneB.days['2026-09-29']?.foods.length === 2 && phoneB.days['2026-09-28']?.foods.length === 1);
    check('phone B gets steps, routines, recipes and badges',
      phoneB.days['2026-09-29'].steps === 8000 && !!phoneB.routines.r1 && phoneB.recipes.length === 1 && phoneB.badges.first_workout === 999);
    let snapB = nextSnapshot({}, {}, collect(phoneB), Object.entries(resB.changes).flatMap(([c, l]) => l!.map((x) => keyOf(c as any, x.id))));
    const cursorB = resB.cursor;

    // Phone B logs a meal and deletes the recipe.
    phoneB = { ...phoneB, recipes: [], days: { ...phoneB.days, '2026-09-30': { date: '2026-09-30', foods: [food('lf_b', 500, 3)], steps: 0, gymBurn: 0 } } };
    const { workouts: _w2, ...upB } = diff(collect(phoneB), snapB, Date.now() + 1);
    check('phone B only sends its two changes', countChanges(upB) === 2, JSON.stringify(upB));
    await syncData(server, token, cursorB, upB);
    snapB = nextSnapshot(snapB, upB, new Map(), []);

    // Phone A syncs again and picks those up.
    const resA2 = await syncData(server, token, resA.cursor, {});
    phoneA = applyRemote(phoneA, resA2.changes);
    check('phone A receives the new meal', phoneA.days['2026-09-30']?.foods[0]?.id === 'lf_b');
    check('phone A removes the deleted recipe', phoneA.recipes.length === 0);
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) throw new Error(`${fail} test(s) failed`);
}

main().catch((e) => {
  console.error(e);
  throw e;
});
