/**
 * Training statistics: how much of each body part you've worked, how many
 * sessions you've done, and which days you trained. Pure functions over the
 * finished-workout history already in the app; no backend needed.
 */

import type { Exercise, MuscleGroup, Workout } from '../types/training';

// ---------------------------------------------------------------------------
// Muscle distribution
// ---------------------------------------------------------------------------

/** The six broad regions shown on the radar, and which fine-grained groups roll into each. */
export type BodyRegion = 'Back' | 'Chest' | 'Core' | 'Shoulders' | 'Arms' | 'Legs';

export const REGION_ORDER: BodyRegion[] = ['Back', 'Chest', 'Core', 'Shoulders', 'Arms', 'Legs'];

const REGION_OF: Record<MuscleGroup, BodyRegion> = {
  back: 'Back',
  lats: 'Back',
  traps: 'Back',
  chest: 'Chest',
  abs: 'Core',
  obliques: 'Core',
  shoulders: 'Shoulders',
  biceps: 'Arms',
  triceps: 'Arms',
  forearms: 'Arms',
  quads: 'Legs',
  hamstrings: 'Legs',
  glutes: 'Legs',
  calves: 'Legs',
};

export type Distribution = Record<BodyRegion, number>;

const zeroDistribution = (): Distribution => ({ Back: 0, Chest: 0, Core: 0, Shoulders: 0, Arms: 0, Legs: 0 });

/**
 * Raw training load per region: for every completed, non-warmup set, each
 * region gets a share equal to that exercise's muscle-weight fraction for it.
 * A compound lift like a bench press credits Chest more than Shoulders,
 * matching the weights already used for the muscle-thumbnail diagrams.
 */
export function rawDistribution(
  workouts: Workout[],
  getExercise: (id: string) => Exercise | undefined,
  range?: { from: number; to: number }
): Distribution {
  const out = zeroDistribution();
  for (const w of workouts) {
    // A draft (endedAt null) is never counted, range or no range.
    if (w.endedAt === null) continue;
    if (range && (w.endedAt < range.from || w.endedAt > range.to)) continue;
    for (const we of w.exercises) {
      const ex = getExercise(we.exerciseId);
      if (!ex) continue;
      const workingSets = we.sets.filter((s) => s.completedAt > 0 && !s.isWarmup).length;
      if (workingSets === 0) continue;
      for (const m of ex.muscles) {
        out[REGION_OF[m.group]] += workingSets * m.weight;
      }
    }
  }
  return out;
}

/** Distribution scaled 0-100, with the busiest region at 100 - what the radar draws. */
export function normalizedDistribution(d: Distribution): Distribution {
  const max = Math.max(...REGION_ORDER.map((r) => d[r]));
  if (max <= 0) return zeroDistribution();
  const out = zeroDistribution();
  for (const r of REGION_ORDER) out[r] = Math.round((d[r] / max) * 1000) / 10;
  return out;
}

export function hasAnyTraining(d: Distribution): boolean {
  return REGION_ORDER.some((r) => d[r] > 0);
}

// ---------------------------------------------------------------------------
// Session counts
// ---------------------------------------------------------------------------

export interface SessionCounts {
  week: number;
  month: number;
  lifetime: number;
}

function startOfWeek(now: number): number {
  const d = new Date(now);
  const day = d.getDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // days since Monday
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

function startOfMonth(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}

export function sessionCounts(workouts: Workout[], now: number): SessionCounts {
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  let week = 0;
  let month = 0;
  let lifetime = 0;
  for (const w of workouts) {
    if (w.endedAt === null) continue;
    lifetime++;
    if (w.endedAt >= monthStart) month++;
    if (w.endedAt >= weekStart) week++;
  }
  return { week, month, lifetime };
}

// ---------------------------------------------------------------------------
// Training calendar
// ---------------------------------------------------------------------------

/** YYYY-MM-DD in the device's local timezone, not UTC, so "today" matches the calendar on screen. */
export function localDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The set of local dates (YYYY-MM-DD) on which a workout was finished. */
export function trainingDays(workouts: Workout[]): Set<string> {
  const out = new Set<string>();
  for (const w of workouts) {
    if (w.endedAt !== null) out.add(localDateKey(w.endedAt));
  }
  return out;
}

/** Every date from `days - 1` ago through today, oldest first, for a calendar strip or grid. */
export function calendarRange(now: number, days: number): string[] {
  const out: string[] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(d.getDate() - i);
    out.push(localDateKey(d.getTime()));
  }
  return out;
}
