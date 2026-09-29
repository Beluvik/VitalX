/**
 * Draft-workout and recovery-choice tests.
 *
 * The rule under test: a workout in progress is a draft. It can be edited
 * freely, but it must not touch history, personal bests or records until the
 * user finishes it, and finishing must leave only what was really performed.
 *
 * Run with:  npm test
 */

import {
  draftStats,
  exerciseHistory,
  finalizeWorkout,
  finishedOnly,
  isFinished,
  personalBest,
  refreshPrs,
} from '../src/lib/training';
import { LIGHT_SESSION_MULTIPLIER, adviceCutsTraining, applyRecovery, planSession } from '../src/lib/plan';
import { recoveryAdvice } from '../src/lib/sleep';
import { emptyTraining, trainingReducer, TrainingState } from '../src/store/trainingReducer';
import { EXERCISE_BY_ID } from '../src/data/exercises';
import { RoutineExercise, Workout, WorkoutExercise, WorkoutSet } from '../src/types/training';

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
// fixtures
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

function set(id: string, weight: number, reps: number, completedAt: number, over: Partial<WorkoutSet> = {}): WorkoutSet {
  return { id, setNumber: 1, weight, reps, isWarmup: false, isPr: false, completedAt, ...over };
}

function we(id: string, exerciseId: string, sets: WorkoutSet[]): WorkoutExercise {
  return { id, exerciseId, order: 0, supersetGroup: null, sets };
}

function workout(id: string, startedAt: number, exercises: WorkoutExercise[], endedAt: number | null): Workout {
  return { id, routineId: null, name: id, startedAt, endedAt, notes: '', exercises };
}

/** A finished session from `days` ago. */
function saved(id: string, daysAgo: number, exerciseId: string, w: number, r: number): Workout {
  const start = T0 - daysAgo * DAY;
  return workout(id, start, [we(`${id}-we`, exerciseId, [set(`${id}-s1`, w, r, start + 60_000, { isPr: true, prKind: 'both' })])], start + 3_600_000);
}

function stateWith(...ws: Workout[]): TrainingState {
  const workouts: Record<string, Workout> = {};
  for (const w of ws) workouts[w.id] = w;
  return { ...emptyTraining, workouts };
}

const draftStart = T0;

function newDraft(): Workout {
  return workout(
    'draft',
    draftStart,
    [
      // a pre-filled placeholder: never performed, completedAt 0
      we('d-bench', 'bench-press', [set('ph', 100, 5, 0)]),
      we('d-row', 'lat-pulldown', []),
    ],
    null
  );
}

// ---------------------------------------------------------------------------
console.log('\n-- drafts are not history --');
const earlier = saved('old', 7, 'bench-press', 100, 5);
let st = trainingReducer(stateWith(earlier), { type: 'START_WORKOUT', workout: newDraft() });

check('a draft is not finished', !isFinished(st.workouts['draft']));
check('a saved workout is finished', isFinished(earlier));
check('finishedOnly drops the draft', finishedOnly(Object.values(st.workouts)).length === 1);
check('the draft is the active workout', st.activeWorkoutId === 'draft');
check('history ignores never-performed placeholder sets', exerciseHistory('bench-press', Object.values(st.workouts)).length === 1);

const before = personalBest('bench-press', finishedOnly(Object.values(st.workouts)));
check('best before today is the saved one', before.maxWeight === 100 && before.totalSets === 1);

// ---------------------------------------------------------------------------
console.log('\n-- logging and fixing sets --');
st = trainingReducer(st, {
  type: 'COMPLETE_SET',
  workoutId: 'draft',
  workoutExerciseId: 'd-bench',
  set: set('a', 105, 5, draftStart + 60_000),
});
let d = st.workouts['draft'];
const aSet = () => d.exercises[0].sets.find((s) => s.id === 'a') as WorkoutSet;
check('beating the saved best is a PR', aSet().isPr && aSet().prKind === 'both', JSON.stringify(aSet()));

// Typo: 205 instead of 105 makes a huge false record...
st = trainingReducer(st, {
  type: 'UPDATE_SET',
  workoutId: 'draft',
  workoutExerciseId: 'd-bench',
  set: { ...aSet(), weight: 205 },
});
d = st.workouts['draft'];
check('a typo can create a record', aSet().isPr && aSet().weight === 205);

