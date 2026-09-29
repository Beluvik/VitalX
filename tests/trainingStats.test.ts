/**
 * Tests for the muscle radar, session counts and training calendar.
 * Run with:  npm test
 */

import { EXERCISE_BY_ID } from '../src/data/exercises';
import {
  calendarRange,
  hasAnyTraining,
  localDateKey,
  normalizedDistribution,
  rawDistribution,
  sessionCounts,
  trainingDays,
} from '../src/lib/trainingStats';
import type { Workout, WorkoutExercise, WorkoutSet } from '../src/types/training';

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

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 29, 12); // Tuesday 29 Sep 2026, 12:00 UTC

function set(id: string, completedAt: number, warmup = false): WorkoutSet {
  return { id, setNumber: 1, weight: 40, reps: 8, isWarmup: warmup, isPr: false, completedAt };
}
function we(exerciseId: string, sets: WorkoutSet[]): WorkoutExercise {
  return { id: `we-${exerciseId}`, exerciseId, order: 0, supersetGroup: null, sets };
}
function workout(id: string, endedAt: number | null, exercises: WorkoutExercise[]): Workout {
  return { id, routineId: null, name: id, startedAt: (endedAt ?? NOW) - 3600_000, endedAt, notes: '', exercises };
}
const getExercise = (id: string) => EXERCISE_BY_ID[id];

// ---------------------------------------------------------------------------
console.log('\n-- muscle distribution --');
const bench = getExercise('bench-press');
check('bench press is on record with chest as its main mover', !!bench && bench.muscles[0].group === 'chest');

const oneBench = workout('a', NOW, [we('bench-press', [set('s1', NOW)])]);
const d = rawDistribution([oneBench], getExercise);
check('a completed set credits its exercise\'s muscles', d.Chest > 0);
check('an unworked region stays at zero', d.Legs === 0 && d.Back === 0);

const squatOnly = workout('b', NOW, [we('back-squat', [set('s1', NOW), set('s2', NOW)])]);
const squat = rawDistribution([squatOnly], getExercise);
check('two sets credit twice one set does', squat.Legs === 2 * rawDistribution([workout('c', NOW, [we('back-squat', [set('s1', NOW)])])], getExercise).Legs);

const warm = workout('w', NOW, [we('bench-press', [set('s1', NOW, true), set('s2', NOW, false)])]);
check('warmup sets are not counted', rawDistribution([warm], getExercise).Chest === d.Chest);

const draft = workout('d', null, [we('bench-press', [set('s1', NOW)])]);
check('an unfinished workout is not counted', rawDistribution([draft], getExercise).Chest === 0);

check('an unknown exercise id does not crash and adds nothing', rawDistribution([workout('x', NOW, [we('not-a-real-exercise', [set('s1', NOW)])])], getExercise).Chest === 0);

const both = rawDistribution([oneBench, squatOnly], getExercise);
check('distribution sums across workouts', both.Chest === d.Chest && both.Legs === squat.Legs);

const inRange = rawDistribution([oneBench], getExercise, { from: NOW - DAY, to: NOW + DAY });
const outOfRange = rawDistribution([oneBench], getExercise, { from: NOW + DAY, to: NOW + 2 * DAY });
check('a workout inside the date range counts', inRange.Chest > 0);
check('a workout outside the date range does not', outOfRange.Chest === 0);

const norm = normalizedDistribution(both);
check('the busiest region normalizes to 100', Math.max(...Object.values(norm)) === 100);
check('an empty distribution normalizes to all zero, not NaN', Object.values(normalizedDistribution({ Back: 0, Chest: 0, Core: 0, Shoulders: 0, Arms: 0, Legs: 0 })).every((n) => n === 0));
check('hasAnyTraining is true once something is logged', hasAnyTraining(both) && !hasAnyTraining({ Back: 0, Chest: 0, Core: 0, Shoulders: 0, Arms: 0, Legs: 0 }));

const lat = getExercise('lat-pulldown');
check('a lat exercise splits across Back and Arms as its weights say', !!lat && lat.muscles.some((m) => m.group === 'lats') && lat.muscles.some((m) => m.group === 'biceps'));
const latDist = rawDistribution([workout('l', NOW, [we('lat-pulldown', [set('s1', NOW)])])], getExercise);
check('a multi-muscle exercise credits every region it touches', latDist.Back > 0 && latDist.Arms > 0);

let ranEveryExercise = true;
for (const id of Object.keys(EXERCISE_BY_ID)) {
  try {
    rawDistribution([workout('e', NOW, [we(id, [set('s1', NOW)])])], getExercise);
  } catch {
    ranEveryExercise = false;
  }
}
check('every real exercise in the library can be credited without error', ranEveryExercise);

// ---------------------------------------------------------------------------
console.log('\n-- session counts --');
const thisWeek = workout('tw', NOW, []);
const lastWeek = workout('lw', NOW - 8 * DAY, []);
const thisMonthNotWeek = workout('tm', NOW - 10 * DAY, []);
const longAgo = workout('la', NOW - 400 * DAY, []);
const unfinished = workout('u', null, []);
const sc = sessionCounts([thisWeek, lastWeek, thisMonthNotWeek, longAgo, unfinished], NOW);
check('this week only counts this week\'s session', sc.week === 1, `${sc.week}`);
// lastWeek (8 days ago) is still inside the same calendar month here, so it counts too.
check('this month includes everything from this calendar month', sc.month === 3, `${sc.month}`);
check('lifetime counts every finished workout', sc.lifetime === 4, `${sc.lifetime}`);
check('an in-progress draft is never counted', sc.lifetime !== 5);
check('no workouts gives all zeros', JSON.stringify(sessionCounts([], NOW)) === JSON.stringify({ week: 0, month: 0, lifetime: 0 }));

// ---------------------------------------------------------------------------
console.log('\n-- training calendar --');
check('a UTC midday timestamp keeps its date in a UTC-ish check', localDateKey(Date.UTC(2026, 8, 29, 0, 30)) === '2026-09-29' || localDateKey(Date.UTC(2026, 8, 29, 0, 30)) === '2026-09-28', localDateKey(Date.UTC(2026, 8, 29, 0, 30)));
check('the date key is always ten characters, YYYY-MM-DD', localDateKey(NOW).length === 10);
check('a single-digit month and day are zero-padded', localDateKey(Date.UTC(2026, 0, 5, 12)).split('-')[1] === '01' && localDateKey(Date.UTC(2026, 0, 5, 12)).split('-')[2] === '05');

const days = trainingDays([thisWeek, lastWeek, unfinished]);
check('a finished workout marks its day', days.has(localDateKey(NOW)));
check('an unfinished workout marks nothing', days.size === 2);
check('two workouts on the same day only mark it once', trainingDays([thisWeek, workout('t2', NOW + 3600_000, [])]).size === 1);

const range = calendarRange(NOW, 30);
check('a 30-day range has 30 entries', range.length === 30);
check('the range ends on today', range[range.length - 1] === localDateKey(NOW));
check('the range is in order, oldest first', range[0] < range[range.length - 1]);
check('every date in the range is unique', new Set(range).size === 30);
check('a 1-day range is just today', calendarRange(NOW, 1).length === 1 && calendarRange(NOW, 1)[0] === localDateKey(NOW));

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) throw new Error(`${fail} test(s) failed`);
