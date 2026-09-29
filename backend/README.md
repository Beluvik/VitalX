# VitalX backend

A small server that sits between the app and the outside services. It:

- **holds the API keys**, so the app ships with none and users add nothing
- **caches food lookups**, so the free USDA limit stops mattering
- **reads photos** (food and nutrition labels) on the app's behalf
- **rate-limits photo reading**, so one phone cannot use up the free quota

It has no accounts, no database of people, and it does not keep photos or meal logs.
Photos are passed to the AI service and forgotten. Food searches are cached by text only.

It runs on **Cloudflare Workers** (free tier: 100,000 requests a day). There is no
machine to keep awake.

The app works without it. With no server address set, the app talks to the food
databases directly, and photo reading needs the user's own key in Setup. If the
server is down, the app falls back to that too.

---

## Deploy it (about 15 minutes, Windows PowerShell)

### 1. Get three things

| What | Where | Cost |
|---|---|---|
| Cloudflare account | dash.cloudflare.com/sign-up | free |
| USDA API key | fdc.nal.usda.gov, search "API key signup" | free |
| An AI key that accepts images | aistudio.google.com (Google AI Studio) | free tier |

For the AI service you also need the exact **model name** from that provider's model list.
It must be a model that accepts images. Model names change, so copy it from the site.

### 2. Install

```powershell
cd C:\VitalX-final\VitalX\backend
npm.cmd install
```

### 3. Set the model

Open `wrangler.toml` and put the model name between the quotes:

```toml
VISION_MODEL = "the-model-name-you-copied"
```

`VISION_BASE_URL` is already set for Google's service. Change it only if you use another
OpenAI-compatible service.

### 4. Log in

```powershell
npx.cmd wrangler login
```

A browser window opens. Approve it.

### 5. Store the secrets

Each command asks you to paste the value. Nothing is written to any file.

```powershell
npx.cmd wrangler secret put USDA_API_KEY
npx.cmd wrangler secret put VISION_API_KEY
npx.cmd wrangler secret put APP_TOKEN
```

For `APP_TOKEN` make up a long random string, for example 30 random letters and numbers.
You will paste the same string into the app in step 8.

### 6. Turn on shared rate limits (recommended)

```powershell
npx.cmd wrangler kv namespace create RATE
```

It prints an `id`. In `wrangler.toml`, remove the `#` from the three `kv_namespaces` lines and
paste the id in.

Without this the limits still work, but they are counted separately on each server
location and reset often, so they are only approximate.

### 6b. Create the database (accounts, sync and backup)

```powershell
npx.cmd wrangler d1 create vitalx-db
```

It prints a `database_id`. In `wrangler.toml`, remove the `#` from the four `[[d1_databases]]` lines
and paste the id in. Then create the tables:

```powershell
npx.cmd wrangler d1 execute vitalx-db --remote --file=schema.sql
```

Without this, food search and photos still work, but sign-in, sync and backup do not.
If you set the database up before the personal-data tables existed, run the same
command again: every statement is `CREATE ... IF NOT EXISTS`, so it only adds what is missing.

### 7. Deploy

```powershell
npx.cmd wrangler deploy
```

It prints an address like `https://vitalx-api.yourname.workers.dev`.

Check it by opening `https://vitalx-api.yourname.workers.dev/health` in a browser. You should
see `"ok":true`, and `photoReading` and `usdaKey` should both say `true`.

### 8. Point the app at it

Open `src/config.ts` in the app and fill in both values:

```ts
export const BACKEND_URL = 'https://vitalx-api.yourname.workers.dev';
export const BACKEND_TOKEN = 'the-same-string-as-APP_TOKEN';
```

Then rebuild the app. Phones that already have the app can also type the address into
Food, then Setup, without a rebuild.

### 9. Check it works for real

From the app folder (not `backend`):

