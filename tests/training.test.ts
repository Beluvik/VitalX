/**
 * Training engine tests.
 *
 * PR detection is the highest-risk logic in the app: get it wrong and the app
 * either never celebrates a record or hands out fake ones, and both destroy
 * the reason people log sets at all.
 *
 * Run with:  npm test
 */

import {
  assessOverload,
  detectPr,
  exerciseHistory,
  muscleSplit,
  personalBest,
  progressionTarget,
  setVolume,
  summarizeWorkout,
  workoutBurn,
  workingSets,
} from '../src/lib/training';
import { generatePlan, splitFor, applyRecovery, estimateDurationSeconds } from '../src/lib/plan';
import { EXERCISE_BY_ID, exercisesForEquipment } from '../src/data/exercises';
import { recoveryAdvice } from '../src/lib/sleep';
import { Equipment, MuscleGroup, Workout, WorkoutExercise, WorkoutSet } from '../src/types/training';

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
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/**
 * Sets get timestamps relative to the workout that contains them, the way the
 * real app does. Building them out of a global counter made timestamp-based
 * queries meaningless and hid a real bug in assessOverload.
 */
function mkWorkout(
  exerciseId: string,
  sets: { weight: number; reps: number; isWarmup?: boolean }[],
  startedAt = 1_000_000
): Workout {
  const we: WorkoutExercise = {
    id: `we-${exerciseId}-${startedAt}`,
    exerciseId,
    order: 0,
    supersetGroup: null,
    sets: sets.map((s, i) => ({
      id: `s-${exerciseId}-${startedAt}-${i}`,
      setNumber: i + 1,
      weight: s.weight,
      reps: s.reps,
      isWarmup: s.isWarmup ?? false,
      isPr: false,
      completedAt: startedAt + 60_000 + i * 60_000,
    })),
  };
  return {
    id: `w-${startedAt}`,
    routineId: null,
    name: 'Test',
    startedAt,
    endedAt: startedAt + 3_600_000,
    notes: '',
    exercises: [we],
  };
}

/** A standalone set with an explicit timestamp, for PR comparisons. */
function mkSet(over: Partial<WorkoutSet> = {}): WorkoutSet {
  const { completedAt, ...rest } = over;
  return {
    id: `s-${over.id ?? Math.random().toString(36).slice(2)}`,
    setNumber: 1,
    weight: 100,
    reps: 10,
    isWarmup: false,
    isPr: false,
    completedAt: completedAt ?? 0,
    ...rest,
  };
}

const getEx = (id: string) => EXERCISE_BY_ID[id];

// ---------------------------------------------------------------------------
console.log('\n-- volume --');
check('set volume is weight x reps', setVolume(mkSet({ weight: 100, reps: 5 })) === 500);
check('warm-ups contribute no volume', setVolume(mkSet({ weight: 60, reps: 10, isWarmup: true })) === 0);
check('workingSets filters warm-ups', workingSets([mkSet(), mkSet({ isWarmup: true }), mkSet()]).length === 2);

// ---------------------------------------------------------------------------
console.log('\n-- personal records --');
const t0 = 1000, t1 = 2000, t2 = 3000, t3 = 4000, t4 = 5000;
const base     = mkSet({ id: 'base', weight: 100, reps: 5, completedAt: t0 }); // vol 500
const moreReps = mkSet({ id: 'more', weight: 100, reps: 8, completedAt: t1 }); // vol 800
const heavier  = mkSet({ id: 'heavy', weight: 110, reps: 6, completedAt: t2 }); // vol 660
const weaker   = mkSet({ id: 'weak', weight: 90, reps: 4, completedAt: t3 });  // vol 360
const both     = mkSet({ id: 'both', weight: 120, reps: 8, completedAt: t4 }); // vol 960

check('very first set is a PR of both kinds', detectPr(base, []).prKind === 'both');
check('warm-up is never a PR', detectPr(mkSet({ isWarmup: true }), [base]).isPr === false);
check('beating both weight and volume', detectPr(both, [base, moreReps]).prKind === 'both');

{
  // Heavier than anything before, but a smaller set than the 8-rep best.
  const r = detectPr(heavier, [base, moreReps]);
  check('heavier but lower volume is a weight PR only', r.isPr && r.prKind === 'weight', `${r.prKind}`);
}
{
  const r = detectPr(moreReps, [base]);
  check('more reps at the same weight is a volume PR only', r.isPr && r.prKind === 'volume', `${r.prKind}`);
}
{
  const r = detectPr(weaker, [base, moreReps, heavier, both]);
  check('worse than everything is not a PR', !r.isPr, `${r.prKind}`);
}
{
  // A set must not be compared against sets logged after it.
  const later = mkSet({ id: 'later', weight: 300, reps: 3, completedAt: 9_999_999 });
  const r = detectPr(base, [later]);
  check('future sets are ignored', r.prKind === 'both', `${r.prKind}`);
}
{
  // Re-logging the identical set is not a new record.
  const r = detectPr(mkSet({ id: 'same', weight: 100, reps: 5, completedAt: t4 }), [base, moreReps, heavier, both]);
  check('matching an existing best is not a PR', !r.isPr);
}

