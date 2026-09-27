/**
 * Exercise library.
 *
 * Muscle weights within an exercise sum to 1 and represent that movement's
 * share of the stimulus. They are what the session muscle-split is computed
 * from, so they matter more than they look. A bench press is mostly chest but
 * not entirely, and pretending otherwise is what makes app splits useless.
 *
 * `met` is only meaningful for cardio, where the progressive-overload band is
 * meaningless. Strength work uses the band instead.
 */

import { Equipment, Exercise, MuscleContribution, MuscleGroup } from '../types/training';

type Row = [
  id: string,
  name: string,
  equipment: Equipment,
  compound: boolean,
  /** "group:weight,group:weight" */
  muscles: string,
  met?: number
];

const rows: Row[] = [
  // ---------------- push ----------------
  ['bench-press', 'Barbell bench press', 'barbell', true, 'chest:0.6,triceps:0.25,shoulders:0.15'],
  ['incline-db-press', 'Incline dumbbell press', 'dumbbell', true, 'chest:0.55,shoulders:0.3,triceps:0.15'],
  ['flat-db-press', 'Flat dumbbell press', 'dumbbell', true, 'chest:0.55,triceps:0.25,shoulders:0.2'],
  ['machine-chest-press', 'Machine chest press', 'machine', true, 'chest:0.75,triceps:0.2,shoulders:0.05'],
  ['push-up', 'Push-up', 'bodyweight', true, 'chest:0.5,triceps:0.3,shoulders:0.2'],
  ['dip', 'Parallel bar dip', 'bodyweight', true, 'chest:0.4,triceps:0.4,shoulders:0.2'],
  ['close-grip-bench', 'Close-grip bench press', 'barbell', true, 'triceps:0.5,chest:0.4,shoulders:0.1'],
  ['cable-fly', 'Cable fly', 'cable', false, 'chest:0.95,shoulders:0.05'],
  ['pec-deck', 'Pec deck', 'machine', false, 'chest:0.95,shoulders:0.05'],
  ['overhead-press', 'Standing overhead press', 'barbell', true, 'shoulders:0.55,triceps:0.3,traps:0.15'],
  ['db-shoulder-press', 'Seated dumbbell shoulder press', 'dumbbell', true, 'shoulders:0.6,triceps:0.25,traps:0.15'],
  ['lateral-raise', 'Dumbbell lateral raise', 'dumbbell', false, 'shoulders:0.9,traps:0.1'],
  ['cable-lateral-raise', 'Cable lateral raise', 'cable', false, 'shoulders:0.95,traps:0.05'],
  ['rear-delt-fly', 'Rear delt fly', 'dumbbell', false, 'shoulders:0.8,back:0.2'],
  ['face-pull', 'Face pull', 'cable', false, 'shoulders:0.5,back:0.4,traps:0.1'],
  ['triceps-pushdown', 'Triceps pushdown', 'cable', false, 'triceps:0.9,forearms:0.1'],
  ['rope-pushdown', 'Rope pushdown', 'cable', false, 'triceps:0.95,forearms:0.05'],
  ['skull-crusher', 'Skull crusher', 'barbell', false, 'triceps:0.9,forearms:0.1'],
  ['overhead-triceps-ext', 'Overhead triceps extension', 'cable', false, 'triceps:1.0'],
  ['triceps-dip', 'Bench dip', 'bodyweight', false, 'triceps:0.9,chest:0.1'],

  // ---------------- pull ----------------
  ['barbell-row', 'Barbell bent-over row', 'barbell', true, 'back:0.45,lats:0.25,biceps:0.15,hamstrings:0.1,forearms:0.05'],
  ['pendlay-row', 'Pendlay row', 'barbell', true, 'back:0.45,lats:0.25,traps:0.15,biceps:0.1,forearms:0.05'],
  ['seated-cable-row', 'Seated cable row', 'cable', true, 'back:0.4,lats:0.3,biceps:0.2,traps:0.1'],
  ['lat-pulldown', 'Lat pulldown', 'cable', true, 'lats:0.6,biceps:0.2,back:0.15,forearms:0.05'],
  ['pull-up', 'Pull-up', 'bodyweight', true, 'lats:0.55,biceps:0.25,back:0.2'],
  ['chin-up', 'Chin-up', 'bodyweight', true, 'lats:0.4,biceps:0.4,back:0.2'],
  ['t-bar-row', 'T-bar row', 'barbell', true, 'back:0.5,lats:0.2,biceps:0.15,forearms:0.15'],
  ['db-row', 'Single-arm dumbbell row', 'dumbbell', true, 'lats:0.35,back:0.3,biceps:0.2,forearms:0.15'],
  ['straight-arm-pulldown', 'Straight-arm pulldown', 'cable', false, 'lats:0.85,triceps:0.15'],
  ['barbell-curl', 'Barbell curl', 'barbell', false, 'biceps:0.9,forearms:0.1'],
  ['db-curl', 'Dumbbell curl', 'dumbbell', false, 'biceps:0.9,forearms:0.1'],
  ['hammer-curl', 'Hammer curl', 'dumbbell', false, 'biceps:0.65,forearms:0.35'],
  ['incline-db-curl', 'Incline dumbbell curl', 'dumbbell', false, 'biceps:0.95,forearms:0.05'],
  ['preacher-curl', 'Preacher curl', 'machine', false, 'biceps:0.95,forearms:0.05'],
  ['reverse-curl', 'Reverse curl', 'barbell', false, 'forearms:0.85,biceps:0.15'],
  ['db-shrug', 'Dumbbell shrug', 'dumbbell', false, 'traps:0.95,forearms:0.05'],

  // ---------------- legs ----------------
  ['back-squat', 'Barbell back squat', 'barbell', true, 'quads:0.45,glutes:0.3,hamstrings:0.15,calves:0.05,back:0.05'],
  ['front-squat', 'Front squat', 'barbell', true, 'quads:0.5,glutes:0.2,abs:0.1,back:0.1,hamstrings:0.1'],
  ['goblet-squat', 'Goblet squat', 'dumbbell', true, 'quads:0.45,glutes:0.2,hamstrings:0.15,abs:0.1,back:0.1'],
  ['leg-press', 'Leg press', 'machine', true, 'quads:0.55,glutes:0.3,hamstrings:0.1,calves:0.05'],
  ['hack-squat', 'Hack squat', 'machine', true, 'quads:0.6,glutes:0.25,hamstrings:0.1,calves:0.05'],
  ['bulgarian-split-squat', 'Bulgarian split squat', 'dumbbell', true, 'quads:0.45,glutes:0.3,hamstrings:0.15,calves:0.1'],
  ['walking-lunge', 'Walking lunge', 'dumbbell', true, 'quads:0.4,glutes:0.3,hamstrings:0.2,calves:0.1'],
  ['leg-extension', 'Leg extension', 'machine', false, 'quads:0.95,calves:0.05'],
  ['lying-leg-curl', 'Lying leg curl', 'machine', false, 'hamstrings:0.95,calves:0.05'],
  ['seated-leg-curl', 'Seated leg curl', 'machine', false, 'hamstrings:1.0'],
  ['nordic-curl', 'Nordic curl', 'bodyweight', true, 'hamstrings:0.9,glutes:0.1'],
  ['romanian-deadlift', 'Romanian deadlift', 'barbell', true, 'hamstrings:0.45,glutes:0.35,back:0.1,forearms:0.1'],
  ['hip-thrust', 'Barbell hip thrust', 'barbell', true, 'glutes:0.85,hamstrings:0.15'],
  ['glute-bridge', 'Glute bridge', 'bodyweight', true, 'glutes:0.8,hamstrings:0.2'],
  ['deadlift', 'Conventional deadlift', 'barbell', true, 'back:0.3,hamstrings:0.25,glutes:0.2,quads:0.1,traps:0.1,forearms:0.05'],
  ['sumo-deadlift', 'Sumo deadlift', 'barbell', true, 'glutes:0.35,hamstrings:0.3,back:0.2,quads:0.1,forearms:0.05'],
  ['calf-raise', 'Standing calf raise', 'machine', false, 'calves:1.0'],
  ['seated-calf-raise', 'Seated calf raise', 'machine', false, 'calves:1.0'],

  // ---------------- core ----------------
  ['plank', 'Plank', 'bodyweight', false, 'abs:0.75,obliques:0.15,shoulders:0.1'],
  ['side-plank', 'Side plank', 'bodyweight', false, 'obliques:0.7,abs:0.3'],
  ['cable-crunch', 'Cable crunch', 'cable', false, 'abs:0.9,obliques:0.1'],
  ['hanging-leg-raise', 'Hanging leg raise', 'bodyweight', false, 'abs:0.7,lats:0.2,obliques:0.1'],
  ['russian-twist', 'Russian twist', 'dumbbell', false, 'obliques:0.6,abs:0.4'],
  ['ab-wheel', 'Ab wheel rollout', 'bodyweight', false, 'abs:0.8,obliques:0.1,lats:0.1'],
  ['dead-bug', 'Dead bug', 'bodyweight', false, 'abs:0.8,obliques:0.2'],
  ['hollow-hold', 'Hollow hold', 'bodyweight', false, 'abs:0.9,obliques:0.1'],

  // ---------------- cardio ----------------
  // Overload bands are meaningless here, so these carry a MET value instead.
  ['treadmill-run', 'Treadmill run', 'cardio', true, 'quads:0.35,calves:0.35,hamstrings:0.3', 9.8],
  ['outdoor-run', 'Outdoor run', 'cardio', true, 'quads:0.35,calves:0.35,hamstrings:0.3', 9.0],
  ['cycling', 'Stationary cycle', 'cardio', false, 'quads:0.4,hamstrings:0.3,calves:0.3', 8.5],
  ['rowing-erg', 'Rowing machine', 'cardio', true, 'back:0.3,quads:0.25,hamstrings:0.25,lats:0.2', 7.0],
  ['elliptical', 'Elliptical', 'cardio', false, 'quads:0.4,glutes:0.25,hamstrings:0.35', 6.0],
  ['stair-climber', 'Stair climber', 'cardio', false, 'quads:0.4,calves:0.35,glutes:0.25', 8.8],
];

