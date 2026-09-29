/**
 * Personal data sync API tests: /sync and /data/:collection. Runs against
 * fakeD1, like social.test.ts.
 *
 * Run with:  npm test
 */
import { createFakeD1 } from '../backend/src/fakeD1';
import { handleData } from '../backend/src/data';
import { handleSocial } from '../backend/src/social';
import type { D1Database } from '../backend/src/db';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`); }
}

const req = (method: string, path: string, body?: unknown, token?: string) =>
  new Request(`https://api.test${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

async function signup(d: D1Database, username: string) {
  const r = await handleSocial(req('POST', '/auth/signup', { username, email: `${username}@x.com`, password: 'correcthorse123' }), d);
  return ((await r!.json()) as any).token as string;
}

async function call(d: D1Database, method: string, path: string, body?: unknown, token?: string) {
  const r = await handleData(req(method, path, body, token), d);
  return { status: r ? r.status : 0, body: r ? ((await r.json()) as any) : null };
}

const PROFILE = { age: 28, sex: 'male', weightKg: 80, heightCm: 178, goal: 'cut_recomp', activityLevel: 'moderate' };
const FOOD = (id: string, date = '2026-09-29', kcal = 250) => ({ id, updatedAt: 1000, data: { id, date, name: 'Paneer', grams: 100, kcal, protein: 18, carbs: 3, fat: 20 } });

