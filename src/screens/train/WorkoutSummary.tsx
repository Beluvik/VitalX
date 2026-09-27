import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Divider, MiniButton, Row, SectionTitle, StatTile, Tag } from '../../components/ui';
import { formatDuration } from '../../lib/format';
import { exerciseHistory, personalBest, summarizeWorkout, workingSets } from '../../lib/training';
import { isImperial, displayWeight } from '../../lib/units';
import { colors, space, type } from '../../theme';
import { MUSCLE_LABELS, MUSCLE_SIDE } from '../../types/training';
import { useApp } from '../../store/AppState';
import type { TrainGo } from '../TrainScreen';

export default function WorkoutSummary({ go }: { go: TrainGo }) {
  const insets = useSafeAreaInsets();
  const { workouts, getExercise, profile } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const finished = useMemo(() => workouts.filter((w) => w.endedAt), [workouts]);
  const workout = useMemo(
    () => finished.find((w) => w.id === selectedId) ?? finished[0],
    [finished, selectedId]
  );

  if (!workout) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ padding: space.lg, paddingTop: insets.top + space.lg }}>
          <Text style={[type.display, { color: colors.text }]}>Summary</Text>
          <Text style={[type.caption, { color: colors.textDim, marginTop: space.md }]}>
            No finished sessions yet.
          </Text>
          <View style={{ height: space.lg }} />
          <MiniButton label="Back to training" tone="accent" onPress={() => go('hub')} />
        </View>
      </View>
    );
  }

  const s = summarizeWorkout(workout, getExercise);
  const imp = profile ? isImperial(profile.unitSystem) : false;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
    >
      <Text style={[type.display, { color: colors.text, marginBottom: space.sm }]}>Session summary</Text>
      <Text style={[type.caption, { color: colors.textDim, marginBottom: space.lg }]}>
        {workout.name} · {new Date(workout.startedAt).toLocaleDateString()}
      </Text>

      {finished.length > 1 ? (
        <>
          <Text style={[type.micro, { color: colors.textFaint, textTransform: 'uppercase', marginBottom: 6 }]}>
            Session
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: space.lg }}>
            <Row gap={space.sm}>
              {finished.slice(0, 6).map((w) => (
                <Pressable
                  key={w.id}
                  onPress={() => setSelectedId(w.id)}
                  style={{
                    paddingHorizontal: space.md,
                    paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: w.id === workout.id ? colors.accent : colors.border,
                    backgroundColor: w.id === workout.id ? colors.accent : 'transparent',
                  }}
                >
                  <Text
                    style={[type.caption, { color: w.id === workout.id ? colors.accentText : colors.textDim }]}
                    numberOfLines={1}
                  >
                    {w.name}
                  </Text>
                </Pressable>
              ))}
            </Row>
          </ScrollView>
        </>
      ) : null}

      {/* headline numbers */}
      <Card>
        <Row>
          <StatTile label="Duration" value={`${s.durationMinutes}`} sub="minutes" />
          <StatTile
            label="Volume"
            value={s.totalVolume.toLocaleString()}
            sub={imp ? 'lb moved' : 'kg moved'}
          />
          <StatTile label="Sets" value={`${s.workingSets}`} sub={`${s.totalSets} incl. warm-ups`} />
        </Row>
      </Card>

      {/* PRs */}
      {s.prs.length > 0 ? (
        <Card style={{ marginTop: space.lg, borderColor: colors.accent, borderWidth: 1 }}>
          <SectionTitle>Personal records</SectionTitle>
          {s.prs.map((p) => (
            <Row key={p.set.id} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { color: colors.text }]} numberOfLines={1}>
                  {p.exerciseName}
                </Text>
                <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>
                  {displayWeight(p.set.weight, imp ? 'imperial' : 'metric')} {imp ? 'lb' : 'kg'} x {p.set.reps}
                </Text>
              </View>
              <Tag
                text={p.set.prKind === 'weight' ? 'heaviest' : p.set.prKind === 'both' ? 'heaviest + biggest' : 'biggest set'}
                tone="accent"
              />
            </Row>
          ))}
        </Card>
      ) : null}

      {/* muscle split */}
      <Card style={{ marginTop: space.lg }}>
        <SectionTitle hint="Each set's volume is shared across the muscles it actually trains.">
          What you trained
        </SectionTitle>
        {s.muscleSplit.length === 0 ? (
          <Text style={[type.caption, { color: colors.textFaint }]}>No completed sets.</Text>
        ) : (
          s.muscleSplit.map((m) => (
            <View key={m.group} style={{ marginBottom: space.md }}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <Row gap={6}>
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: m.group === 'chest' || MUSCLE_SIDE[m.group] === 'front' ? colors.info : colors.accent,
                    }}
                  />
                  <Text style={[type.caption, { color: colors.text }]}>
                    {MUSCLE_LABELS[m.group]}
                  </Text>
                </Row>
                <Text style={[type.caption, { color: colors.textDim }]}>{m.percent}%</Text>
              </Row>
              <View style={{ height: 6, backgroundColor: colors.surfaceHigh, borderRadius: 999, overflow: 'hidden' }}>
                <View
                  style={{
                    width: `${Math.min(100, m.percent)}%`,
                    height: '100%',
                    backgroundColor: MUSCLE_SIDE[m.group] === 'front' ? colors.info : colors.accent,
                  }}
                />
              </View>
            </View>
          ))
        )}
      </Card>

      {/* per exercise */}
      <Card style={{ marginTop: space.lg }}>
        <SectionTitle>Exercises</SectionTitle>
        {workout.exercises.map((we) => {
          const ex = getExercise(we.exerciseId);
          const sets = workingSets(we.sets);
          if (!ex) return null;
          return (
            <View key={we.id} style={{ paddingVertical: 6 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={[type.body, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                  {ex.name}
                </Text>
                <Text style={[type.micro, { color: colors.textFaint }]}>{sets.length} sets</Text>
              </Row>
              <Text style={[type.micro, { color: colors.textDim, marginTop: 3 }]}>
                {sets
                  .map((x) => `${displayWeight(x.weight, imp ? 'imperial' : 'metric')}${imp ? 'lb' : 'kg'} x ${x.reps}`)
                  .join('  ·  ')}
              </Text>
            </View>
          );
        })}
      </Card>

      <View style={{ height: space.lg }} />
      <MiniButton label="Back to training" tone="accent" onPress={() => go('hub')} />
    </ScrollView>
  );
}