// ---------------------------------------------------------------------------
console.log('\n-- personal best --');
{
  const w = mkWorkout('bench-press', [
    { weight: 100, reps: 5 },
    { weight: 110, reps: 5 },
    { weight: 100, reps: 8 },
    { weight: 50, reps: 15, isWarmup: true },
  ]);
  const best = personalBest('bench-press', [w]);
  check('heaviest weight found', best.maxWeight === 110, `${best.maxWeight}`);
  check('reps for heaviest found', best.maxWeightReps === 5);
  check('best volume set found', best.maxVolume === 800, `${best.maxVolume}`);
  check('warm-ups excluded from bests', best.totalSets === 3, `${best.totalSets}`);
  check('unknown exercise returns zeros', personalBest('nope', [w]).maxWeight === 0);

  // Bests must be scoped to the exercise.
  const other = mkWorkout('back-squat', [{ weight: 200, reps: 3 }]);
  check('bests do not leak across exercises', personalBest('bench-press', [w, other]).maxWeight === 110);
}

// ---------------------------------------------------------------------------
console.log('\n-- history --');
{
  const w1 = mkWorkout('bench-press', [{ weight: 100, reps: 5 }, { weight: 110, reps: 5 }], 1_000_000);
  const w2 = mkWorkout('bench-press', [{ weight: 100, reps: 8 }], 2_000_000);

  const all = exerciseHistory('bench-press', [w1, w2]);
  check('history spans workouts', all.length === 3, `${all.length}`);
  check('history is oldest first', all[0].completedAt < all[all.length - 1].completedAt);
  check('cutoff filters later workouts', exerciseHistory('bench-press', [w1, w2], { before: 1_500_000 }).length === 2);
  check('workout can be excluded by id', exerciseHistory('bench-press', [w1, w2], { excludeWorkoutId: w2.id }).length === 2);
}

