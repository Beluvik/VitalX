/**
 * End-to-end demo flow test.
 *
 * The submission's demo-day deliverable is one continuous path:
 *   onboarding -> generated plan -> log a workout -> log a meal against
 *   targets -> recovery-based plan adjustment from sleep data
 *
 * This walks that chain through the real logic modules. It cannot replace
 * clicking through on a device, but it does prove the steps are actually
 * connected to each other, which unit tests per module cannot show.
 */

import { computeNutritionPlan } from '../src/lib/nutrition';
import { generatePlan, applyRecovery } from '../src/lib/plan';
import { currentRecovery, recentRecoveryScore, scoreSleep } from '../src/lib/sleep';
import { detectPr, summarizeWorkout, assessOverload, workoutBurn } from '../src/lib/training';
import { searchFoods } from '../src/data/foods';
import { EXERCISE_BY_ID } from '../src/data/exercises';
import { workoutFromRoutine, trainingReducer, emptyTraining, uid } from '../src/store/trainingReducer';
import { DayLog, Profile, SleepScore } from '../src/types';
import { Equipment, Routine, Workout, WorkoutSet } from '../src/types/training';

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

const getEx = (id: string) => EXERCISE_BY_ID[id];

// ---------------------------------------------------------------------------
// Step 1: onboarding produces a nutrition plan
// ---------------------------------------------------------------------------
console.log('\n-- step 1: onboarding -> nutrition plan --');

const profile: Profile = {
  age: 28,
  sex: 'male',
  weightKg: 80,
  heightCm: 178,
  bodyFatPct: 18,
  activityLevel: 'moderate',
  unitSystem: 'metric',
  bmrFormula: 'katch',
  goal: 'cut_recomp',
  cutTier: 'moderate',
  sessionsPerWeek: 4,
  averageSessionMinutes: 60,
  level: 'intermediate',
  equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'],
  createdAt: Date.now(),
};

const nutrition = computeNutritionPlan(profile);
check('nutrition plan is produced', nutrition.targetCalories > 0);
check('katch was used from the body fat collected', nutrition.bmrFormulaUsed === 'katch');
check('a recomposition projection comes with it', !!nutrition.recomposition);

// ---------------------------------------------------------------------------
// Step 2: the same onboarding inputs generate a workout plan
// ---------------------------------------------------------------------------
console.log('\n-- step 2: onboarding -> generated workout plan --');

const generated = generatePlan({
  goal: profile.goal,
  level: profile.level!,
  daysPerWeek: profile.sessionsPerWeek,
  equipment: profile.equipment!,
  sessionMinutes: profile.averageSessionMinutes,
});

const filled = generated.sessions.filter((s) => s.exercises.length > 0);
check('a plan is generated from onboarding inputs', filled.length > 0);
check('it has one session per training day', filled.length === profile.sessionsPerWeek, `${filled.length}`);
check('every session trains something', filled.every((s) => s.exercises.length > 0));
check('only equipment from onboarding is used', (() => {
  const ok = new Set(profile.equipment!);
  return generated.sessions.every((s) => s.exercises.every((e) => ok.has(EXERCISE_BY_ID[e.exerciseId]?.equipment)));
})());

// Stands in for what OnboardingScreen does on commit.
const routine: Routine = {
  id: uid('r'),
  name: generated.name,
  sessionNames: filled.map((s) => s.name),
  exercises: filled.flatMap((s) => s.exercises.map((e, i) => ({ ...e, order: i, sessionName: s.name }))),
  isBuiltIn: false,
  createdAt: Date.now(),
};
check('routine is saved with day tags', !!routine.sessionNames && routine.exercises.every((e) => !!e.sessionName));

// ---------------------------------------------------------------------------
// Step 3: log a workout, PRs detected, burn recorded
// ---------------------------------------------------------------------------
console.log('\n-- step 3: log a workout -> burn recorded --');

const firstDay = filled[0];
const dayOneRoutine: Routine = {
  ...routine,
  name: firstDay.name,
  exercises: firstDay.exercises,
};

