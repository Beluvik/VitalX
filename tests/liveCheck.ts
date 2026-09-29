/**
 * Live check: asks the REAL food databases (and, if you set BACKEND_URL, your
 * deployed backend) and runs the app's own readers on what comes back.
 *
 * The normal tests use made-up responses. This is the one that tells you the
 * services still answer the way the app expects. It needs internet, so it is
 * not part of `npm test`.
 *
 * Run with:  npm run live-check
 *
 * Optional environment variables (PowerShell):
 *   $env:USDA_API_KEY = "your-key"      (default: the shared DEMO_KEY)
 *   $env:BACKEND_URL  = "https://vitalx-api.yourname.workers.dev"
 *   $env:APP_TOKEN    = "the token, if you set one"
 */

import { searchFoodsVia } from '../src/lib/api';
import { lookupBarcodeVia } from '../src/lib/api';
import { FoodCandidate, lookupBarcode, searchOff, searchUsda } from '../src/lib/foodApi';

declare const process: { env: Record<string, string | undefined>; exit(code: number): never };

const usdaKey = process.env.USDA_API_KEY || 'DEMO_KEY';
const backendUrl = (process.env.BACKEND_URL || '').trim();
const appToken = process.env.APP_TOKEN || '';

let passed = 0;
let failed = 0;
const pass = (name: string, detail = '') => {
  passed++;
  console.log(`  PASS  ${name}${detail ? `  (${detail})` : ''}`);
};
const bad = (name: string, why: string) => {
  failed++;
  console.log(`  FAIL  ${name}  ->  ${why}`);
};

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e: any) {
    const m = String(e?.message ?? e);
    bad(name, m.includes('rate') ? 'rate limited (the shared demo key is heavily limited, try your own key)' : `error: ${m}`);
  }
}

const sane = (c: FoodCandidate) =>
  typeof c.name === 'string' && c.name.length > 0 && isFinite(c.kcalPer100) && c.kcalPer100 >= 0 && c.kcalPer100 <= 900;

async function main() {
  console.log('\nVitalX live check\n');
  console.log(`USDA key: ${usdaKey === 'DEMO_KEY' ? 'shared DEMO_KEY (limited)' : 'your key'}`);
  console.log(`Backend:  ${backendUrl || 'not set (checking the databases directly)'}\n`);

  console.log('-- databases, directly --');
  await step('USDA search returns readable foods', async () => {
    const r = await searchUsda('tomato', usdaKey, 5);
    if (r.length === 0) return bad('USDA search returns readable foods', 'no usable results. The response format may have changed');
    if (!r.every(sane)) return bad('USDA search returns readable foods', 'a result had nonsense values');
    pass('USDA search returns readable foods', `${r.length} results, first: ${r[0].name}, ${r[0].kcalPer100} kcal`);
  });

  await step('USDA calories look right for olive oil', async () => {
    const r = await searchUsda('olive oil', usdaKey, 8);
    const oil = r.find((f) => /oil/i.test(f.name));
    if (!oil) return bad('USDA calories look right for olive oil', 'no oil in the results');
    if (oil.kcalPer100 < 780 || oil.kcalPer100 > 920) return bad('USDA calories look right for olive oil', `${oil.name} read as ${oil.kcalPer100} kcal per 100 g, expected about 884`);
    pass('USDA calories look right for olive oil', `${oil.name}: ${oil.kcalPer100} kcal`);
  });

  await step('Open Food Facts search returns readable foods', async () => {
    const r = await searchOff('tomato ketchup', 5);
    if (r.length === 0) return bad('Open Food Facts search returns readable foods', 'no usable results. The response format may have changed');
    if (!r.every(sane)) return bad('Open Food Facts search returns readable foods', 'a result had nonsense values');
    pass('Open Food Facts search returns readable foods', `${r.length} results, first: ${r[0].name}`);
  });

  await step('Open Food Facts finds a famous barcode', async () => {
    const c = await lookupBarcode('3017620422003');
    if (!c) return bad('Open Food Facts finds a famous barcode', 'product not found. The format may have changed');
    if (!sane(c) || c.kcalPer100 < 400) return bad('Open Food Facts finds a famous barcode', `unexpected values: ${JSON.stringify(c)}`);
    pass('Open Food Facts finds a famous barcode', `${c.name}, ${c.kcalPer100} kcal`);
  });

  await step('An unknown barcode is reported as not found', async () => {
    const c = await lookupBarcode('0000000000017');
    if (c !== null) return bad('An unknown barcode is reported as not found', `got ${c.name}`);
    pass('An unknown barcode is reported as not found');
  });

  if (backendUrl) {
    const s = { backendUrl, appToken, deviceId: 'live-check-device', usdaKey: '', visionBaseUrl: '', visionKey: '', visionModel: '' };
    console.log('\n-- your backend --');

    await step('Backend health', async () => {
      const res = await fetch(`${backendUrl.replace(/\/+$/, '')}/health`);
      const j: any = await res.json();
      if (!res.ok || j.ok !== true) return bad('Backend health', `status ${res.status}`);
      pass('Backend health', `photo reading ${j.photoReading ? 'on' : 'OFF'}, USDA key ${j.usdaKey ? 'set' : 'NOT set'}, token ${j.tokenRequired ? 'required' : 'not required'}`);
      if (!j.photoReading) console.log('        note: photo reading is off. Set VISION_MODEL and the VISION_API_KEY secret.');
      if (!j.usdaKey) console.log('        note: no USDA key on the server, so it uses the shared demo key.');
    });

    await step('Backend search works and is cached', async () => {
      const first = await searchFoodsVia(s, 'banana', 5);
      if (first.results.length === 0) return bad('Backend search works and is cached', `no results. Notes: ${first.notes.join(' | ')}`);
      const t0 = Date.now();
      await searchFoodsVia(s, 'banana', 5);
      pass('Backend search works and is cached', `${first.results.length} results, repeat took ${Date.now() - t0} ms`);
    });

    await step('Backend barcode works', async () => {
      const c = await lookupBarcodeVia(s, '3017620422003');
      if (!c) return bad('Backend barcode works', 'product not found through the backend');
      pass('Backend barcode works', c.name);
    });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    console.log('A failure above names what did not work. Send it to whoever maintains the app.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.log('Live check crashed:', e);
  process.exit(1);
});