async function main() {
  // -------------------------------------------------------------------------
  console.log('\n-- routing and auth --');
  let d = createFakeD1();
  check('an unrelated path returns null', (await handleData(req('GET', '/foods/search?q=x'), d)) === null);
  check('/sync without a session is refused', (await call(d, 'POST', '/sync', { since: 0, changes: {} })).status === 401);
  check('/data without a session is refused', (await call(d, 'GET', '/data/foods')).status === 401);
  const tok = await signup(d, 'alice');
  check('an unknown collection is a 404', (await call(d, 'GET', '/data/passwords', undefined, tok)).status === 404);
  check('/sync with an unknown collection is refused', (await call(d, 'POST', '/sync', { since: 0, changes: { passwords: [] } }, tok)).status === 400);

  // -------------------------------------------------------------------------
  console.log('\n-- push and pull --');
  let r = await call(d, 'POST', '/sync', {
    since: 0,
    changes: {
      profile: [{ id: 'profile', updatedAt: 1000, data: PROFILE }],
      foods: [FOOD('lf_1'), FOOD('lf_2', '2026-09-28', 400)],
      days: [{ id: '2026-09-29', updatedAt: 1000, data: { steps: 8000, gymBurn: 300, sleep: { recoveryScore: 7.5 } } }],
      routines: [{ id: 'r1', updatedAt: 1000, data: { id: 'r1', name: 'Push day', exercises: [] } }],
      recipes: [{ id: 'rec1', updatedAt: 1000, data: { id: 'rec1', name: 'Dal', ingredients: [], servings: 2 } }],
      exercises: [{ id: 'ex1', updatedAt: 1000, data: { id: 'ex1', name: 'Band pull-apart' } }],
      badges: [{ id: 'first_workout', updatedAt: 1000, data: { unlockedAt: 999 } }],
    },
  }, tok);
  check('a first push stores every record', r.status === 200 && r.body.applied === 8, JSON.stringify(r.body));
  check('nothing is rejected', r.body.rejected.length === 0);
  check('what was just pushed is not echoed back', Object.keys(r.body.changes).length === 0, JSON.stringify(r.body.changes));
  check('a cursor is returned', typeof r.body.cursor === 'number' && r.body.more === false);

  // A second phone, signed in to the same account, pulls from zero.
  r = await call(d, 'POST', '/sync', { since: 0, changes: {} }, tok);
  check('a fresh phone pulls the profile', r.body.changes.profile?.[0]?.data?.weightKg === 80);
  check('a fresh phone pulls both food logs', r.body.changes.foods?.length === 2);
  check('a fresh phone pulls the day log', r.body.changes.days?.[0]?.data?.steps === 8000);
  check('a fresh phone pulls routines, recipes, exercises and badges',
    r.body.changes.routines?.length === 1 && r.body.changes.recipes?.length === 1 && r.body.changes.exercises?.length === 1 && r.body.changes.badges?.length === 1);
  const cursor = r.body.cursor;

  r = await call(d, 'POST', '/sync', { since: cursor + 1, changes: {} }, tok);
  check('pulling after the cursor returns nothing new', Object.keys(r.body.changes).length === 0, JSON.stringify(r.body.changes));

  // -------------------------------------------------------------------------
  console.log('\n-- typed columns --');
  const alice: any = await d.prepare('SELECT * FROM users WHERE username_lc = ?').bind('alice').first();
  const foodRow: any = await d.prepare('SELECT * FROM food_logs WHERE user_id = ? AND id = ?').bind(alice.id, 'lf_2').first();
  check('food logs store date, kcal and macros as columns',
    foodRow?.log_date === '2026-09-28' && foodRow?.kcal === 400 && foodRow?.protein_g === 18 && foodRow?.carbs_g === 3 && foodRow?.fat_g === 20, JSON.stringify(foodRow));
  const dayRow: any = await d.prepare('SELECT * FROM day_logs WHERE user_id = ? AND id = ?').bind(alice.id, '2026-09-29').first();
  check('day logs store steps, burn and sleep recovery as columns', dayRow?.steps === 8000 && dayRow?.gym_burn_kcal === 300 && dayRow?.sleep_recovery === 7.5);
  const profRow: any = await d.prepare('SELECT * FROM health_profiles WHERE user_id = ? AND id = ?').bind(alice.id, 'profile').first();
  check('the profile stores weight and goal as columns', profRow?.weight_kg === 80 && profRow?.goal === 'cut_recomp');
  r = await call(d, 'GET', '/data/foods', undefined, tok);
  check('GET /data/foods lists the records', r.body.records.length === 2);

  // -------------------------------------------------------------------------
  console.log('\n-- conflicts: newer edit wins --');
  r = await call(d, 'POST', '/sync', { since: 0, changes: { foods: [{ ...FOOD('lf_1', '2026-09-29', 999), updatedAt: 500 }] } }, tok);
  check('an older edit is not applied', r.body.applied === 0);
  const back = r.body.changes.foods?.find((x: any) => x.id === 'lf_1');
  check('the phone is sent the newer server version instead', back?.data?.kcal === 250, JSON.stringify(back));

  r = await call(d, 'POST', '/sync', { since: 0, changes: { foods: [{ ...FOOD('lf_1', '2026-09-29', 300), updatedAt: 2000 }] } }, tok);
  check('a newer edit is applied', r.body.applied === 1);
  r = await call(d, 'GET', '/data/foods', undefined, tok);
  check('and is what is stored', r.body.records.find((x: any) => x.id === 'lf_1')?.data?.kcal === 300);

  const future = Date.now() + 10 * 365 * 24 * 3600 * 1000;
  await call(d, 'POST', '/sync', { since: 0, changes: { routines: [{ id: 'r1', updatedAt: future, data: { id: 'r1', name: 'Skewed clock', exercises: [] } }] } }, tok);
  r = await call(d, 'GET', '/data/routines', undefined, tok);
  check('a phone clock far in the future is capped near server time', r.body.records[0].updatedAt < Date.now() + 120_000, String(r.body.records[0].updatedAt));

  // -------------------------------------------------------------------------
  console.log('\n-- deletions --');
  r = await call(d, 'POST', '/sync', { since: 0, changes: { foods: [{ id: 'lf_2', updatedAt: 3000, deleted: true }] } }, tok);
  check('a deletion is applied', r.body.applied === 1);
  r = await call(d, 'POST', '/sync', { since: 0, changes: {} }, tok);
  const tomb = r.body.changes.foods?.find((x: any) => x.id === 'lf_2');
  check('other phones receive it as a tombstone', tomb?.deleted === true && tomb?.data === null, JSON.stringify(tomb));

  r = await call(d, 'DELETE', '/data/recipes/rec1', undefined, tok);
  check('DELETE /data/:collection/:id removes a record', r.status === 200 && r.body.applied === true);
  r = await call(d, 'GET', '/data/recipes', undefined, tok);
  check('and it lists as deleted', r.body.records[0]?.deleted === true);

  // -------------------------------------------------------------------------
  console.log('\n-- PUT --');
  r = await call(d, 'PUT', '/data/days/2026-09-30', { data: { steps: 12000, gymBurn: 0 } }, tok);
  check('PUT stores a record', r.status === 200 && r.body.applied === true && r.body.record?.data?.steps === 12000, JSON.stringify(r.body));
  r = await call(d, 'PUT', '/data/days/yesterday', { data: { steps: 1 } }, tok);
  check('a day id that is not a date is refused', r.status === 400);

  // -------------------------------------------------------------------------
  console.log('\n-- validation --');
  r = await call(d, 'POST', '/sync', {
    since: 0,
    changes: {
      profile: [{ id: 'someone_else', updatedAt: 1, data: PROFILE }, { id: 'profile', updatedAt: 1, data: { goal: 'bulk' } }],
      foods: [{ id: 'lf_bad', updatedAt: 1, data: { date: 'today', kcal: 10 } }, { id: 'lf_nokcal', updatedAt: 1, data: { date: '2026-09-29' } }],
      routines: [{ id: '', updatedAt: 1, data: { name: 'x' } }, { id: 'r_noname', updatedAt: 1, data: {} }, { id: 'r_notime', data: { name: 'x' } }],
      badges: [{ id: 'b', updatedAt: 1, data: {} }],
    },
  }, tok);
  check('bad records are rejected, not stored', r.body.applied === 0 && r.body.rejected.length === 8, JSON.stringify(r.body.rejected));
  check('each rejection says why', r.body.rejected.every((x: any) => typeof x.reason === 'string' && x.reason.length > 0));

  const big = { id: 'r_big', updatedAt: 1, data: { name: 'big', blob: 'x'.repeat(70_000) } };
  r = await call(d, 'POST', '/sync', { since: 0, changes: { routines: [big] } }, tok);
  check('an oversized record is rejected', r.body.rejected[0]?.reason === 'too large');

  const many = Array.from({ length: 501 }, (_, i) => FOOD(`lf_${i}`));
  r = await call(d, 'POST', '/sync', { since: 0, changes: { foods: many } }, tok);
  check('more than 500 records in one sync is refused', r.status === 413);

  // -------------------------------------------------------------------------
  console.log('\n-- privacy between users --');
  const bob = await signup(d, 'bob');
  r = await call(d, 'POST', '/sync', { since: 0, changes: {} }, bob);
  check('another user pulls none of alice\'s data', Object.keys(r.body.changes).length === 0, JSON.stringify(r.body.changes));
  r = await call(d, 'POST', '/sync', { since: 0, changes: { foods: [{ ...FOOD('lf_1', '2026-09-29', 1), updatedAt: Date.now() }] } }, bob);
  check('bob can use the same record id for his own record', r.body.applied === 1);
  r = await call(d, 'GET', '/data/foods', undefined, tok);
  check('and alice\'s record with that id is untouched', r.body.records.find((x: any) => x.id === 'lf_1')?.data?.kcal === 300);

  // -------------------------------------------------------------------------
  console.log('\n-- paging --');
  d = createFakeD1();
  const t2 = await signup(d, 'carol');
  for (let batch = 0; batch < 5; batch++) {
    const foods = Array.from({ length: 500 }, (_, i) => FOOD(`lf_${batch}_${i}`));
    await call(d, 'POST', '/sync', { since: 0, changes: { foods } }, t2);
  }
  const seen = new Set<string>();
  let since = 0, rounds = 0, more = true;
  while (more && rounds < 10) {
    r = await call(d, 'POST', '/sync', { since, changes: {} }, t2);
    for (const f of r.body.changes.foods ?? []) seen.add(f.id);
    more = r.body.more;
    since = r.body.cursor;
    rounds++;
  }
  check('2500 records page through completely', seen.size === 2500, `${seen.size} in ${rounds} rounds`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) throw new Error(`${fail} test(s) failed`);
}

main().catch((e) => {
  console.error(e);
  throw e;
});