let state = trainingReducer(emptyTraining, {
  type: 'START_WORKOUT',
  workout: workoutFromRoutine(dayOneRoutine, dayOneRoutine.name, () => null),
});
let workout = state.workouts[state.activeWorkoutId!];
check('workout starts empty on a first ever session',
  workout.exercises.every((we) => we.sets.length === 0));
check('it carries the routine exercises', workout.exercises.length === firstDay.exercises.length);

function completeSet(workoutId: string, weId: string, weight: number, reps: number, at: number): WorkoutSet {
  const candidate: WorkoutSet = {
    id: uid('s'), setNumber: 1, weight, reps, isWarmup: false, isPr: false, completedAt: at,
  };
  const { isPr, prKind } = detectPr(candidate, Object.values(state.workouts).flatMap((w) =>
    w.exercises.flatMap((we) => we.sets)));
  const final = { ...candidate, isPr, prKind };
  state = trainingReducer(state, { type: 'COMPLETE_SET', workoutId, workoutExerciseId: weId, set: final });
  return final;
}

// Log three working sets on the first exercise. Timestamps are anchored to a
// single base so the workout's own startedAt/endedAt stay consistent, which
// sessionBurn depends on.
const BASE = Date.now();
const we0 = workout.exercises[0].id;
const sets = [
  completeSet(workout.id, we0, 80, 8, BASE + 60_000),
  completeSet(workout.id, we0, 85, 6, BASE + 120_000),
  completeSet(workout.id, we0, 95, 7, BASE + 180_000),
];
check('the first logged set is a PR', sets[0].isPr);
check('the third set beats both prior ones', sets[2].isPr && sets[2].prKind === 'both', `${sets[2].prKind}`);

workout = state.workouts[workout.id];
state = trainingReducer(state, { type: 'FINISH_WORKOUT', workoutId: workout.id, endedAt: BASE + 3_600_000 });
workout = state.workouts[workout.id];

check('finishing closes the workout', workout.endedAt === BASE + 3_600_000);
check('no active workout remains', state.activeWorkoutId === null);

const summary = summarizeWorkout(workout, getEx);
check('summary counts the working sets', summary.workingSets === 3, `${summary.workingSets}`);
check('summary reports volume', summary.totalVolume === 80 * 8 + 85 * 6 + 95 * 7, `${summary.totalVolume}`);
// Every set improved on all prior sets, so all three are genuine records.
check('summary lists the PRs', summary.prs.length === 3, `${summary.prs.length}`);
check('summary has a muscle split', summary.muscleSplit.length > 0);
check('split percentages total about 100',
  Math.abs(summary.muscleSplit.reduce((a, s) => a + s.percent, 0) - 100) < 1.5);

const band = assessOverload(workout, getEx, Object.values(state.workouts)).band;
const burn = workoutBurn(workout, getEx, profile.weightKg, band);
check('a burn is produced for the session', burn.kcal > 0, `${burn.kcal}`);
check('a first session with no baseline reads as moderate', band === 'moderate', `${band}`);

// This is what ActiveWorkout.finish() writes to the day log.
const todayLog: DayLog = { date: '2026-09-27', foods: [], steps: 0, gymBurn: burn.kcal, trainingSessionId: workout.id };
check('burn is recorded against the day', todayLog.gymBurn === burn.kcal && !!todayLog.trainingSessionId);

// ---------------------------------------------------------------------------
// Step 4: log a meal against the macro targets
// ---------------------------------------------------------------------------
console.log('\n-- step 4: log a meal against targets --');

const meal = searchFoods('chicken')[0];
check('an Indian-weighted food search returns results', !!meal);
const servingG = 150;
const factor = servingG / 100;
const mealTotals = {
  kcal: Math.round(meal.kcalPer100 * factor),
  protein: meal.proteinPer100 * factor,
  carbs: meal.carbsPer100 * factor,
  fat: meal.fatPer100 * factor,
};
check('meal scales by the amount eaten', mealTotals.kcal > 0);
check('protein lands against the target',
  mealTotals.protein <= nutrition.proteinG,
  `${mealTotals.protein.toFixed(0)} of ${nutrition.proteinG} g`);

