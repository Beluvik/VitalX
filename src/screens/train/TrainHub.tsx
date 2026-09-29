import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Card,
  EmptyState,
  MiniButton,
  Row,
  ScreenHeader,
  Tag,
} from '../../components/ui';
import { formatDuration } from '../../lib/format';
import { summarizeWorkout } from '../../lib/training';
import { colors, space, type } from '../../theme';
import { MUSCLE_LABELS } from '../../types/training';
import { useApp } from '../../store/AppState';
import type { TrainGo } from '../TrainScreen';

export default function TrainHub({ go }: { go: TrainGo }) {
  const insets = useSafeAreaInsets();
  const { routines, workouts, activeWorkout, getExercise, dispatchTraining } = useApp();

  const finished = workouts.filter((w) => w.endedAt);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
    >
      <ScreenHeader
        title="Training"
        subtitle={activeWorkout ? 'Session in progress' : `${routines.length} routines · ${finished.length} sessions logged`}
      />

      {activeWorkout ? (
        <Card style={{ borderColor: colors.accent, borderWidth: 1 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={[type.heading, { color: colors.accent }]}>{activeWorkout.name}</Text>
            <Tag text="in progress" tone="accent" />
          </Row>
          <Text style={[type.caption, { color: colors.textDim, marginTop: 4 }]}>
            Started {formatDuration(Math.round((Date.now() - activeWorkout.startedAt) / 60000))} ago ·{' '}
            {activeWorkout.exercises.length} exercises
          </Text>
          <Text style={[type.caption, { color: colors.textFaint, marginTop: 4 }]}>
            Nothing is saved to your history until you finish it.
          </Text>
          <View style={{ height: space.lg }} />
          <Button label="Resume session" onPress={() => go('active')} />
          <View style={{ height: space.sm }} />
          <Button
            label="Discard session"
            variant="ghost"
            onPress={() =>
              Alert.alert('Discard this session?', 'Nothing from it will be saved.', [
                { text: 'Keep it', style: 'cancel' },
                {
                  text: 'Discard',
                  style: 'destructive',
                  onPress: () => dispatchTraining({ type: 'ABANDON_WORKOUT', workoutId: activeWorkout.id }),
                },
              ])
            }
          />
        </Card>
      ) : (
        <View style={{ gap: space.sm }}>
          <Button label="Start empty session" onPress={() => go('start')} />
          <Button label="Build a plan for me" variant="ghost" onPress={() => go('plan')} />
        </View>
      )}

      {/* ---------------- routines ---------------- */}
      <View style={{ marginTop: space.xl }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
          <Text style={[type.micro, { color: colors.textFaint, textTransform: 'uppercase' }]}>
            Routines
          </Text>
          <MiniButton label="New routine" tone="accent" onPress={() => go('routineNew')} />
          <MiniButton label="Your training" onPress={() => go('stats')} />
        </Row>

        {routines.length === 0 ? (
          <EmptyState
            title="No routines yet"
            body="Generate one from your level, equipment and available time, or build it by hand."
            action={<Button label="Generate a plan" onPress={() => go('plan')} />}
          />
        ) : (
          routines.map((r) => (
            <Card key={r.id} style={{ marginBottom: space.sm }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={[type.bodyStrong, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                  {r.name}
                </Text>
                {r.isBuiltIn ? <Tag text="built-in" /> : null}
              </Row>
              <Text style={[type.micro, { color: colors.textFaint, marginTop: 4 }]}>
                {r.exercises.length} exercises ·{' '}
                {r.exercises.reduce((a, e) => a + e.targetSets, 0)} sets
              </Text>
              <View style={{ height: space.md }} />
              <Row gap={space.md}>
                <MiniButton label="Start" tone="accent" onPress={() => go('start')} />
                <MiniButton label="Edit" onPress={() => go('routineEdit')} />
              </Row>
            </Card>
          ))
        )}
      </View>

      {/* ---------------- recent sessions ---------------- */}
      <View style={{ marginTop: space.xl }}>
        <Text style={[type.micro, { color: colors.textFaint, textTransform: 'uppercase', marginBottom: space.md }]}>
          Recent sessions
        </Text>

        {finished.length === 0 ? (
          <EmptyState title="Nothing logged" body="Finish a session and it shows up here with volume, PRs and your muscle split." />
        ) : (
          finished.slice(0, 8).map((w) => {
            const s = summarizeWorkout(w, getExercise);
            const top = s.muscleSplit[0];
            return (
              <Pressable key={w.id} onPress={() => go('history')}>
                <Card style={{ marginBottom: space.sm }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={[type.bodyStrong, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                      {w.name}
                    </Text>
                    {s.prs.length > 0 ? <Tag text={`${s.prs.length} PR`} tone="accent" /> : null}
                  </Row>
                  <Text style={[type.micro, { color: colors.textFaint, marginTop: 4 }]}>
                    {formatDuration(s.durationMinutes)} · {s.workingSets} sets · {s.totalVolume.toLocaleString()} kg volume
                  </Text>
                  {top ? (
                    <Text style={[type.micro, { color: colors.textDim, marginTop: 2 }]}>
                      {top.percent}% {MUSCLE_LABELS[top.group].toLowerCase()}
                    </Text>
                  ) : null}
                </Card>
              </Pressable>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}