// ...and fixing it must remove that record.
st = trainingReducer(st, {
  type: 'UPDATE_SET',
  workoutId: 'draft',
  workoutExerciseId: 'd-bench',
  set: { ...aSet(), weight: 95 },
});
d = st.workouts['draft'];
check('fixing the reps/weight removes the false record', !aSet().isPr && aSet().weight === 95);
check('an edit keeps the set in place and its time', aSet().completedAt === draftStart + 60_000 && d.exercises[0].sets.filter((s) => s.id === 'a').length === 1);

st = trainingReducer(st, {
  type: 'UPDATE_SET',
  workoutId: 'draft',
  workoutExerciseId: 'd-bench',
  set: { ...aSet(), weight: 110, reps: 5 },
});
d = st.workouts['draft'];
check('a later correction upward earns the record back', aSet().isPr);

// A second, heavier set should be flagged against the first one too.
st = trainingReducer(st, {
  type: 'COMPLETE_SET',
  workoutId: 'draft',
  workoutExerciseId: 'd-bench',
  set: set('b', 90, 5, draftStart + 120_000),
});
d = st.workouts['draft'];
const bSet = d.exercises[0].sets.find((s) => s.id === 'b') as WorkoutSet;
check('a lighter later set is not a PR', !bSet.isPr);

st = trainingReducer(st, { type: 'REMOVE_SET', workoutId: 'draft', workoutExerciseId: 'd-bench', setId: 'a' });
d = st.workouts['draft'];
check('removing a set removes it', !d.exercises[0].sets.some((s) => s.id === 'a'));
check('removing the record set re-flags the remaining set fairly', !d.exercises[0].sets.find((s) => s.id === 'b')!.isPr);

// put a good set back for the finish tests
st = trainingReducer(st, {
  type: 'COMPLETE_SET',
  workoutId: 'draft',
  workoutExerciseId: 'd-bench',
  set: set('c', 120, 3, draftStart + 180_000),
});
check('the draft is still not history while editing', finishedOnly(Object.values(st.workouts)).length === 1);
check('draft stats count performed sets only', draftStats(st.workouts['draft']).sets === 2 && draftStats(st.workouts['draft']).exercises === 1);

// ---------------------------------------------------------------------------
console.log('\n-- finishing --');
const done = trainingReducer(st, { type: 'FINISH_WORKOUT', workoutId: 'draft', endedAt: draftStart + 3_000_000 });
const fin = done.workouts['draft'];
check('finishing marks it saved', isFinished(fin) && fin.endedAt === draftStart + 3_000_000);
check('finishing clears the active workout', done.activeWorkoutId === null);
check('the untouched exercise is dropped', fin.exercises.length === 1 && fin.exercises[0].exerciseId === 'bench-press');
check('the placeholder set is dropped', !fin.exercises[0].sets.some((s) => s.id === 'ph'));
check('only performed sets remain', fin.exercises[0].sets.length === 2);
check('sets are renumbered in order', fin.exercises[0].sets.map((s) => s.setNumber).join() === '1,2');
check('the record is settled at finish', fin.exercises[0].sets.find((s) => s.id === 'c')!.isPr);
check('finished workout now counts as history', finishedOnly(Object.values(done.workouts)).length === 2);
check('history now includes its sets', personalBest('bench-press', finishedOnly(Object.values(done.workouts))).maxWeight === 120);

const bare = trainingReducer(stateWith(earlier), { type: 'START_WORKOUT', workout: newDraft() });
const nothing = trainingReducer(bare, { type: 'FINISH_WORKOUT', workoutId: 'draft', endedAt: T0 + 1000 });
check('finishing with nothing logged saves nothing', !nothing.workouts['draft']);
check('and clears the active workout', nothing.activeWorkoutId === null);
check('and leaves saved history alone', Object.keys(nothing.workouts).length === 1);
check('finalize returns null for an empty draft', finalizeWorkout(newDraft(), [earlier], T0 + 1) === null);

const gone = trainingReducer(st, { type: 'ABANDON_WORKOUT', workoutId: 'draft' });
check('discarding removes the draft', !gone.workouts['draft'] && gone.activeWorkoutId === null);
check('discarding leaves saved history untouched', gone.workouts['old'] === st.workouts['old']);

