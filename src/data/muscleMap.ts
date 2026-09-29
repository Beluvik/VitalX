/**
 * Geometry for the muscle-highlight thumbnails shown next to exercise names.
 *
 * Kept as plain data, separate from the React component, so it can be tested:
 * every muscle group must have a region on at least one side, or an exercise
 * would render with nothing highlighted.
 *
 * All shapes live in a 60 x 100 viewBox.
 */

import type { Exercise, MuscleGroup } from '../types/training';

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r?: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'poly'; points: string };

export type BodySide = 'front' | 'back';

export const VIEWBOX = '0 0 60 100';

/** The neutral figure drawn behind the highlighted muscles. */
export const BODY_SHAPES: Shape[] = [
  { kind: 'ellipse', cx: 30, cy: 10, rx: 6.5, ry: 7.5 }, // head
  { kind: 'rect', x: 27, y: 16, w: 6, h: 5, r: 2 }, // neck
  { kind: 'poly', points: '14,22 46,22 40,58 20,58' }, // torso
  { kind: 'rect', x: 7, y: 22, w: 7, h: 22, r: 3 }, // left upper arm
  { kind: 'rect', x: 46, y: 22, w: 7, h: 22, r: 3 }, // right upper arm
  { kind: 'rect', x: 5.5, y: 44, w: 6.5, h: 18, r: 3 }, // left forearm
  { kind: 'rect', x: 48, y: 44, w: 6.5, h: 18, r: 3 }, // right forearm
  { kind: 'rect', x: 19.5, y: 58, w: 10, h: 24, r: 4 }, // left thigh
  { kind: 'rect', x: 30.5, y: 58, w: 10, h: 24, r: 4 }, // right thigh
  { kind: 'rect', x: 20.5, y: 82, w: 8, h: 16, r: 3 }, // left shin
  { kind: 'rect', x: 31.5, y: 82, w: 8, h: 16, r: 3 }, // right shin
];

export const REGIONS: Record<BodySide, Partial<Record<MuscleGroup, Shape[]>>> = {
  front: {
    chest: [
      { kind: 'rect', x: 16, y: 24, w: 13.5, h: 10, r: 4 },
      { kind: 'rect', x: 30.5, y: 24, w: 13.5, h: 10, r: 4 },
    ],
    shoulders: [
      { kind: 'ellipse', cx: 12, cy: 26, rx: 5.5, ry: 5 },
      { kind: 'ellipse', cx: 48, cy: 26, rx: 5.5, ry: 5 },
    ],
    biceps: [
      { kind: 'rect', x: 8, y: 31, w: 5.5, h: 11, r: 2.5 },
      { kind: 'rect', x: 46.5, y: 31, w: 5.5, h: 11, r: 2.5 },
    ],
    forearms: [
      { kind: 'rect', x: 6.5, y: 46, w: 4.5, h: 14, r: 2 },
      { kind: 'rect', x: 49, y: 46, w: 4.5, h: 14, r: 2 },
    ],
    abs: [{ kind: 'rect', x: 24, y: 36, w: 12, h: 20, r: 3 }],
    obliques: [
      { kind: 'rect', x: 18, y: 38, w: 5, h: 16, r: 2 },
      { kind: 'rect', x: 37, y: 38, w: 5, h: 16, r: 2 },
    ],
    quads: [
      { kind: 'rect', x: 20.5, y: 60, w: 8, h: 20, r: 3 },
      { kind: 'rect', x: 31.5, y: 60, w: 8, h: 20, r: 3 },
    ],
  },
  back: {
    traps: [{ kind: 'poly', points: '30,18 41,24 30,35 19,24' }],
    lats: [
      { kind: 'poly', points: '16,28 26,33 26,50 21,50' },
      { kind: 'poly', points: '44,28 34,33 34,50 39,50' },
    ],
    back: [{ kind: 'rect', x: 25, y: 36, w: 10, h: 20, r: 3 }],
    shoulders: [
      { kind: 'ellipse', cx: 12, cy: 26, rx: 5.5, ry: 5 },
      { kind: 'ellipse', cx: 48, cy: 26, rx: 5.5, ry: 5 },
    ],
    triceps: [
      { kind: 'rect', x: 8, y: 31, w: 5.5, h: 11, r: 2.5 },
      { kind: 'rect', x: 46.5, y: 31, w: 5.5, h: 11, r: 2.5 },
    ],
    forearms: [
      { kind: 'rect', x: 6.5, y: 46, w: 4.5, h: 14, r: 2 },
      { kind: 'rect', x: 49, y: 46, w: 4.5, h: 14, r: 2 },
    ],
    glutes: [
      { kind: 'ellipse', cx: 25, cy: 59, rx: 5.5, ry: 5 },
      { kind: 'ellipse', cx: 35, cy: 59, rx: 5.5, ry: 5 },
    ],
    hamstrings: [
      { kind: 'rect', x: 20.5, y: 65, w: 8, h: 15, r: 3 },
      { kind: 'rect', x: 31.5, y: 65, w: 8, h: 15, r: 3 },
    ],
    calves: [
      { kind: 'rect', x: 21, y: 83, w: 7, h: 13, r: 3 },
      { kind: 'rect', x: 32, y: 83, w: 7, h: 13, r: 3 },
    ],
  },
};

/** Which side of the body shows the most of this exercise's work. */
export function sideFor(exercise: Pick<Exercise, 'muscles'>): BodySide {
  let front = 0;
  let back = 0;
  for (const m of exercise.muscles) {
    const inFront = !!REGIONS.front[m.group];
    const inBack = !!REGIONS.back[m.group];
    if (inFront && !inBack) front += m.weight;
    else if (inBack && !inFront) back += m.weight;
  }
  return back > front ? 'back' : 'front';
}

export interface Highlight {
  group: MuscleGroup;
  shapes: Shape[];
  /** 0.35 (minor) to 1 (main mover), so the main muscle stands out. */
  opacity: number;
}

/** The regions to colour for this exercise, on the side chosen for it. */
export function highlightsFor(exercise: Pick<Exercise, 'muscles'>): { side: BodySide; items: Highlight[] } {
  const side = sideFor(exercise);
  const items: Highlight[] = [];
  for (const m of exercise.muscles) {
    const shapes = REGIONS[side][m.group];
    if (!shapes) continue;
    items.push({
      group: m.group,
      shapes,
      opacity: m.weight >= 0.5 ? 1 : m.weight >= 0.25 ? 0.65 : 0.35,
    });
  }
  return { side, items };
}
