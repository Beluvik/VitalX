/**
 * Client API layer tests: choosing between the backend and the databases,
 * falling back when the backend is down, and refusing junk from the server.
 *
 * Run with:  npm test
 */

import {
  ApiSettings,
  backendReady,
  lookupBarcodeVia,
  photoAvailable,
  readFoodPhoto,
  readLabelPhoto,
  sanitizeCandidate,
  sanitizeReading,
  sanitizeSearch,
  searchFoodsVia,
} from '../src/lib/api';

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
// fake network
// ---------------------------------------------------------------------------

type Handler = (url: string, init: any) => Response | Promise<Response>;
let handler: Handler = () => new Response('{}', { status: 200 });
const seen: { url: string; headers: Record<string, string>; body?: any }[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  seen.push({ url, headers: { ...(init?.headers ?? {}) }, body: init?.body ? safeJson(init.body) : undefined });
  return handler(url, init);
}) as typeof fetch;

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const BACKEND = 'https://api.example.test';
const AI = 'https://ai.example.test/v1';
const usdaBody = { foods: [{ fdcId: 7, description: 'Paneer', foodNutrients: [{ nutrientId: 1008, unitName: 'KCAL', value: 265 }, { nutrientId: 1003, value: 18 }] }] };
const offBody = { products: [{ code: '1', product_name: 'Paneer block', nutriments: { 'energy-kcal_100g': 300 } }] };

/** What the databases answer, for the direct fallback. */
function databases(url: string): Response | null {
  if (url.includes('api.nal.usda.gov')) return ok(usdaBody);
  if (url.includes('openfoodfacts.org/cgi/search.pl')) return ok(offBody);
  if (url.includes('openfoodfacts.org/api/v2/product/')) return ok({ status: 1, product: offBody.products[0] });
  return null;
}

const none: ApiSettings = { backendUrl: '', appToken: '', deviceId: '', usdaKey: '', visionBaseUrl: '', visionKey: '', visionModel: '' };
const withBackend: ApiSettings = { ...none, backendUrl: BACKEND, appToken: 'tok', deviceId: 'dev-abc-12345' };
const withOwnKey: ApiSettings = { ...none, visionBaseUrl: AI, visionKey: 'k', visionModel: 'm' };
const both: ApiSettings = { ...withBackend, visionBaseUrl: AI, visionKey: 'k', visionModel: 'm' };

const goodCandidate = { id: 'usda:1', name: 'Tomato', source: 'usda', kcalPer100: 18, proteinPer100: 0.9, carbsPer100: 3.9, fatPer100: 0.2 };
const reset = () => {
  seen.length = 0;
  handler = () => new Response('{}', { status: 200 });
};