// ---------------------------------------------------------------------------
console.log('\n-- deleting history keeps records honest --');
const a = saved('a', 14, 'bench-press', 100, 5);
const b = saved('b', 7, 'bench-press', 105, 5);
const chain = stateWith(a, b);
const afterDelete = trainingReducer(chain, { type: 'DELETE_WORKOUT', workoutId: 'a' });
const bAfter = afterDelete.workouts['b'].exercises[0].sets[0];
check('after deleting the older session the newer one becomes the first record', bAfter.isPr && bAfter.prKind === 'both', JSON.stringify(bAfter));

const c = saved('c', 3, 'bench-press', 102, 5);
const three = trainingReducer(stateWith(a, b, c), { type: 'DELETE_WORKOUT', workoutId: 'a' });
check('a lighter later session is not a record', !three.workouts['c'].exercises[0].sets[0].isPr);

const midDraft = trainingReducer(stateWith(a), { type: 'START_WORKOUT', workout: newDraft() });
const del = trainingReducer(midDraft, { type: 'DELETE_WORKOUT', workoutId: 'a' });
check('deleting history never touches the draft in progress', del.workouts['draft'] !== undefined && del.activeWorkoutId === 'draft');

const refreshed = refreshPrs(fin, [earlier]);
check('refreshPrs is stable on an already-settled workout', JSON.stringify(refreshed) === JSON.stringify(fin));

// ---------------------------------------------------------------------------
console.log('\n-- recovery choice --');
const routine: RoutineExercise[] = ['bench-press', 'incline-db-press', 'lat-pulldown', 'cable-fly', 'rope-pushdown'].map((id, i) => ({
  exerciseId: id,
  order: i,
  targetSets: 4,
  targetRepsMin: 8,
  targetRepsMax: 12,
  restSeconds: 90,
}));
const setsOf = (xs: RoutineExercise[]) => xs.reduce((n, e) => n + e.targetSets, 0);
const reduce = recoveryAdvice(6);
const rest = recoveryAdvice(3);
const normal = recoveryAdvice(7.5);
const great = recoveryAdvice(8.2);

check('low recovery cuts training', adviceCutsTraining(reduce) && adviceCutsTraining(rest));
check('normal and good recovery do not', !adviceCutsTraining(normal) && !adviceCutsTraining(great));

const followed = planSession(routine, reduce, 'recommended');
check('following a reduce-volume warning gives fewer sets', setsOf(followed.exercises) < setsOf(routine), `${setsOf(followed.exercises)} vs ${setsOf(routine)}`);
check('it keeps the main lifts', followed.exercises.some((e) => e.exerciseId === 'bench-press'));
check('it keeps the loads: only sets change, never reps', followed.exercises.every((e) => e.targetRepsMin === 8 && e.targetRepsMax === 12));

const ignored = planSession(routine, reduce, 'planned');
check('choosing the full plan changes nothing', setsOf(ignored.exercises) === setsOf(routine) && ignored.exercises === routine);

const light = planSession(routine, rest, 'recommended');
check('training on a rest day gives a light session', setsOf(light.exercises) <= Math.round(setsOf(routine) * (LIGHT_SESSION_MULTIPLIER + 0.15)), `${setsOf(light.exercises)}`);
check('a light session is lighter than the trimmed one', setsOf(light.exercises) < setsOf(followed.exercises));
check('a light session is never empty', light.exercises.length > 0);
check('a rest day with the full plan still runs the plan', setsOf(planSession(routine, rest, 'planned').exercises) === setsOf(routine));
check('normal recovery runs the plan', setsOf(planSession(routine, normal, 'recommended').exercises) === setsOf(routine));
check('strong recovery still earns the extra set', setsOf(planSession(routine, recoveryAdvice(8.9, 60, 70), 'recommended').exercises) === setsOf(routine) + routine.length);
check('applyRecovery on a real rest day is unchanged for callers that use it', applyRecovery(routine, rest).exercises.length === 0);
check('every routine exercise exists in the library', routine.every((e) => !!EXERCISE_BY_ID[e.exerciseId]));

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) throw new Error(`${fail} test(s) failed`);
