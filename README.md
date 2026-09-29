# VitalX

All-in-one fitness, nutrition and recovery app. Android + iOS, React Native (Expo), dark theme,
offline-first, no backend.

Built for the ASYNC 2026 Wellness & Lifestyle track.

---

## Running it

Node 18+ required. On Windows, `npm` may be blocked by PowerShell execution policy — use
`npm.cmd` instead of `npm`.

```bash
npm install
npm start          # then press a / i, or scan the QR code with Expo Go
```

Other commands:

```bash
npm run verify     # version check + typecheck + all 180 tests
npm run doctor     # expo install --check, dependency drift only
npm test           # 180 tests (57 engine + 76 training + 47 demo flow)
npm run typecheck  # tsc --noEmit
```

### Dependency versions are pinned to the Expo SDK

Every runtime dependency is pinned to the version Expo SDK 54 expects:

| Package | Version |
|---|---|
| `expo` | ~54.0.0 |
| `react` | 19.1.0 |
| `react-native` | 0.81.5 |
| `react-native-svg` | 15.12.1 |
| `react-native-safe-area-context` | ~5.6.0 |
| `@react-native-async-storage/async-storage` | 2.2.0 |
| `expo-status-bar` | ~3.0.9 |
| `@types/react` | ~19.1.10 |

**These must not drift.** Expo Go ships one specific React Native and React runtime, so a
mismatched `react-native` or `react` version produces a bundle that typechecks and even bundles
cleanly, then crashes on load. Run `npm run doctor` after any `npm install <pkg>`, and if a
version ever needs changing use `npx expo install <pkg>` rather than hand-editing `package.json`.

Note that `tsc` and `expo export` will both pass with the wrong versions installed. Neither is
sufficient to catch a version problem.

### On your phone, no Mac needed

Install **Expo Go** from the Play Store or App Store, run `npm start`, and scan the QR code.
That runs the app on a real device with no native build step.

**For a real iOS build you need a Mac.** Apple only allows iOS compilation on macOS, so the
`.ipa` has to be produced on a Mac or through a cloud build service (Expo EAS Build). Android
builds work from Windows.

---

## What's built

| Area | Status |
|---|---|
| Onboarding (age, sex, weight, height, units, formula, activity, goal, tier) | Done |
| Nutrition engine (BMR x2, TDEE, tier adjustment, macro split, safety floors) | Done |
| Sleep & recovery scoring (3 questions, REM estimate, recovery advice) | Done |
| Food search + logging with live macro tracking | Done |
| Indian-weighted food database (~75 items) | Done |
| Exercise library (~80 movements with muscle mappings) | Done |
| Plan generator (level + equipment + time → split) | Done |
| Training log: prefill from history, live PR detection, rest timer | Done |
| Session summary: volume, PRs, muscle-group split | Done |
| Exercise history with progression chart | Done |
| Routine builder (CRUD, sets/reps/rest) | Done |
| Recovery-based plan adjustment from sleep data | Done |
| Demo flow wired end to end, 5/5 steps | Done |
| Pedometer, barcode scan, badge gallery, illustrations | **Not built** |
| Drag-to-reorder in routine builder | Buttons instead (see limits) |

---

## The demo flow

The submission's demo-day deliverable is one continuous path. It is wired end to end, and
`tests/flow.test.ts` walks all five steps through the real logic modules.

```
1. Onboarding  ──►  calorie + macro targets on the dashboard
      │
      ├─ collects level and available equipment, so it can
      ▼
2. Generated plan  ──►  a split routine built from that equipment, saved automatically
      │
      ▼
3. Log a workout  ──►  sets prefilled from history, PRs at completion,
      │                muscle split, and the burn recorded against the day
      ▼
4. Log a meal  ──►  live macro progress against the targets
      │
      ▼
5. Sleep scored  ──►  the next session is trimmed, extended, or turned into a rest day
```

**Step 2 was previously unreachable from onboarding.** The submission says the plan is generated
"based on fitness level, available equipment, and time", but onboarding only asked for time.
Level and equipment are now collected in a "Your gym" step, and the plan is generated during
onboarding commit, so a plan is already waiting on the first screen.

**Step 3 now feeds the energy picture.** `assessOverload` and `workoutBurn` run on finish and
write to `DayLog.gymBurn`, which the dashboard reads. Previously the workout was logged and the
burn went nowhere.

**Step 5 reads from the same signal the dashboard shows.** `currentRecovery(days)` is called by
both the dashboard and the workout-start flow, so they cannot disagree about how recovered the
user is. A rest-day recommendation is treated as advice rather than a block: the session
proceeds and carries the warning, because it is the user's call.

**Absence of sleep data is not treated as poor recovery.** With nothing logged the advice is
`normal` and the plan is untouched. Defaulting to a rest day would tell a brand new user to stop
training on day one.

