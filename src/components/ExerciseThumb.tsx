import React from 'react';
import { View } from 'react-native';
import Svg, { Ellipse, Polygon, Rect } from 'react-native-svg';

import { BODY_SHAPES, Shape, VIEWBOX, highlightsFor } from '../data/muscleMap';
import { colors, radius } from '../theme';
import type { Exercise } from '../types/training';

function draw(shape: Shape, key: string, fill: string, opacity = 1) {
  switch (shape.kind) {
    case 'rect':
      return (
        <Rect
          key={key}
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          rx={shape.r ?? 0}
          fill={fill}
          opacity={opacity}
        />
      );
    case 'ellipse':
      return <Ellipse key={key} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={fill} opacity={opacity} />;
    case 'poly':
      return <Polygon key={key} points={shape.points} fill={fill} opacity={opacity} />;
  }
}

/**
 * Small body diagram with the muscles this exercise works highlighted.
 * Drawn from the exercise's own muscle data, so it works offline and needs no
 * image files. Custom exercises get one automatically.
 */
export function ExerciseThumb({ exercise, size = 48 }: { exercise: Exercise; size?: number }) {
  const { items } = highlightsFor(exercise);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        backgroundColor: colors.surfaceAlt,
        borderWidth: 1,
        borderColor: colors.borderSoft,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Svg width={size * 0.55} height={size * 0.92} viewBox={VIEWBOX}>
        {BODY_SHAPES.map((s, i) => draw(s, `b${i}`, colors.surfaceHigh))}
        {items.flatMap((h) => h.shapes.map((s, i) => draw(s, `${h.group}${i}`, colors.accent, h.opacity)))}
      </Svg>
    </View>
  );
}
