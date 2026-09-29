/**
 * Backend tests. The handler is plain Request-in, Response-out, so it runs
 * here against fake USDA, Open Food Facts and AI services. That proves the
 * routing, validation, caching, limits and error handling. It does not prove
 * the live services answer as the fakes do: run `npm run live-check` for that.
 *
 * Run with:  npm test
 */

import { Deps, Env, handle } from '../backend/src/handler';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

const AI = 'https://ai.example.test/v1';
const KEY = 'sk-very-secret-key-123';

const usdaBody = {
  foods: [
    {
      fdcId: 1,
      description: 'Tomatoes, red, ripe, raw',
      foodNutrients: [
        { nutrientId: 1008, unitName: 'KCAL', value: 18 },
        { nutrientId: 1003, value: 0.88 },
        { nutrientId: 1004, value: 0.2 },
        { nutrientId: 1005, value: 3.92 },
      ],
    },
  ],
};
const offProduct = {
  code: '8901058000019',
  product_name: 'Noodles',
  brands: 'Maggi',
  serving_quantity: 70,
  nutriments: { 'energy-kcal_100g': 427, proteins_100g: 9.5, carbohydrates_100g: 60.9, fat_100g: 16.4 },
};

const calls = { usda: 0, offSearch: 0, offProduct: 0, ai: 0 };
const sent: { auth?: string; body?: any }[] = [];
let lastUsdaUrl = '';
const world = {
  usdaFails: false,
  offFails: false,
  aiStatus: 200,
  aiReply: '',
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  if (url.includes('api.nal.usda.gov')) {
    calls.usda++;
    lastUsdaUrl = url;
    if (world.usdaFails) throw new Error('network down');
    return reply(usdaBody);
  }
  if (url.includes('openfoodfacts.org/cgi/search.pl')) {
    calls.offSearch++;
    if (world.offFails) throw new Error('network down');
    return reply({ products: [offProduct] });
  }
  if (url.includes('openfoodfacts.org/api/v2/product/')) {
    calls.offProduct++;
    if (world.offFails) throw new Error('network down');
    // Open Food Facts answers an unknown barcode with HTTP 404 and status 0.
    return url.includes('8901058000019') ? reply({ status: 1, product: offProduct }) : reply({ status: 0 }, 404);
  }
  if (url.startsWith(AI)) {
    calls.ai++;
    sent.push({ auth: init?.headers?.Authorization, body: JSON.parse(init?.body ?? '{}') });
    if (world.aiStatus !== 200) return reply({ error: { message: `provider said no, key ${KEY}` } }, world.aiStatus);
    return reply({ choices: [{ message: { content: world.aiReply } }] });
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

function makeDeps(now = Date.UTC(2026, 8, 29, 12)): Deps & { store: Map<string, { v: string; ttl: number }> } {
  const store = new Map<string, { v: string; ttl: number }>();
  const counts = new Map<string, number>();
  return {
    store,
    now: () => now,
    cache: {
      async get(k) {
        return store.get(k)?.v ?? null;
      },
      async put(k, v, ttl) {
        store.set(k, { v, ttl });
      },
    },
    counters: {
      async incr(k) {
        const n = (counts.get(k) ?? 0) + 1;
        counts.set(k, n);
        return n;
      },
    },
  };
}

const baseEnv: Env = { VISION_BASE_URL: AI, VISION_API_KEY: KEY, VISION_MODEL: 'vision-model' };
const get = (path: string, headers: Record<string, string> = {}) => new Request(`https://api.test${path}`, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://api.test${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers });
const reset = () => {
  calls.usda = calls.offSearch = calls.offProduct = calls.ai = 0;
  sent.length = 0;
  world.usdaFails = world.offFails = false;
  world.aiStatus = 200;
  world.aiReply = '';
};
const IMG = 'QUJDRA=='; // "ABCD"

async function main() {
  // -------------------------------------------------------------------------
  console.log('\n-- health and routing --');
  reset();
  let deps = makeDeps();
  let r = await handle(get('/health'), baseEnv, deps);
  let j: any = await r.json();
  check('health answers', r.status === 200 && j.ok === true);
  check('health reports photo reading is on', j.photoReading === true);
  check('health reports the USDA key is missing', j.usdaKey === false);
  check('health never leaks a secret', !JSON.stringify(j).includes(KEY));
  r = await handle(get('/health'), { ...baseEnv, VISION_MODEL: '' }, deps);
  check('health reports photo reading off when unconfigured', ((await r.json()) as any).photoReading === false);
  check('unknown route is 404', (await handle(get('/nope'), baseEnv, deps)).status === 404);
  check('wrong method is 404', (await handle(post('/foods/search', {}), baseEnv, deps)).status === 404);
  check('trailing slash is tolerated', (await handle(get('/health/'), baseEnv, deps)).status === 200);
  check('OPTIONS is answered', (await handle(new Request('https://api.test/foods/search', { method: 'OPTIONS' }), baseEnv, deps)).status === 204);

  // -------------------------------------------------------------------------
  console.log('\n-- app token --');
  const guarded = { ...baseEnv, APP_TOKEN: 'letmein' };
  check('no token is refused', (await handle(get('/foods/search?q=tomato'), guarded, deps)).status === 401);
  check('wrong token is refused', (await handle(get('/foods/search?q=tomato', { 'X-App-Token': 'nope' }), guarded, deps)).status === 401);
  check('right token is accepted', (await handle(get('/foods/search?q=tomato', { 'X-App-Token': 'letmein' }), guarded, deps)).status === 200);
  check('a token of the wrong length is refused', (await handle(get('/foods/search?q=tomato', { 'X-App-Token': 'letmeinX' }), guarded, deps)).status === 401);
  check('health needs no token', (await handle(get('/health'), guarded, deps)).status === 200);
  check('no token is needed when none is configured', (await handle(get('/foods/search?q=tomato'), baseEnv, deps)).status === 200);
  r = await handle(post('/vision/food', { image: IMG }), guarded, deps);
  check('vision also needs the token', r.status === 401);

  // -------------------------------------------------------------------------
  console.log('\n-- food search --');
  reset();
  deps = makeDeps();
  r = await handle(get('/foods/search?q=Tomato'), { ...baseEnv, USDA_API_KEY: 'usda-key' }, deps);
  j = await r.json();
  check('search returns results from both databases', r.status === 200 && j.results.length === 2, JSON.stringify(j).slice(0, 120));
  check('search reports it was not cached', r.headers.get('X-Cache') === 'miss');
  check('results are shaped for the app', j.results.every((f: any) => typeof f.name === 'string' && typeof f.kcalPer100 === 'number'));
  check('both databases were asked once', calls.usda === 1 && calls.offSearch === 1);
  check('a complete answer is cached for a week', deps.store.get('s:tomato')?.ttl === 7 * 86400);

  r = await handle(get('/foods/search?q=  tomato '), baseEnv, deps);
  check('the same search is served from cache', r.headers.get('X-Cache') === 'hit' && calls.usda === 1 && calls.offSearch === 1);
  check('the cache ignores case and spacing', ((await r.json()) as any).results.length === 2);
  r = await handle(get('/foods/search?q=TOMATO'), baseEnv, deps);
  check('upper case hits the same cache entry', r.headers.get('X-Cache') === 'hit');

  check('empty search is refused', (await handle(get('/foods/search?q='), baseEnv, deps)).status === 400);
  check('missing search is refused', (await handle(get('/foods/search'), baseEnv, deps)).status === 400);
  check('very long search is refused', (await handle(get(`/foods/search?q=${'a'.repeat(81)}`), baseEnv, deps)).status === 400);
  check('a search of exactly 80 characters is allowed', (await handle(get(`/foods/search?q=${'a'.repeat(80)}`), baseEnv, deps)).status === 200);
  check('special characters are handled', (await handle(get(`/foods/search?q=${encodeURIComponent('a+(b) & c?')}`), baseEnv, deps)).status === 200);

  reset();
  deps = makeDeps();
  world.usdaFails = true;
  r = await handle(get('/foods/search?q=paneer'), baseEnv, deps);
  j = await r.json();
  check('one database down still returns the other', r.status === 200 && j.results.length === 1 && j.notes.length === 1);
  check('a partial answer is not cached', deps.store.size === 0);
  world.usdaFails = false;
  r = await handle(get('/foods/search?q=paneer'), baseEnv, deps);
  check('the recovered database is used on the next try', ((await r.json()) as any).results.length === 2);

  reset();
  deps = makeDeps();
  world.usdaFails = world.offFails = true;
  r = await handle(get('/foods/search?q=rice'), baseEnv, deps);
  j = await r.json();
  check('both databases down gives an empty answer and a clear note', r.status === 200 && j.results.length === 0 && j.notes.length === 1);
  check('and nothing is cached', deps.store.size === 0);

  reset();
  deps = makeDeps();
  await handle(get('/foods/search?q=tomato'), { ...baseEnv, USDA_API_KEY: 'my-usda-key' }, deps);
  check('the server-side USDA key is used', lastUsdaUrl.includes('api_key=my-usda-key'), lastUsdaUrl);
  reset();
  deps = makeDeps();
  await handle(get('/foods/search?q=tomato'), baseEnv, deps);
  check('without a key the shared demo key is used', lastUsdaUrl.includes('api_key=DEMO_KEY'), lastUsdaUrl);

  // -------------------------------------------------------------------------
  console.log('\n-- barcode --');
  reset();
  deps = makeDeps();
  r = await handle(get('/foods/barcode/8901058000019'), baseEnv, deps);
  j = await r.json();
  check('a known barcode is found', r.status === 200 && j.found === true && j.candidate.name === 'Noodles');
  check('a found product is cached for a month', deps.store.get('b:8901058000019')?.ttl === 30 * 86400);
  await handle(get('/foods/barcode/8901058000019'), baseEnv, deps);
  check('the second scan is served from cache', calls.offProduct === 1);
  r = await handle(get('/foods/barcode/1234567890123'), baseEnv, deps);
  check('an unknown barcode is not an error', r.status === 200 && ((await r.json()) as any).found === false);
  check('a miss is cached for a day only', deps.store.get('b:1234567890123')?.ttl === 86400);
  check('a short barcode is refused', (await handle(get('/foods/barcode/123'), baseEnv, deps)).status === 400);
  check('a very long barcode is refused', (await handle(get('/foods/barcode/123456789012345'), baseEnv, deps)).status === 400);
  check('a non-numeric barcode does not match the route', (await handle(get('/foods/barcode/abc123456'), baseEnv, deps)).status === 404);
  world.offFails = true;
  r = await handle(get('/foods/barcode/5000000000001'), baseEnv, deps);
  check('database down gives a clear 502', r.status === 502 && typeof ((await r.json()) as any).error === 'string');
  check('and the failure is not cached', !deps.store.has('b:5000000000001'));

  // -------------------------------------------------------------------------
  console.log('\n-- photo reading: food --');
  reset();
  deps = makeDeps();
  world.aiReply = '```json\n{"items":[{"name":"Apple","grams":150},{"name":"boiled egg","grams":50}]}\n```';
  r = await handle(post('/vision/food', { image: IMG }, { 'X-Device-Id': 'phone-abc-12345' }), baseEnv, deps);
  j = await r.json();
  check('a food photo is read', r.status === 200 && j.items.length === 2 && j.items[0].name === 'apple' && j.items[0].grams === 150, JSON.stringify(j));
  check('the provider was called once', calls.ai === 1);
  check('the server key is sent to the provider', sent[0].auth === `Bearer ${KEY}`);
  check('the configured model is used', sent[0].body.model === 'vision-model');
  const parts = sent[0].body.messages[0].content;
  check('the photo is sent as an image', parts.some((p: any) => p.type === 'image_url' && p.image_url.url === `data:image/jpeg;base64,${IMG}`));
  check('the food prompt is used', parts.some((p: any) => p.type === 'text' && p.text.includes('distinct food')));
  check('the key is never returned to the app', !JSON.stringify(j).includes(KEY));

  world.aiReply = '{"items":[]}';
  r = await handle(post('/vision/food', { image: IMG }), baseEnv, deps);
  check('a photo with no food gives an empty list, not an error', r.status === 200 && ((await r.json()) as any).items.length === 0);
  world.aiReply = 'I could not tell what this is.';
  r = await handle(post('/vision/food', { image: IMG }), baseEnv, deps);
  check('a non-JSON reply gives an empty list, not a crash', r.status === 200 && ((await r.json()) as any).items.length === 0);

  world.aiReply = '{"items":[{"name":"rice","grams":100}]}';
  r = await handle(post('/vision/food', { image: `data:image/png;base64,${IMG}`, mime: 'image/png' }), baseEnv, deps);
  check('a data: URL prefix is accepted and stripped', r.status === 200 && sent[sent.length - 1].body.messages[0].content.some((p: any) => p.image_url?.url === `data:image/png;base64,${IMG}`));
  await handle(post('/vision/food', { image: IMG, mime: 'text/html' }), baseEnv, deps);
  check('an unsupported mime falls back to jpeg', sent[sent.length - 1].body.messages[0].content.some((p: any) => p.image_url?.url?.startsWith('data:image/jpeg;')));

  // -------------------------------------------------------------------------
  console.log('\n-- photo reading: label --');
  world.aiReply = '{"name":"Granola","basis":"per100g","kcal":450,"protein":10,"carbs":60,"fat":18}';
  r = await handle(post('/vision/label', { image: IMG }), baseEnv, deps);
  j = await r.json();
  check('a label is read', r.status === 200 && j.reading.candidate.kcalPer100 === 450 && j.reading.candidate.name === 'Granola');
  check('the label prompt is used', sent[sent.length - 1].body.messages[0].content.some((p: any) => p.text?.includes('nutrition facts label')));
  check('the explanation of the basis comes back', typeof j.reading.basisNote === 'string');
  world.aiReply = '{"basis":"per100g","protein":5}';
  r = await handle(post('/vision/label', { image: IMG }), baseEnv, deps);
  check('an unreadable label is a 422 with a clear message', r.status === 422 && String(((await r.json()) as any).error).includes('label'));

  // -------------------------------------------------------------------------
  console.log('\n-- photo reading: validation --');
  reset();
  deps = makeDeps();
  check('server without photo reading configured is a 503', (await handle(post('/vision/food', { image: IMG }), { ...baseEnv, VISION_API_KEY: '' }, deps)).status === 503);
  check('no image is refused', (await handle(post('/vision/food', {}), baseEnv, deps)).status === 400);
  check('a non-string image is refused', (await handle(post('/vision/food', { image: 12345 }), baseEnv, deps)).status === 400);
  check('invalid JSON is refused', (await handle(post('/vision/food', 'not json'), baseEnv, deps)).status === 400);
  check('non-base64 text is refused', (await handle(post('/vision/food', { image: 'hello world!!' }), baseEnv, deps)).status === 400);
  check('an oversized image is refused', (await handle(post('/vision/food', { image: 'A'.repeat(6_000_001) }), baseEnv, deps)).status === 413);
  check('an oversized declared length is refused early', (await handle(post('/vision/food', { image: IMG }, { 'content-length': '99999999' }), baseEnv, deps)).status === 413);
  check('none of those reached the provider', calls.ai === 0);
  // Rejected requests must not burn the phone's daily allowance. Same phone,
  // limit of one: five bad requests, then one good one must still succeed.
  world.aiReply = '{"items":[]}';
  const strict: Env = { ...baseEnv, VISION_DAILY_PER_DEVICE: '1' };
  const same = { 'X-Device-Id': 'phone-quota-123' };
  const bad: unknown[] = [{}, { image: 12345 }, 'not json', { image: 'hello world!!' }, { image: 'A'.repeat(6_000_001) }];
  for (const b of bad) await handle(post('/vision/food', b, same), strict, deps);
  const good = await handle(post('/vision/food', { image: IMG }, same), strict, deps);
  check('rejected requests did not use up any quota', good.status === 200);
  const again = await handle(post('/vision/food', { image: IMG }, same), strict, deps);
  check('and the limit of one really was in force', again.status === 429);

  // -------------------------------------------------------------------------
  console.log('\n-- rate limits --');
  reset();
  deps = makeDeps();
  world.aiReply = '{"items":[{"name":"apple","grams":100}]}';
  const capped: Env = { ...baseEnv, VISION_DAILY_PER_DEVICE: '3', VISION_DAILY_GLOBAL: '5' };
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) codes.push((await handle(post('/vision/food', { image: IMG }, { 'X-Device-Id': 'phone-one-12345' }), capped, deps)).status);
  check('a phone gets its daily allowance, then is stopped', codes.join() === '200,200,200,429,429', codes.join());
  check('a stopped phone never reaches the provider', calls.ai === 3);
  r = await handle(post('/vision/food', { image: IMG }, { 'X-Device-Id': 'phone-one-12345' }), capped, deps);
  check('the limit message tells the user what to do', String(((await r.json()) as any).error).includes('manually'));
  r = await handle(post('/vision/food', { image: IMG }, { 'X-Device-Id': 'phone-two-12345' }), capped, deps);
  check('a different phone is unaffected', r.status === 200);
  await handle(post('/vision/food', { image: IMG }, { 'X-Device-Id': 'phone-two-12345' }), capped, deps);
  r = await handle(post('/vision/food', { image: IMG }, { 'X-Device-Id': 'phone-three-12345' }), capped, deps);
  check('the global daily cap stops everyone', r.status === 429 && String(((await r.json()) as any).error).includes('daily limit'));

  const tomorrow = makeDeps(Date.UTC(2026, 8, 30, 12));
  tomorrow.counters = deps.counters; // same counters, new day
  r = await handle(post('/vision/food', { image: IMG }, { 'X-Device-Id': 'phone-one-12345' }), capped, tomorrow);
  check('limits reset on a new day', r.status === 200);

  reset();
  deps = makeDeps();
  world.aiReply = '{"items":[]}';
  for (let i = 0; i < 3; i++) await handle(post('/vision/food', { image: IMG }, { 'CF-Connecting-IP': '203.0.113.9' }), { ...baseEnv, VISION_DAILY_PER_DEVICE: '2' }, deps);
  check('with no device id the address is used', calls.ai === 2);
  reset();
  deps = makeDeps();
  world.aiReply = '{"items":[]}';
  for (let i = 0; i < 3; i++) await handle(post('/vision/food', { image: IMG }, { 'X-Device-Id': 'x' }), { ...baseEnv, VISION_DAILY_PER_DEVICE: '2' }, deps);
  check('a malformed device id is not trusted', calls.ai === 2);
  reset();
  deps = makeDeps();
  world.aiReply = '{"items":[]}';
  for (let i = 0; i < 40; i++) await handle(post('/vision/food', { image: IMG }, { 'X-Device-Id': 'phone-default-1' }), baseEnv, deps);
  check('the default allowance is 30 a day', calls.ai === 30, `${calls.ai}`);
  reset();
  deps = makeDeps();
  world.aiStatus = 500;
  for (let i = 0; i < 3; i++) await handle(post('/vision/food', { image: IMG }, { 'X-Device-Id': 'phone-fail-1234' }), { ...baseEnv, VISION_DAILY_PER_DEVICE: '2' }, deps);
  check('failed attempts count too, so retries cannot hammer the provider', calls.ai === 2);

  // -------------------------------------------------------------------------
  console.log('\n-- provider failures --');
  reset();
  deps = makeDeps();
  for (const status of [401, 404, 429, 500]) {
    world.aiStatus = status;
    r = await handle(post('/vision/food', { image: IMG }, { 'X-Device-Id': `phone-err-${status}` }), baseEnv, deps);
    const body = await r.text();
    check(`a provider ${status} becomes a friendly 502`, r.status === 502 && body.includes('unavailable'));
    check(`and the ${status} response leaks no key or provider text`, !body.includes(KEY) && !body.includes('provider said'));
  }
}

main()
  .catch((e) => {
    fail++;
    console.log('  FAIL unexpected error', e);
  })
  .finally(() => {
    globalThis.fetch = realFetch;
    console.log(`\n${pass} passed, ${fail} failed\n`);
    if (fail > 0) throw new Error(`${fail} test(s) failed`);
  });