**Recovery thresholds**: below 5/10 triggers a rest day, 5-7 trims volume by about a third while
keeping compounds, 7+ runs as written, 8.5+ with good HRV adds a set. Below 5 is roughly four
hours of sleep with repeated wake-ups, which is not a day to train hard through.

---

## Nutrition spec, as implemented

Numbers come from the product spec, not from defaults.

**Calorie adjustment by goal and tier**

| Goal | Tier | Adjustment |
|---|---|---|
| `cut_recomp` — lose weight + gain muscle | slow / moderate / aggressive | −500 / −600 / −800 |
| `bulk` — gain weight + muscle | slight / moderate / excess | +250 / +550 / +1000 |
| `maintain_recomp` — maintain weight + gain muscle | — | 0 |
| `cut_fat_only` — lose body fat only | slow / moderate / aggressive | −500 / −600 / −800 |

**Macros** — protein from bodyweight, fat as a share of calories, carbs take the remainder:

- Protein `1.6 g/kg` floor; `1.8 g/kg` on recomposition goals where lean mass is the objective
- Fat `27.5%` of the post-adjustment target (spec allows 25–30%)
- Carbs = remainder, split ~70/30 complex-to-simple, plus a fibre target
- Protein above `2 g/kg` triggers a warning, per spec

**BMR** — Mifflin-St Jeor (needs sex) or Katch-McArdle (needs body-fat %). Katch falls back to
Mifflin if body fat is missing rather than producing a wrong number.

**TDEE** — BMR x standard activity multiplier. The multiplier already accounts for training
frequency, which is why tracked steps and gym burn are shown for *verification* rather than added
on top. Adding both would double-count.

**Gym burn** — progressive overload is the primary signal, duration refines it:

| Band | Base kcal | Midpoint (60 min) |
|---|---|---|
| Strong overload | 350–450 | 400 |
| A little overload | 300–350 | 325 |
| Full workout, no overload | 250+ | 250 |

**Steps** — `steps x 0.0005 x bodyweight_kg`. 10,000 steps ≈ 350 kcal at 70 kg.

**Sleep** —

- Duration scored linearly: 0 h = 0, 8.5 h = 10
- 30 minutes deducted from time in bed for time to fall asleep
- Interruptions: 10 minus one each, floored at 4
- REM **estimated** from adjusted duration and night quality (12–26%). A self-reported value
  always overrides the estimate.
- Recovery = 50% duration + 20% interruptions + 30% REM, plus a 0–3 consistency bonus
- Consistent bedtime/wake within ±30 min of the previous night builds a streak

**Goal (a) is a recomposition**, not a plain cut: lose fat and add lean mass at once. The app
shows an estimated weekly split, clearly labelled as a wide-error-bar estimate, and warns when
the combination is unrealistic (very low body fat, or under two sessions a week).

---

## Training

**Data model** follows the spec, with one naming change: the set type is `WorkoutSet`, because
`Set` collides with JavaScript's built-in. Field names are otherwise as specified.

- `Exercise` — library entry, not user data. Carries an equipment type, a compound flag, and
  **muscle weights that sum to 1** across the muscles it trains.
- `Routine` — a template. `sessionNames` plus a `sessionName` tag on each exercise let one flat
  list represent a multi-day split; without it a 3-day plan reads as one confusing list.
- `Workout` — a logged session, ad-hoc or from a routine.
- `WorkoutExercise` / `WorkoutSet` — with `isPr` and `prKind`.

**Personal records are decided at set-completion time**, comparing against the full known
history, exactly as specified. A PR the user sees 30 seconds late is not a PR. Two kinds are
tracked because they are different achievements:

| Kind | Meaning |
|---|---|
| `weight` | Heaviest load ever on the exercise |
| `volume` | Biggest single set by weight x reps, which rewards the harder rep range rather than just adding plate |
| `both` | First ever set, or a set that tops both |

The first set on an exercise counts as a record for both, otherwise a new movement would never
register anything. Warm-ups never count.

PRs are **re-derived** when a workout is finished and when one is deleted, so a record earned
against history that no longer exists stops being claimed.

**Prefill**: starting a session fills each exercise's first set with the user's best set from
their most recent session, in their display unit. The biggest perceived-speed win in a logging
app, and it's why the history is stored per set rather than per workout.

**Overload assessment** is inferred — each exercise's best set this session is compared against
the previous best, and the ratio picks the band. The current workout is excluded from its own
baseline by id rather than by timestamp, because set timestamps come from when a row was tapped,
not from when the workout began.

**Session burn** uses the overload band for strength work. A cardio-dominant session falls back
to MET (mean MET x kg x hours) instead, because scoring 45 minutes on a treadmill as "minimal
overload, 250 kcal" would be nonsense.

**Plan generation** declares *slots* (a muscle group plus a preference-ordered list of exercise
ids), never concrete exercises. The generator picks the first exercise per slot the user actually
has equipment for, then fits isolation work to the time budget. Compound slots are never dropped
for time. Available equipment genuinely changes the plan rather than leaving dead slots.

