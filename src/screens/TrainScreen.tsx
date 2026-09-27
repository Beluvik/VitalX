import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Divider, EmptyState, MiniButton, Row, Tag } from '../components/ui';
import { colors, space, type } from '../theme';
import { personalBest } from '../lib/training';
import { applyRecovery } from '../lib/plan';
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

export type TrainRoute =
  | 'hub'
  | 'start'
  | 'active'
  | 'plan'
  | 'summary'
  | 'history'
  | 'routineNew'
  | 'routineEdit';

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

    // A rest-day recommendation is advice, not a block. The session proceeds
    // unmodified and carries the warning, because it is the user's call.
    const advised = recovery.advice.action === 'rest_day';
    const { exercises } = advised
      ? { exercises: selected.exercises }
      : applyRecovery(selected.exercises, recovery.advice);

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