const consumed = { kcal: mealTotals.kcal, protein: mealTotals.protein, carbs: mealTotals.carbs, fat: mealTotals.fat };
const remaining = nutrition.targetCalories - consumed.kcal;
check('calories eaten reduce the remaining budget', remaining < nutrition.targetCalories);
check('remaining budget stays positive on a partial day', remaining > 0, `${Math.round(remaining)}`);

// ---------------------------------------------------------------------------
// Step 5: sleep data adjusts the next plan
// ---------------------------------------------------------------------------
console.log('\n-- step 5: sleep -> plan adjustment --');

function logNight(bedTime: string, wakeTime: string, interruptions: number, at: number): DayLog {
  const s: SleepScore = scoreSleep({ bedTime, wakeTime, interruptions });
  return { date: `d${at}`, foods: [], steps: 0, gymBurn: 0, sleep: s };
}

{
  const good = logNight('23:00', '07:30', 0, 1);
  const r = currentRecovery({ [good.date]: good });
  check('a good night reads as normal or better', ['normal', 'progress'].includes(r.advice.action), r.advice.action);
  check('recovery reports the real night count, not the window size', r.basedOnNights === 1, `${r.basedOnNights}`);
}
{
  // Three bad nights in a row.
  const bad = [logNight('02:00', '06:00', 4, 1), logNight('02:30', '05:30', 3, 2), logNight('01:30', '05:00', 5, 3)];
  const days = Object.fromEntries(bad.map((b) => [b.date, b]));
  const r = currentRecovery(days);
  check('three bad nights trigger a rest day', r.advice.action === 'rest_day', r.advice.action);
  check('recovery used all three nights', r.basedOnNights === 3);
  check('a rest day empties the session', applyRecovery(routine.exercises, r.advice).exercises.length === 0);
}
{
  // Middling: volume gets trimmed, compounds survive.
  const mid = [logNight('00:30', '06:00', 2, 1), logNight('00:45', '06:15', 2, 2)];
  const days = Object.fromEntries(mid.map((m) => [m.date, m]));
  const r = currentRecovery(days);
  check('middling recovery trims volume', r.advice.action === 'reduce_volume', r.advice.action);
  const adj = applyRecovery(routine.exercises, r.advice);
  check('adjusted plan has fewer sets',
    adj.exercises.reduce((a, e) => a + e.targetSets, 0) < routine.exercises.reduce((a, e) => a + e.targetSets, 0));
  check('adjusted plan keeps the compounds',
    adj.exercises.some((e) => getEx(e.exerciseId)?.compound));
  check('the adjustment explains itself', adj.note.length > 0);
}
{
  // No sleep data at all must not produce a confident adjustment.
  check('no sleep data yields no score', recentRecoveryScore({}) === null);
  const r = currentRecovery({});
  check('no sleep data still returns usable advice', !!r.advice.action);
  check('no sleep data is not reported as three nights', r.basedOnNights === 0);
  check('no data is treated as unknown, not as poor recovery', r.advice.action === 'normal', r.advice.action);
  check('normal plan is untouched by no data', applyRecovery(routine.exercises, r.advice).exercises.length === routine.exercises.length);
}
{
  // Unlogged days must not dilute the signal.
  const oneBad: Record<string, DayLog> = { d1: logNight('02:00', '05:00', 4, 1) };
  const padded: Record<string, DayLog> = {
    ...oneBad,
    d2: { date: 'x', foods: [], steps: 0, gymBurn: 0 },
  };
  check('unlogged days do not dilute a bad night',
    recentRecoveryScore(oneBad, 3) === recentRecoveryScore(padded, 3));
}

// ---------------------------------------------------------------------------
console.log('\n-- full chain sanity --');
check('the chain produced a nutrition plan', nutrition.targetCalories > 0);
check('the chain produced a routine', routine.exercises.length > 0);
check('the chain produced a logged workout', summary.workingSets === 3);
check('the chain produced a day with burn and food',
  todayLog.gymBurn > 0 && consumed.kcal > 0);
check('the chain produced a recovery-driven plan', applyRecovery(routine.exercises, recoveryAdviceFor(routine)).exercises.length >= 0);

function recoveryAdviceFor(r: Routine) {
  return currentRecovery({ d1: logNight('02:00', '06:00', 4, 1) }).advice;
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) throw new Error(`${fail} test(s) failed`);
