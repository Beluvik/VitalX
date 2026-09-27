import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Divider, EmptyState, MiniButton, Row, SectionTitle, StatTile, Tag } from '../../components/ui';
import { formatDuration } from '../../lib/format';
import { shortDate } from '../../store/AppState';
import { exerciseHistory, personalBest, progressionTarget, setVolume, workingSets } from '../../lib/training';
import { displayWeight, isImperial } from '../../lib/units';
import { colors, radius, space, type } from '../../theme';
import { useApp } from '../../store/AppState';
import type { TrainGo } from '../TrainScreen';

export default function ExerciseHistory({
  go,
  exerciseId,
}: {
  go: TrainGo;
  exerciseId?: string;
}) {
  const insets = useSafeAreaInsets();
  const { workouts, getExercise, profile } = useApp();
  const [selected, setSelected] = useState<string | undefined>(exerciseId);

  const practiced = useMemo(() => {
    const ids = new Set<string>();
    for (const w of workouts) for (const we of w.exercises) ids.add(we.exerciseId);
    return [...ids].map((id) => getExercise(id)).filter((e): e is NonNullable<typeof e> => !!e);
  }, [workouts, getExercise]);

  const id = selected ?? practiced[0]?.id;
  const ex = id ? getExercise(id) : undefined;

  const history = useMemo(() => (id ? exerciseHistory(id, workouts) : []), [id, workouts]);
  const best = useMemo(() => (id ? personalBest(id, workouts) : null), [id, workouts]);
  const next = useMemo(() => (id ? progressionTarget(id, workouts) : null), [id, workouts]);

  const imp = profile ? isImperial(profile.unitSystem) : false;
  const unit = imp ? 'imperial' : 'metric';

  // One point per session, so the chart shows trend rather than every set.
  const bySession = useMemo(() => {
    const map = new Map<number, { at: number; bestVolume: number; bestWeight: number; reps: number }>();
    for (const s of history) {
      if (s.isWarmup) continue;
      const existing = map.get(s.completedAt);
      const v = setVolume(s);
      if (!existing) {
        map.set(s.completedAt, { at: s.completedAt, bestVolume: v, bestWeight: s.weight, reps: s.reps });
      } else if (v > existing.bestVolume) {
        map.set(s.completedAt, { ...existing, bestVolume: v, bestWeight: s.weight, reps: s.reps });
      }
    }
    return [...map.values()].sort((a, b) => a.at - b.at);
  }, [history]);

  if (practiced.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.lg }}>
        <EmptyState
          title="No history yet"
          body="Log a session and every set you have ever done on each exercise shows up here."
          action={<MiniButton label="Back" tone="accent" onPress={() => go('hub')} />}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
    >
      <Row style={{ justifyContent: 'space-between', marginBottom: space.lg }}>
        <Text style={[type.display, { color: colors.text }]}>History</Text>
        <MiniButton label="Back" onPress={() => go('hub')} />
      </Row>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: space.lg }}>
        <Row gap={space.sm}>
          {practiced.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => setSelected(e.id)}
              style={{
                paddingHorizontal: space.md,
                paddingVertical: 8,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: e.id === id ? colors.accent : colors.border,
                backgroundColor: e.id === id ? colors.accent : 'transparent',
              }}
            >
              <Text style={[type.caption, { color: e.id === id ? colors.accentText : colors.textDim }]}>
                {e.name}
              </Text>
            </Pressable>
          ))}
        </Row>
      </ScrollView>

      {!ex || !best ? null : (
        <>
          <Card>
            <Text style={[type.title, { color: colors.text, marginBottom: space.md }]}>{ex.name}</Text>
            <Row>
              <StatTile
                label="Heaviest"
                value={`${displayWeight(best.maxWeight, unit)}`}
                sub={`${imp ? 'lb' : 'kg'} x ${best.maxWeightReps}`}
              />
              <StatTile
                label="Best set"
                value={Math.round(best.maxVolume).toLocaleString()}
                sub="volume"
              />
              <StatTile label="Sets" value={`${best.totalSets}`} sub="all time" />
            </Row>
          </Card>

          {next ? (
            <Card style={{ marginTop: space.lg, borderColor: colors.accent, borderWidth: 1 }}>
              <SectionTitle>Next session</SectionTitle>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={[type.title, { color: colors.accent }]}>
                  {displayWeight(next.weight, unit)} {imp ? 'lb' : 'kg'} x {next.reps}
                </Text>
                <Tag text="target" tone="accent" />
              </Row>
              <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm, lineHeight: 19 }]}>
                {next.suggestion}
              </Text>
            </Card>
          ) : null}

          {/* chart */}
          <Card style={{ marginTop: space.lg }}>
            <SectionTitle hint="Best set per session, by volume.">Progression</SectionTitle>
            {bySession.length < 2 ? (
              <Text style={[type.caption, { color: colors.textFaint }]}>
                Log at least two sessions to see a trend.
              </Text>
            ) : (
              <VolumeChart points={bySession.map((p) => p.bestVolume)} />
            )}
            <Divider />
            {bySession
              .slice(-8)
              .reverse()
              .map((p) => (
                <Row
                  key={p.at}
                  style={{ justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}
                >
                  <Text style={[type.caption, { color: colors.textDim, width: 70 }]}>
                    {shortDate(new Date(p.at).toISOString().slice(0, 10))}
                  </Text>
                  <Text style={[type.caption, { color: colors.text, flex: 1 }]}>
                    {displayWeight(p.bestWeight, unit)} {imp ? 'lb' : 'kg'} x {p.reps}
                  </Text>
                  <Text style={[type.micro, { color: colors.textFaint }]}>
                    {Math.round(p.bestVolume).toLocaleString()}
                  </Text>
                </Row>
              ))}
          </Card>

          {/* all sets */}
          <Card style={{ marginTop: space.lg }}>
            <SectionTitle>All working sets</SectionTitle>
            {workingSets(history)
              .slice(-15)
              .reverse()
              .map((s) => (
                <Row key={s.id} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                  <Text style={[type.caption, { color: colors.textFaint, width: 70 }]}>
                    {shortDate(new Date(s.completedAt).toISOString().slice(0, 10))}
                  </Text>
                  <Text style={[type.caption, { color: colors.text, flex: 1 }]}>
                    {displayWeight(s.weight, unit)} {imp ? 'lb' : 'kg'} x {s.reps}
                  </Text>
                  {s.isPr ? <Tag text="PR" tone="accent" /> : <View />}
                </Row>
              ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

/**
 * Minimal sparkline. Deliberately dependency-free: pulling in a charting
 * library for one line of data would add weight to the bundle for no gain.
 */
function VolumeChart({ points }: { points: number[] }) {
  const width = 300;
  const height = 90;
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * (width - 8) + 4;
    const y = height - 8 - ((p - min) / range) * (height - 20);
    return { x, y };
  });

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${height} L${coords[0].x.toFixed(1)},${height} Z`;
  const last = coords[coords.length - 1];

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={width} height={height}>
        <Path d={area} fill={colors.accentSoft} />
        <Path d={line} stroke={colors.accent} strokeWidth={2} fill="none" />
        <Circle cx={last.x} cy={last.y} r={4} fill={colors.accent} />
      </Svg>
      <Row style={{ justifyContent: 'space-between', width: width - 8 }}>
        <Text style={[type.micro, { color: colors.textFaint }]}>oldest</Text>
        <Text style={[type.micro, { color: colors.textFaint }]}>latest</Text>
      </Row>
    </View>
  );
}
