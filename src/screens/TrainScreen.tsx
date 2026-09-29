import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Button, Card, Divider, EmptyState, MiniButton, Row, Segmented, Tag } from '../components/ui';
import { colors, space, type } from '../theme';
import { personalBest } from '../lib/training';
import { RecoveryChoice, adviceCutsTraining, planSession } from '../lib/plan';
import { currentRecovery } from '../lib/sleep';
import { Routine } from '../types/training';
import { workoutFromRoutine } from '../store/trainingReducer';
import { useApp } from '../store/AppState';
import TrainHub from './train/TrainHub';
import ActiveWorkout from './train/ActiveWorkout';
import PlanBuilder from './train/PlanBuilder';
import RoutineBuilder from './train/RoutineBuilder';
import WorkoutSummary from './train/WorkoutSummary';
import ExerciseHistory from './train/ExerciseHistory';
import TrainingStats from './train/TrainingStats';

export type TrainRoute =
  | 'hub'
  | 'start'
  | 'active'
  | 'plan'
  | 'summary'
  | 'history'
  | 'routineNew'
  | 'routineEdit'
  | 'stats';

/** Second argument carries a routine or exercise id where the route needs one. */
export type TrainGo = (r: TrainRoute, arg?: string) => void;

export default function TrainScreen() {
  const [route, setRoute] = useState<TrainRoute>('hub');
  const [arg, setArg] = useState<string | undefined>();

  const go: TrainGo = (r, nextArg) => {
    setRoute(r);
    setArg(nextArg);
  };

  switch (route) {
    case 'active':
      return <ActiveWorkout go={go} />;
    case 'plan':
      return <PlanBuilder go={go} />;
    case 'summary':
      return <WorkoutSummary go={go} />;
    case 'history':
      return <ExerciseHistory go={go} exerciseId={arg} />;
    case 'stats':
      return <TrainingStats go={go} />;
    case 'routineNew':
      return <RoutineBuilder go={go} />;
    case 'routineEdit':
      return <RoutineBuilder go={go} initialRoutineId={arg} />;
    case 'start':
      return <StartWorkout go={go} />;
    case 'hub':
    default:
      return <TrainHub go={go} />;
  }
}