// ---------------------------------------------------------------------------
console.log('\n-- muscle split --');
{
  const w = mkWorkout('bench-press', [{ weight: 100, reps: 10 }]); // 1000 volume
  const split = muscleSplit(w, getEx);
  const chest = split.find((s) => s.group === 'chest')!;
  const triceps = split.find((s) => s.group === 'triceps')!;
  check('chest is the biggest earner from a bench press', chest.volume > triceps.volume);
  check('chest gets 60% of the volume', chest.volume === 600, `${chest.volume}`);
  check('percentages sum to about 100',
    near(split.reduce((a, s) => a + s.percent, 0), 100, 1),
    `${split.reduce((a, s) => a + s.percent, 0)}`);
  check('split is sorted by volume', split[0].volume >= split[1].volume);
}
{
  const split = muscleSplit(mkWorkout('bench-press', [{ weight: 50, reps: 15, isWarmup: true }]), getEx);
  check('warm-up-only session has no split', split.length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n-- summary --');
{
  const w = mkWorkout('bench-press', [{ weight: 100, reps: 5 }, { weight: 110, reps: 6 }]);
  // Mark the second set as a record, as the UI would have.
  w.exercises[0].sets[1] = { ...w.exercises[0].sets[1], isPr: true, prKind: 'weight' };
  const s = summarizeWorkout(w, getEx);
  check('duration from started/ended', s.durationMinutes === 60, `${s.durationMinutes}`);
  check('total volume', s.totalVolume === 1160, `${s.totalVolume}`);
  check('working sets counted', s.workingSets === 2);
  check('PRs listed by name', s.prs.length === 1 && s.prs[0].exerciseName === 'Barbell bench press');
  check('summary includes a split', s.muscleSplit.length === 3);
}

// ---------------------------------------------------------------------------
console.log('\n-- overload assessment --');
{
  const first = mkWorkout('bench-press', [{ weight: 100, reps: 5 }]);
  check('no history defaults to moderate', assessOverload(first, getEx, [first]).band === 'moderate');
}
{
  const w1 = mkWorkout('bench-press', [{ weight: 100, reps: 5 }], 1_000_000);
  const w2 = mkWorkout('bench-press', [{ weight: 110, reps: 6 }], 2_000_000);
  const r = assessOverload(w2, getEx, [w1, w2]);
  check('improving on history reads as strong', r.band === 'strong', `${r.band} ${r.improved}/${r.compared}`);
  check('the session is excluded from its own baseline', r.compared === 1, `${r.compared}`);
}
{
  const w1 = mkWorkout('bench-press', [{ weight: 110, reps: 6 }], 1_000_000);
  const w2 = mkWorkout('bench-press', [{ weight: 90, reps: 4 }], 2_000_000);
  check('going backwards reads as minimal', assessOverload(w2, getEx, [w1, w2]).band === 'minimal');
}

// ---------------------------------------------------------------------------
console.log('\n-- session burn --');
{
  const w = mkWorkout('bench-press', [{ weight: 100, reps: 10 }, { weight: 110, reps: 10 }], 1_000_000);
  const strong = workoutBurn(w, getEx, 80, 'strong');
  const minimal = workoutBurn(w, getEx, 80, 'minimal');
  check('overload band changes the estimate', strong.kcal > minimal.kcal, `${strong.kcal} vs ${minimal.kcal}`);
  check('strength uses the overload band', strong.method === 'overload');
}
{
  const w = mkWorkout('treadmill-run', [{ weight: 0, reps: 1 }, { weight: 0, reps: 1 }, { weight: 0, reps: 1 }], 1_000_000);
  const b = workoutBurn(w, getEx, 80, 'minimal');
  // 9.8 MET x 80 kg x 1 h = 784
  check('cardio uses MET, not the overload band', b.method === 'met' && near(b.kcal, 784, 5), `${b.kcal} ${b.method}`);
  check('a 1h run beats a 250 kcal band', b.kcal > 500, `${b.kcal}`);
}

// ---------------------------------------------------------------------------
console.log('\n-- progression --');
{
  const w = mkWorkout('bench-press', [{ weight: 80, reps: 8 }]);
  const t = progressionTarget('bench-press', [w])!;
  check('adds a rep when below the ceiling', t.reps === 9, `${t.reps}`);
  const hard = mkWorkout('bench-press', [{ weight: 80, reps: 10 }]);
  const t2 = progressionTarget('bench-press', [hard])!;
  check('drops reps when the set is maxed', t2.reps === 8, `${t2.reps}`);
  check('first attempt has no target', progressionTarget('brand-new', []) === null);
}

// ---------------------------------------------------------------------------
console.log('\n-- plan splits --');
check('1 day -> 1 session', splitFor(1).length === 1);
check('2 days -> upper/lower', splitFor(2).length === 2);
check('3 days -> full body', splitFor(3).length === 3 && splitFor(3)[0].startsWith('Full Body'));
check('4 days -> 4 sessions', splitFor(4).length === 4);
check('5 days -> push/pull/legs', splitFor(5).includes('Push') && splitFor(5).includes('Legs'));
check('7 days caps sensibly', splitFor(7).length === 7);
check('0 days does not crash', splitFor(0).length >= 1);

// ---------------------------------------------------------------------------
console.log('\n-- plan generation: equipment --');
{
  const plan = generatePlan({
    goal: 'cut_recomp',
    level: 'beginner',
    daysPerWeek: 3,
    equipment: ['barbell'],
    sessionMinutes: 60,
  });
  const used = plan.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId));
  const available = new Set(exercisesForEquipment(['barbell']).map((e) => e.id));
  check('only uses available equipment', used.every((id) => available.has(id)),
    used.filter((id) => !available.has(id)).join(','));
  check('generates a non-empty plan', used.length > 0);
}
{
  // Bodyweight only: no barbell moves should survive.
  const plan = generatePlan({
    goal: 'bulk',
    level: 'advanced',
    daysPerWeek: 2,
    equipment: ['bodyweight'],
    sessionMinutes: 45,
  });
  const used = plan.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId));
  check('no barbell moves in a bodyweight plan', used.every((id) => !id.includes('barbell') && !id.includes('bench') || id === 'incline-db-press'),
    used.join(','));
  check('bodyweight plan still trains the legs', used.some((id) => ['back-squat', 'glute-bridge', 'plank'].includes(id) || getEx(id)?.muscles.some((m) => m.group === 'quads' || m.group === 'glutes')));
}