```powershell
$env:BACKEND_URL = "https://vitalx-api.yourname.workers.dev"
$env:APP_TOKEN = "the-same-string-as-APP_TOKEN"
npm.cmd run live-check
```

This asks the real USDA and Open Food Facts services, and your server, and runs the app's
own readers on the answers. Every line should say PASS. A FAIL line names what did not work.

---

## Things to know

**The app token is a speed bump, not security.** Anything inside an app can be extracted
from the installed file. The token only keeps casual strangers off. The protection that
matters is the daily limits (30 photos per phone and 800 in total by default, set in
`wrangler.toml`) and the fact that the AI key itself never leaves the server. If someone
abuses the server, change `APP_TOKEN` with `wrangler secret put` and rebuild the app.

**Free tier limits.** Cloudflare's free KV store allows about 1,000 writes a day, and each
photo reading uses two. That is roughly 500 photo readings a day before the limiter can no
longer record counts, at which point photo reading fails safe and shows the "unavailable"
message. Food search and barcodes are unaffected, because they use the edge cache and not KV.

**What is stored.** Food searches and barcode results are cached by their text or number for
up to a week (a month for a found barcode). Photos and meal logs are never stored. Errors
are logged without the photo.

**Running it on your own machine.**
Copy `.dev.vars.example` to `.dev.vars`, fill it in, then `npx.cmd wrangler dev`. A phone
cannot reach `localhost`, so use the deployed address for real testing.

## Endpoints

| Method and path | What it does |
|---|---|
| `GET /health` | Which features are switched on. No secrets. |
| `GET /foods/search?q=paneer` | Searches USDA and Open Food Facts, cached. |
| `GET /foods/barcode/8901058000019` | Looks up a barcode. `{found:false}` if unknown. |
| `POST /vision/food` | `{ image: <base64> }` returns `{ items: [{name, grams}] }`. |
| `POST /vision/label` | `{ image: <base64> }` returns a reading, or 422 if unreadable. |

Accounts and social (need the database, see step 6b):

| Method and path | What it does |
|---|---|
| `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Accounts and sessions. |
| `PATCH /me/profile` | Display name, bio, public or private. |
| `POST /workouts/sync`, `GET /workouts/sync?since=` | Workout backup, with a public flag per workout. |
| `GET /profile/:username`, `POST`/`DELETE /profile/:username/follow` | Public profiles and follows. |
| `POST`/`DELETE /workouts/:id/like`, `POST /workouts/:id/copy`, `GET /feed` | Likes, copying a routine, the feed. |

Personal data sync (private to the signed-in user, never shown to anyone else):

| Method and path | What it does |
|---|---|
| `POST /sync` | `{ since, changes: { <collection>: [record] } }` stores this phone's changes and returns everything stored since `since`, with a `cursor` for next time. Call again while `more` is true. |
| `GET /data/:collection?since=` | Lists one collection. |
| `PUT /data/:collection/:id` | `{ data, updatedAt? }` stores one record. |
| `DELETE /data/:collection/:id` | Deletes one record (kept as a tombstone so other phones remove it too). |

Collections: `profile`, `days`, `foods`, `routines`, `recipes`, `exercises`, `badges`. A record is
`{ id, updatedAt, deleted?, data }`. When two phones edit the same record, the newer `updatedAt`
wins. A phone whose clock runs ahead is capped near server time so it cannot win every conflict.
Each call takes at most 500 records, each at most 64 KB. `schema.sql` documents every table.

The app syncs by itself whenever the user is signed in: at sign-in (which is how a new phone
restores everything), a few seconds after any change, and when the app comes back to the
foreground.

The food and photo endpoints (except `/health`) need the `X-App-Token` header when `APP_TOKEN`
is set. Account, social and sync endpoints are protected by the signed-in session instead
(`Authorization: Bearer <token>`); they do not check `X-App-Token`.
Photo reading also uses an `X-Device-Id` header for its per-phone limit.