async function main() {
  // -------------------------------------------------------------------------
  console.log('\n-- settings checks --');
  check('a normal address is a backend', backendReady({ backendUrl: 'https://x.workers.dev' }) && backendReady({ backendUrl: ' http://10.0.0.5:8787 ' }));
  check('blank is not a backend', !backendReady({ backendUrl: '' }) && !backendReady({ backendUrl: '   ' }));
  check('text that is not an address is not a backend', !backendReady({ backendUrl: 'my server' }) && !backendReady({ backendUrl: 'ftp://x' }) && !backendReady({ backendUrl: 'workers.dev' }));
  check('photos are available with a backend', photoAvailable(withBackend));
  check('photos are available with an own key', photoAvailable(withOwnKey));
  check('photos are not available with neither', !photoAvailable(none));
  check('a half-filled own key is not enough', !photoAvailable({ ...none, visionKey: 'k' }));

  // -------------------------------------------------------------------------
  console.log('\n-- sanitising what the server sends --');
  check('a good food passes', sanitizeCandidate(goodCandidate)?.name === 'Tomato');
  check('a missing name is dropped', sanitizeCandidate({ ...goodCandidate, name: '' }) === null && sanitizeCandidate({ ...goodCandidate, name: undefined }) === null);
  check('a non-object is dropped', sanitizeCandidate(null) === null && sanitizeCandidate('x') === null && sanitizeCandidate(5) === null);
  check('missing calories are dropped', sanitizeCandidate({ ...goodCandidate, kcalPer100: undefined }) === null);
  check('negative calories are dropped', sanitizeCandidate({ ...goodCandidate, kcalPer100: -5 }) === null);
  check('impossible calories are dropped', sanitizeCandidate({ ...goodCandidate, kcalPer100: 5000 }) === null);
  check('NaN and Infinity are dropped', sanitizeCandidate({ ...goodCandidate, kcalPer100: NaN }) === null && sanitizeCandidate({ ...goodCandidate, kcalPer100: Infinity }) === null);
  check('calories as a string are dropped, not guessed', sanitizeCandidate({ ...goodCandidate, kcalPer100: '18' }) === null);
  check('impossible macros become 0', sanitizeCandidate({ ...goodCandidate, proteinPer100: 500, fatPer100: -3, carbsPer100: NaN })?.proteinPer100 === 0);
  check('an unknown source is tolerated', sanitizeCandidate({ ...goodCandidate, source: 'weird' })?.source === 'off');
  check('a missing id gets one', (sanitizeCandidate({ ...goodCandidate, id: undefined })?.id ?? '').length > 0);
  check('very long names are shortened', (sanitizeCandidate({ ...goodCandidate, name: 'x'.repeat(500) })?.name.length ?? 0) <= 90);
  check('a silly serving size is dropped', sanitizeCandidate({ ...goodCandidate, servingGrams: 99999 })?.servingGrams === undefined && sanitizeCandidate({ ...goodCandidate, servingGrams: 40 })?.servingGrams === 40);
  check('negative fibre is dropped', sanitizeCandidate({ ...goodCandidate, fibrePer100: -1 })?.fibrePer100 === undefined);

  const searchClean = sanitizeSearch({ results: [goodCandidate, { name: 'bad' }, null, 5], notes: ['a', 7, 'b', 'c', 'd'] });
  check('a search keeps only good foods', searchClean?.results.length === 1);
  check('a search keeps at most three text notes', searchClean?.notes.length === 3 && searchClean.notes.every((n) => typeof n === 'string'));
  check('a wrong-shaped search is rejected', sanitizeSearch(null) === null && sanitizeSearch({}) === null && sanitizeSearch({ results: 'x' }) === null);
  check('an empty search is valid', sanitizeSearch({ results: [] })?.results.length === 0);

  const reading = sanitizeReading({ reading: { candidate: { ...goodCandidate, source: 'usda' }, basisNote: 'per 100 g' } });
  check('a label reading passes and is tagged as a label', reading?.candidate.source === 'label' && reading.basisNote === 'per 100 g');
  check('a reading with no candidate is rejected', sanitizeReading({ reading: {} }) === null && sanitizeReading(null) === null && sanitizeReading({}) === null);
  check('a reading with a bad candidate is rejected', sanitizeReading({ reading: { candidate: { name: 'x' } } }) === null);

  // -------------------------------------------------------------------------
  console.log('\n-- food search: backend first, databases as a fallback --');
  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ results: [goodCandidate], notes: [] }) : ok({}, 500));
  let out = await searchFoodsVia(withBackend, ' tomato soup ');
  check('the backend answer is used', out.results.length === 1 && out.results[0].name === 'Tomato');
  check('only the backend was asked', seen.length === 1 && seen[0].url.startsWith(BACKEND));
  check('the query is trimmed and encoded', seen[0].url.endsWith('/foods/search?q=tomato%20soup'), seen[0].url);
  check('the app token is sent', seen[0].headers['X-App-Token'] === 'tok');
  check('the device id is sent', seen[0].headers['X-Device-Id'] === 'dev-abc-12345');

  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ results: [goodCandidate], notes: [] }) : ok({}, 500));
  await searchFoodsVia({ ...withBackend, backendUrl: `${BACKEND}///` }, 'x');
  check('trailing slashes on the address are handled', seen[0].url.startsWith(`${BACKEND}/foods/search`), seen[0].url);
  reset();
  handler = () => ok({ results: [], notes: [] });
  await searchFoodsVia({ ...withBackend, appToken: '', deviceId: '' }, 'x');
  check('empty token and device id are not sent', !('X-App-Token' in seen[0].headers) && !('X-Device-Id' in seen[0].headers));

  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ error: 'boom' }, 500) : databases(url) ?? ok({}, 404));
  out = await searchFoodsVia(withBackend, 'paneer');
  check('a server error falls back to the databases', out.results.length === 2 && seen.some((s) => s.url.includes('api.nal.usda.gov')), JSON.stringify(out).slice(0, 100));

  reset();
  handler = (url) => {
    if (url.startsWith(BACKEND)) throw new Error('network down');
    return databases(url) ?? ok({}, 404);
  };
  out = await searchFoodsVia(withBackend, 'paneer');
  check('an unreachable server falls back to the databases', out.results.length === 2);

  reset();
  handler = (url) => (url.startsWith(BACKEND) ? new Response('<html>gateway</html>', { status: 200 }) : databases(url) ?? ok({}, 404));
  out = await searchFoodsVia(withBackend, 'paneer');
  check('a non-JSON answer falls back to the databases', out.results.length === 2);

  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ nonsense: true }) : databases(url) ?? ok({}, 404));
  out = await searchFoodsVia(withBackend, 'paneer');
  check('a wrong-shaped answer falls back to the databases', out.results.length === 2);

  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ error: 'Search text must be 1 to 80 characters.' }, 400) : databases(url) ?? ok({}, 404));
  out = await searchFoodsVia(withBackend, 'x');
  check('a rejected request shows the server message and does not fall back', out.results.length === 0 && out.notes[0].includes('1 to 80') && seen.length === 1);

  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ error: 'Missing or wrong app token.' }, 401) : databases(url) ?? ok({}, 404));
  out = await searchFoodsVia(withBackend, 'x');
  check('a wrong token is reported plainly', out.notes[0].includes('token'));

  reset();
  handler = (url) => databases(url) ?? ok({}, 404);
  out = await searchFoodsVia(none, 'paneer');
  check('with no backend the databases are used directly', out.results.length === 2 && seen.every((s) => !s.url.startsWith(BACKEND)));
  check('and no token or device id leaks to them', seen.every((s) => !('X-App-Token' in s.headers)));

  // -------------------------------------------------------------------------
  console.log('\n-- barcodes --');
  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ found: true, candidate: goodCandidate }) : ok({}, 500));
  let bc = await lookupBarcodeVia(withBackend, '8901058000019');
  check('a barcode is looked up on the backend', bc?.name === 'Tomato' && seen[0].url.endsWith('/foods/barcode/8901058000019'));
  reset();
  handler = () => ok({ found: false });
  bc = await lookupBarcodeVia(withBackend, '8901058000019');
  check('an unknown product is null, with no fallback', bc === null && seen.length === 1);
  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({}, 503) : databases(url) ?? ok({}, 404));
  bc = await lookupBarcodeVia(withBackend, '8901058000019');
  check('a server error falls back to the database', bc?.name === 'Paneer block' && seen.some((s) => s.url.includes('openfoodfacts.org/api/v2/product/')));
  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ found: true, candidate: { name: 'junk' } }) : databases(url) ?? ok({}, 404));
  bc = await lookupBarcodeVia(withBackend, '8901058000019');
  check('a junk candidate falls back to the database', bc?.name === 'Paneer block');
  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ error: 'A barcode has 6 to 14 digits.' }, 400) : ok({}, 500));
  let msg = '';
  try {
    await lookupBarcodeVia(withBackend, '123');
  } catch (e: any) {
    msg = e.message;
  }
  check('a rejected barcode raises the server message', msg.includes('6 to 14'));
  reset();
  handler = (url) => (url.includes('openfoodfacts.org/api/v2/product/') ? ok({ status: 0, status_verbose: 'product not found' }, 404) : ok({}, 500));
  bc = await lookupBarcodeVia(none, '0000000000017');
  check('an HTTP 404 for a barcode means "not in the database", not "no connection"', bc === null);
  reset();
  handler = (url) => (url.includes('openfoodfacts.org/api/v2/product/') ? ok({}, 500) : ok({}, 500));
  msg = '';
  try {
    await lookupBarcodeVia(none, '0000000000017');
  } catch (e: any) {
    msg = e.message;
  }
  check('an HTTP 500 for a barcode is still an error', msg.length > 0);
  reset();
  handler = (url) => databases(url) ?? ok({}, 404);
  bc = await lookupBarcodeVia(none, '8 901058 000019');
  check('spaces in a typed barcode are ignored', bc?.name === 'Paneer block' && seen[0].url.includes('8901058000019'));

  // -------------------------------------------------------------------------
  console.log('\n-- photos --');
  const aiFood = (content: string) => (url: string) =>
    url.startsWith(AI) ? ok({ choices: [{ message: { content } }] }) : ok({}, 500);

  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ items: [{ name: 'Apple', grams: 150 }] }) : ok({}, 500));
  let items = await readFoodPhoto(withBackend, 'QUJD');
  check('a food photo goes to the backend', items.length === 1 && items[0].name === 'apple' && seen[0].url.endsWith('/vision/food'));
  check('the image and type are sent as JSON', seen[0].body?.image === 'QUJD' && seen[0].body?.mime === 'image/jpeg');
  check('the token and device id go with it', seen[0].headers['X-App-Token'] === 'tok' && seen[0].headers['X-Device-Id'] === 'dev-abc-12345');
  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ items: [{ name: 'Apple', grams: 150 }] }) : aiFood('{"items":[]}')(url));
  items = await readFoodPhoto(both, 'QUJD');
  check('the backend is preferred even when an own key exists', items.length === 1 && !seen.some((s) => s.url.startsWith(AI)));

  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ items: 'garbage' }) : ok({}, 500));
  items = await readFoodPhoto(withBackend, 'QUJD');
  check('a garbage item list becomes an empty list', items.length === 0);

  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ error: 'Daily photo limit reached on this phone.' }, 429) : ok({}, 500));
  msg = '';
  try {
    await readFoodPhoto(both, 'QUJD');
  } catch (e: any) {
    msg = e.message;
  }
  check('a daily-limit answer is shown, not bypassed with the own key', msg.includes('Daily photo limit') && !seen.some((s) => s.url.startsWith(AI)));

  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ error: 'x' }, 502) : ok({}, 500));
  msg = '';
  try {
    await readFoodPhoto(withBackend, 'QUJD');
  } catch (e: any) {
    msg = e.message;
  }
  check('a server outage with no own key gives a plain message', msg.includes('unavailable') && msg.includes('manually'));

  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ error: 'x' }, 502) : aiFood('{"items":[{"name":"rice","grams":100}]}')(url));
  items = await readFoodPhoto(both, 'QUJD');
  check('a server outage falls back to the own key', items.length === 1 && items[0].name === 'rice' && seen.some((s) => s.url.startsWith(AI)));

  reset();
  handler = (url) => {
    if (url.startsWith(BACKEND)) throw new Error('network down');
    return aiFood('{"items":[{"name":"rice","grams":100}]}')(url);
  };
  items = await readFoodPhoto(both, 'QUJD');
  check('an unreachable server falls back to the own key', items.length === 1);

  reset();
  handler = aiFood('{"items":[{"name":"apple","grams":120}]}');
  items = await readFoodPhoto(withOwnKey, 'QUJD');
  check('with no backend the own key is used directly', items.length === 1 && seen.length === 1 && seen[0].url.startsWith(AI));

  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ reading: { candidate: { ...goodCandidate, source: 'label' }, basisNote: 'n' } }) : ok({}, 500));
  let lab = await readLabelPhoto(withBackend, 'QUJD');
  check('a label goes to the backend', lab?.candidate.name === 'Tomato' && seen[0].url.endsWith('/vision/label'));
  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ error: 'The calories on the label could not be read.' }, 422) : ok({}, 500));
  lab = await readLabelPhoto(both, 'QUJD');
  check('an unreadable label is null, not an error, and not retried elsewhere', lab === null && !seen.some((s) => s.url.startsWith(AI)));
  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ reading: { candidate: { name: 'x' } } }) : ok({}, 500));
  lab = await readLabelPhoto(withBackend, 'QUJD');
  check('a junk label reading is null', lab === null);
  reset();
  handler = aiFood('{"name":"Granola","basis":"per100g","kcal":450,"protein":10,"carbs":60,"fat":18}');
  lab = await readLabelPhoto(withOwnKey, 'QUJD');
  check('with no backend a label is read with the own key', lab?.candidate.kcalPer100 === 450 && lab.candidate.name === 'Granola');
  reset();
  handler = aiFood('{"basis":"per100g"}');
  lab = await readLabelPhoto(withOwnKey, 'QUJD');
  check('an own-key label with no calories is null', lab === null);
  reset();
  handler = (url) => (url.startsWith(BACKEND) ? ok({ error: 'Daily photo limit reached.' }, 429) : ok({}, 500));
  msg = '';
  try {
    await readLabelPhoto(withBackend, 'QUJD');
  } catch (e: any) {
    msg = e.message;
  }
  check('a label limit message is shown', msg.includes('limit'));
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