function parseMuscles(spec: string): MuscleContribution[] {
  return spec.split(',').map((part) => {
    const [group, weight] = part.split(':');
    return { group: group.trim() as MuscleGroup, weight: parseFloat(weight) };
  });
}

export const EXERCISES: Exercise[] = rows.map(([id, name, equipment, compound, muscles, met]) => ({
  id,
  name,
  equipment,
  compound,
  muscles: parseMuscles(muscles),
  isCustom: false,
  ...(met ? { met } : {}),
}));

export const EXERCISE_BY_ID: Record<string, Exercise> = EXERCISES.reduce((acc, e) => {
  acc[e.id] = e;
  return acc;
}, {} as Record<string, Exercise>);

export function getExercise(id: string, custom: Exercise[] = []): Exercise | undefined {
  return EXERCISE_BY_ID[id] ?? custom.find((e) => e.id === id);
}

/** Exercises the user can actually perform, given what they own. */
export function exercisesForEquipment(available: Equipment[]): Exercise[] {
  return EXERCISES.filter((e) => available.includes(e.equipment));
}

export function searchExercises(query: string, pool: Exercise[] = EXERCISES, limit = 30): Exercise[] {
  const q = query.trim().toLowerCase();
  if (!q) return pool.slice(0, limit);
  const starts: Exercise[] = [];
  const contains: Exercise[] = [];
  for (const e of pool) {
    const n = e.name.toLowerCase();
    if (n.startsWith(q)) starts.push(e);
    else if (n.includes(q) || e.id.includes(q.replace(/\s+/g, '-').replace(/[^a-z-]/g, ''))) contains.push(e);
  }
  return [...starts, ...contains].slice(0, limit);
}

export function primaryMuscle(e: Exercise): MuscleGroup {
  return [...e.muscles].sort((a, b) => b.weight - a.weight)[0].group;
}