**Recovery adjustment**: a bad night trims volume while keeping compounds, a strong night plus
good HRV adds a set, and a very bad night converts the session to a rest day.

---

## Honest limits

These are deliberate and surfaced in the UI rather than hidden:

- **REM is an estimate, not a measurement.** There is no medical sensor here. It says so
  everywhere it appears, and self-reporting a real value overrides it.
- **Calorie burn is modelled, not measured.** The overload band is a proxy for effort that the
  user self-reports.
- **Recomposition projections have wide error bars.** A deficit is roughly 80% fat / 20% lean,
  which is a rule of thumb, not a law.
- **Low body fat plus a large deficit is flagged**, because those two goals genuinely conflict and
  the app should not promise otherwise.
- **No backend.** Data is local to one device. No accounts, no cloud sync, no sharing routines
  with other people. "Copy a routine" can only mean built-in templates or duplicating your own
  until a server exists.
- **No barcode scanning yet.** The label-photo route needs a vision model API, which costs money
  per scan. Barcode-only lookup against Open Food Facts would be free.
- **Reorder is by up/down buttons, not drag handles.** Drag-to-reorder needs a gesture library
  that adds real bundle weight for one interaction. Worth revisiting if reordering becomes a
  daily action rather than a setup-time one.
- **Overload bands are inferred from volume comparisons,** not measured. It matches what the user
  is actually doing in most cases, but a high-rep set at the same weight reads as progress and a
  genuinely hard effort that did not beat the previous best does not.

---

## Architecture

```
App.tsx                 tab shell, onboarding gate
src/
  types.ts              nutrition/sleep domain. Metric internally, display units at the edge.
  types/training.ts     training domain: exercises, routines, workouts, sets
  theme.ts              dark palette, spacing, type scale
  lib/
    nutrition.ts        BMR, TDEE, tiers, macro split, warnings, recomposition
    sleep.ts            sleep scoring, REM estimate, recovery advice
    energy.ts           gym burn from overload band + duration, step calories
    training.ts         PR detection, personal bests, volume, muscle split, overload
    plan.ts             slot templates, plan generation, recovery adjustment
    units.ts            kg/lb, cm/inch, protein density conversion
    format.ts           dates, durations, time formatting
  store/
    AppState.tsx        reducer + AsyncStorage, debounced persist
    trainingReducer.ts  training state, PR revalidation, workout factories
  data/
    foods.ts            food database, Indian foods first
    exercises.ts        exercise library with muscle weights and MET
  components/ui.tsx     shared primitives
  hooks/useRestTimer.ts rest timer
  screens/
    Onboarding, Plan, FoodLog, Sleep
    TrainScreen         training router
    train/              Hub, ActiveWorkout, PlanBuilder, RoutineBuilder,
                        WorkoutSummary, ExerciseHistory
tests/
  engine.test.ts        57 tests over nutrition, sleep and energy
  training.test.ts      76 tests over PRs, volume, splits and plan generation
  flow.test.ts          47 tests walking the five-step demo path
```

**Unit handling.** Everything is stored in metric and converted only at render. Protein targets
are specified as a *density* (`1.6 g/kg`), so a pound-based user gets `0.73 g/lb` rather than
`1.6 g/lb` — otherwise "1.6x bodyweight" would silently become 2.8x for them. The same applies
to logged weights.

**Why the engines are pure functions.** `nutrition.ts`, `sleep.ts`, `energy.ts`, `training.ts`
and `plan.ts` have no React and no I/O, so the code that produces health advice and records is
fully testable without a device. That is why `npm test` can verify all of it on Windows with no
emulator.

**Routing without a navigation library.** Four tabs plus a small training flow state machine,
hand-rolled. React Navigation adds four packages that have to version-match Expo; for this
shape it was not worth the install risk. Swapping it in later is contained to `App.tsx` and
`TrainScreen.tsx`.

---

## Next build chunks

1. **Pedometer** — `expo-sensors`, re-adds the plugin entry in `app.json`. Feeds the daily burn
   verification layer.
2. **Badges** — the PR and consistency hooks already call `unlockBadge`, they just have no
   gallery screen.
3. **Barcode scanning** — `expo-camera` + Open Food Facts, free.
4. **Machine and body illustrations** — one reusable front/back muscle diagram driven by the
   exercise muscle weights, plus ~30 line-art machine SVGs.
5. **Label photo scanning** — needs a paid vision model API, and a confirmation step so nothing
   enters the diary silently.
6. **Food images** — illustrated icons for common whole foods.


---

## Backend (optional, recommended)

`backend/` holds a small Cloudflare Worker that keeps the API keys off the phone, caches
food lookups and reads photos. See `backend/README.md` to deploy it, then set its address in
`src/config.ts`.

Commands:

- `npm test` runs all suites, including the backend against fake services.
- `npm run live-check` asks the real food databases (and your backend, if `BACKEND_URL` is
  set) and runs the app's readers on the real answers. Needs internet.