function StartWorkout({ go }: { go: TrainGo }) {
  const insets = useSafeAreaInsets();
  const { routines, workouts, dispatchTraining, getExercise, days, profile } = useApp();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [choice, setChoice] = useState<RecoveryChoice>('recommended');

  // Consult recovery before prescribing anything. This is the step that makes
  // the plan respond to sleep instead of staying static.
  const recovery = useMemo(() => currentRecovery(days), [days]);

  function start(routine: Routine | null, sessionName?: string) {
    // Pre-fill every exercise from the user's best set in their most recent
    // session, so the first thing they see is a number worth beating.
    const prefill = (exerciseId: string) => {
      const best = personalBest(exerciseId, workouts);
      if (!best.lastWeight) return null;
      return { weight: best.lastWeight, reps: best.lastReps };
    };

    // For a multi-day plan, the chosen day becomes the session.
    const selected: Routine | null =
      routine && sessionName
        ? {
            ...routine,
            name: sessionName,
            exercises: routine.exercises.filter((e) => e.sessionName === sessionName),
          }
        : routine;

    if (!selected) {
      const workout = workoutFromRoutine(null, 'Freestyle session', prefill);
      dispatchTraining({ type: 'START_WORKOUT', workout });
      go('active');
      return;
    }

    // Poor recovery is advice, not a block. The default follows it, and the
    // user can switch to the full plan with one tap before starting.
    const { exercises } = planSession(selected.exercises, recovery.advice, choice);

    const workout = workoutFromRoutine(
      { ...selected, exercises },
      selected.name,
      prefill
    );
    if (recovery.advice.action !== 'normal') {
      workout.recovery = recovery.advice;
    }
    dispatchTraining({ type: 'START_WORKOUT', workout });
    go('active');
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
    >
      <Row style={{ justifyContent: 'space-between', marginBottom: space.lg }}>
        <Text style={[type.display, { color: colors.text }]}>Start workout</Text>
        <MiniButton label="Back" onPress={() => go('hub')} />
      </Row>

      {adviceCutsTraining(recovery.advice) ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner
            tone={recovery.advice.action === 'rest_day' ? 'danger' : 'warning'}
            title={recovery.advice.headline}
            body={recovery.advice.body}
          />
          <View style={{ height: space.md }} />
          <Segmented
            options={[
              { value: 'recommended', label: recovery.advice.action === 'rest_day' ? 'Light session' : 'Lighter session' },
              { value: 'planned', label: 'Full plan' },
            ]}
            value={choice}
            onChange={setChoice}
          />
          <Text style={[type.caption, { color: colors.textFaint, marginTop: space.sm }]}>
            {choice === 'recommended'
              ? recovery.advice.action === 'rest_day'
                ? 'About half the sets, main lifts kept. Resting today is the better call.'
                : 'Roughly a third fewer sets, main lifts kept, loads unchanged.'
              : 'Every set as written. Your call, but sleep is the reason to reconsider.'}
          </Text>
        </View>
      ) : null}

      <Button label="Empty session" variant="ghost" onPress={() => start(null)} />
      <View style={{ height: space.xl }} />

      {routines.length === 0 ? (
        <EmptyState
          title="No routines"
          body="Generate one from your level and equipment, or build it by hand."
          action={<Button label="Build a plan" onPress={() => go('plan')} />}
        />
      ) : (
        routines.map((r) => {
          const isSplit = !!r.sessionNames && r.sessionNames.length > 1;
          const open = expanded === r.id;
          return (
            <Card key={r.id} style={{ marginBottom: space.sm }}>
              <Pressable onPress={() => setExpanded(open ? null : r.id)}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={[type.bodyStrong, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                    {r.name}
                  </Text>
                  {isSplit ? <Tag text={`${r.sessionNames!.length}-day`} tone="accent" /> : null}
                  <Text style={[type.caption, { color: colors.textFaint }]}>{open ? '▾' : '▸'}</Text>
                </Row>
                <Text style={[type.micro, { color: colors.textFaint, marginTop: 4 }]}>
                  {r.exercises.length} exercises · {r.exercises.reduce((a, e) => a + e.targetSets, 0)} sets
                  {'  '}
                  <Text onPress={() => go('routineEdit', r.id)} style={{ color: colors.accent }}>
                    Edit
                  </Text>
                </Text>
              </Pressable>

              {open ? (
                <View style={{ marginTop: space.md }}>
                  <Divider />
                  {isSplit ? (
                    (r.sessionNames ?? []).map((sn) => (
                      <Pressable key={sn} onPress={() => start(r, sn)}>
                        <Row style={{ justifyContent: 'space-between', paddingVertical: 10 }}>
                          <Text style={[type.body, { color: colors.text }]}>{sn}</Text>
                          <Text style={[type.micro, { color: colors.textFaint }]}>
                            {r.exercises.filter((e) => e.sessionName === sn).length} exercises
                          </Text>
                        </Row>
                      </Pressable>
                    ))
                  ) : (
                    r.exercises.slice(0, 8).map((e) => (
                      <Row key={e.exerciseId} style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
                        <Text style={[type.caption, { color: colors.textDim, flex: 1 }]} numberOfLines={1}>
                          {getExercise(e.exerciseId)?.name ?? e.exerciseId}
                        </Text>
                        <Text style={[type.micro, { color: colors.textFaint }]}>
                          {e.targetSets} x {e.targetRepsMin}-{e.targetRepsMax}
                        </Text>
                      </Row>
                    ))
                  )}
                  <View style={{ height: space.md }} />
                  <Button label={`Start ${r.name}`} onPress={() => start(r)} />
                </View>
              ) : null}
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}
