/**
 * Cloudflare Workers entry point. All logic is in handler.ts; this file only
 * connects it to the platform's cache and (optional) key-value store.
 */
import { Cache, Counters, Env, handle } from './handler';
import { handleData } from './data';
import { handleSocial } from './social';
import type { D1Database } from './db';

// Minimal platform types, so this file needs no extra type package.
interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}
declare const caches: { default: { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> } };

type Bindings = Env & { RATE?: KV; DB?: D1Database };

const memory = new Map<string, { n: number; exp: number }>();

function edgeCache(): Cache {
  const req = (key: string) => new Request(`https://vitalx-cache.internal/${encodeURIComponent(key)}`);
  return {
    async get(key) {
      const hit = await caches.default.match(req(key));
      return hit ? hit.text() : null;
    },
    async put(key, value, ttl) {
      await caches.default.put(req(key), new Response(value, { headers: { 'Cache-Control': `public, max-age=${ttl}` } }));
    },
  };
}

/**
 * Counters live in KV when it is bound, which is shared by every server
 * location. Without KV they live in memory, which is per-server and resets
 * often, so limits are only approximate. The README explains how to add KV.
 */
function counters(env: Bindings): Counters {
  return {
    async incr(key, ttl) {
      if (env.RATE) {
        const next = (parseInt((await env.RATE.get(key)) ?? '0', 10) || 0) + 1;
        await env.RATE.put(key, String(next), { expirationTtl: Math.max(60, ttl) });
        return next;
      }
      const now = Date.now();
      const cur = memory.get(key);
      const n = cur && cur.exp > now ? cur.n + 1 : 1;
      memory.set(key, { n, exp: now + ttl * 1000 });
      return n;
    },
  };
}

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    // Social routes (auth, sync, profiles, follows, likes) and personal
    // data sync need the D1 database. Everything else (food, barcodes,
    // photos) does not, and still works even before D1 is configured.
    if (env.DB) {
      const social = (await handleSocial(request, env.DB)) ?? (await handleData(request, env.DB));
      if (social) return social;
    }
    return handle(request, env, { cache: edgeCache(), counters: counters(env), now: () => Date.now() });
  },
};