// ---------------------------------------------------------------------------
console.log('\n-- plan generation: structure --');
{
  const plan = generatePlan({
    goal: 'cut_recomp',
    level: 'intermediate',
    daysPerWeek: 4,
    equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'],
    sessionMinutes: 60,
  });
  check('4-day plan has 4 sessions', plan.sessions.length === 4);
  check('every session has exercises', plan.sessions.every((s) => s.exercises.length > 0));
  check('no duplicate exercises within a session',
    plan.sessions.every((s) => new Set(s.exercises.map((e) => e.exerciseId)).size === s.exercises.length));
  check('compound work is included',
    plan.sessions.some((s) => s.exercises.some((e) => getEx(e.exerciseId)?.compound)));
  check('orders are sequential',
    plan.sessions.every((s) => s.exercises.every((e, i) => e.order === i)));
}
{
  // A very short session must not keep piling on isolation work.
  const short = generatePlan({
    goal: 'cut_recomp', level: 'intermediate', daysPerWeek: 2,
    equipment: ['barbell', 'dumbbell', 'cable', 'machine'], sessionMinutes: 20,
  });
  const long = generatePlan({
    goal: 'cut_recomp', level: 'intermediate', daysPerWeek: 2,
    equipment: ['barbell', 'dumbbell', 'cable', 'machine'], sessionMinutes: 120,
  });
  const count = (p: typeof short) => p.sessions.reduce((a, s) => a + s.exercises.length, 0);
  check('a short session is smaller than a long one', count(short) < count(long), `${count(short)} vs ${count(long)}`);
}
{
  // Advanced level should carry more volume than beginner for the same session.
  const beg = generatePlan({ goal: 'bulk', level: 'beginner', daysPerWeek: 2, equipment: ['barbell', 'dumbbell', 'cable', 'machine'], sessionMinutes: 90 });
  const adv = generatePlan({ goal: 'bulk', level: 'advanced', daysPerWeek: 2, equipment: ['barbell', 'dumbbell', 'cable', 'machine'], sessionMinutes: 90 });
  const sets = (p: typeof beg) => p.sessions.reduce((a, s) => a + s.exercises.reduce((b, e) => b + e.targetSets, 0), 0);
  check('advanced plans prescribe more sets', sets(adv) > sets(beg), `${sets(adv)} vs ${sets(beg)}`);
}
{
  const plan = generatePlan({ goal: 'bulk', level: 'intermediate', daysPerWeek: 2, equipment: ['cable', 'machine', 'dumbbell'], sessionMinutes: 60 });
  check('duration estimate is positive', plan.estimatedMinutes > 0);
  check('duration matches the built sessions',
    near(plan.estimatedMinutes, Math.round(plan.sessions.reduce((a, s) => a + estimateDurationSeconds(s.exercises), 0) / plan.sessions.length / 60), 1));
}
{
  const empty = generatePlan({ goal: 'bulk', level: 'intermediate', daysPerWeek: 3, equipment: [], sessionMinutes: 60 });
  check('no equipment produces a note', empty.notes.length > 0);
  check('no equipment produces no exercises', empty.sessions.every((s) => s.exercises.length === 0));
}

// ---------------------------------------------------------------------------
console.log('\n-- recovery adjusts the plan --');
{
  const plan = generatePlan({ goal: 'cut_recomp', level: 'intermediate', daysPerWeek: 1, equipment: ['barbell', 'dumbbell', 'cable', 'machine'], sessionMinutes: 90 });
  const original = plan.sessions[0].exercises;
  const normal = applyRecovery(original, recoveryAdvice(7));
  check('normal recovery leaves the plan alone', normal.exercises.length === original.length);

  const rest = applyRecovery(original, recoveryAdvice(2));
  check('a rest day empties the session', rest.exercises.length === 0);
  check('a rest day is explained', rest.note.length > 0);

  const trim = applyRecovery(original, recoveryAdvice(5));
  check('poor recovery reduces volume',
    trim.exercises.reduce((a, e) => a + e.targetSets, 0) < original.reduce((a, e) => a + e.targetSets, 0));
  check('poor recovery keeps compounds',
    trim.exercises.some((e) => getEx(e.exerciseId)?.compound));

  const up = applyRecovery(original, recoveryAdvice(9, 55, 70));
  check('strong recovery adds a set',
    up.exercises.reduce((a, e) => a + e.targetSets, 0) > original.reduce((a, e) => a + e.targetSets, 0));
}

// ---------------------------------------------------------------------------
console.log('\n-- exercise data integrity --');
{
  const all = Object.values(EXERCISE_BY_ID);
  check('library is populated', all.length > 50, `${all.length}`);
  check('every muscle weight set sums to 1',
    all.every((e) => near(e.muscles.reduce((a, m) => a + m.weight, 0), 1, 0.01)),
    all.filter((e) => !near(e.muscles.reduce((a, m) => a + m.weight, 0), 1, 0.01)).map((e) => e.id).join(','));
  check('no duplicate exercise ids', new Set(all.map((e) => e.id)).size === all.length);
  check('every exercise trains at least one muscle', all.every((e) => e.muscles.length > 0));
  check('all cardio exercises declare a MET',
    all.filter((e) => e.equipment === 'cardio').every((e) => typeof e.met === 'number' && e.met > 0));
  check('no strength exercise declares a MET',
    all.filter((e) => e.equipment !== 'cardio').every((e) => e.met === undefined));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) throw new Error(`${fail} test(s) failed`);
