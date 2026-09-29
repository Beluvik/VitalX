import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  MiniButton,
  Row,
  Tag,
} from '../../components/ui';
import { ExerciseThumb } from '../../components/ExerciseThumb';
import { formatClock, useRestTimer } from '../../hooks/useRestTimer';
import {
  assessOverload,
  detectPr,
  draftStats,
  exerciseHistory,
  finalizeWorkout,
  personalBest,
  workoutBurn,
} from '../../lib/training';
import { isImperial, kgToLb, lbToKg, displayWeight } from '../../lib/units';
import { colors, radius, space, type } from '../../theme';
import { EXERCISE_BY_ID, searchExercises } from '../../data/exercises';
import { Exercise, MUSCLE_LABELS, WorkoutExercise, WorkoutSet } from '../../types/training';
import { uid } from '../../store/trainingReducer';
import { todayKey, useApp } from '../../store/AppState';
import type { TrainGo } from '../TrainScreen';

/** What the user has typed into the next-set boxes. Missing = untouched. */
type DraftInput = { weight?: string; reps?: string };

export default function ActiveWorkout({ go }: { go: TrainGo }) {
  const insets = useSafeAreaInsets();
  const {
    activeWorkout,
    workouts,
    dispatchTraining,
    getExercise,
    profile,
    unlockBadge,
    setDay,
    day,
  } = useApp();

  // undefined means "not touched yet, show the pre-fill". An empty string means
  // the user cleared the box on purpose and must stay empty while they type.
  const [drafts, setDrafts] = useState<Record<string, DraftInput>>({});
  const [prFlash, setPrFlash] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const rest = useRestTimer(120);
  const imp = profile ? isImperial(profile.unitSystem) : false;

  const elapsedMin = activeWorkout ? Math.round((Date.now() - activeWorkout.startedAt) / 60000) : 0;

  if (!activeWorkout) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <EmptyState title="No session running" body="Start one from the training tab." />
        <View style={{ paddingHorizontal: space.lg }}>
          <Button label="Back" variant="ghost" onPress={() => go('hub')} />
        </View>
      </View>
    );
  }

  const { id: workoutId } = activeWorkout;
  // Captured as a const so the closures below keep the non-null narrowing.
  const live = activeWorkout;

  function completeSet(
    we: WorkoutExercise,
    restSeconds: number,
    entered: { weight: string; reps: string }
  ) {
    const reps = parseInt(entered.reps, 10);
    const enteredWeight = parseFloat(entered.weight);
    if (!isFinite(reps) || reps <= 0 || !isFinite(enteredWeight) || enteredWeight < 0) return;

    // Input is in the user's display unit; storage is always kg.
    const weightKg = imp ? lbToKg(enteredWeight) : enteredWeight;

    const completedCount = we.sets.filter((s) => s.completedAt > 0).length;
    const candidate: WorkoutSet = {
      id: uid('s'),
      setNumber: completedCount + 1,
      weight: Math.round(weightKg * 10) / 10,
      reps,
      isWarmup: false,
      isPr: false,
      completedAt: Date.now(),
    };

    // Live PR check for the celebration, against saved history plus what has
    // already been logged in this session. The saved flag is settled again
    // when the workout is finished.
    const history = exerciseHistory(we.exerciseId, [...workouts, live]);
    const { isPr, prKind } = detectPr(candidate, history);
    const finalSet: WorkoutSet = { ...candidate, isPr, prKind };

    dispatchTraining({
      type: 'COMPLETE_SET',
      workoutId,
      workoutExerciseId: we.id,
      set: finalSet,
    });

    if (isPr) {
      setPrFlash(getExercise(we.exerciseId)?.name ?? 'Exercise');
      setTimeout(() => setPrFlash(null), 2600);
    }

    // Carry the numbers forward so the next set is one tap to confirm.
    setDrafts((d) => ({
      ...d,
      [we.id]: { weight: entered.weight, reps: entered.reps },
    }));

    rest.start(restSeconds);
  }

  /** Fix a set that was entered wrong. The workout is still a draft. */
  function editSet(we: WorkoutExercise, set: WorkoutSet, weightDisplay: string, repsText: string) {
    const reps = parseInt(repsText, 10);
    const w = parseFloat(weightDisplay);
    if (!isFinite(reps) || reps <= 0 || !isFinite(w) || w < 0) return false;
    const weightKg = imp ? lbToKg(w) : w;
    dispatchTraining({
      type: 'UPDATE_SET',
      workoutId,
      workoutExerciseId: we.id,
      set: { ...set, weight: Math.round(weightKg * 10) / 10, reps },
    });
    return true;
  }

  function addExercise(exerciseId: string) {
    dispatchTraining({
      type: 'ADD_WORKOUT_EXERCISE',
      workoutId,
      workoutExercise: {
        id: uid('we'),
        exerciseId,
        order: live.exercises.length,
        supersetGroup: null,
        sets: [],
      },
    });
    setShowPicker(false);
  }

  function discard() {
    dispatchTraining({ type: 'ABANDON_WORKOUT', workoutId });
    go('hub');
  }

  function confirmDiscard() {
    Alert.alert('Discard this session?', 'Nothing from it will be saved.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discard },
    ]);
  }

  /** The moment the draft becomes a saved workout. */
  function saveWorkout() {
    const endedAt = Date.now();
    const saved = finalizeWorkout(live, workouts, endedAt);
    if (!saved) {
      discard();
      return;
    }

    // Score the session and record the burn against today, so the dashboard's
    // energy picture reflects the work just done.
    const band = assessOverload(saved, getExercise, workouts).band;
    const { kcal } = workoutBurn(saved, getExercise, profile?.weightKg ?? 70, band);
    const today = todayKey();
    setDay(today, { gymBurn: (day(today).gymBurn ?? 0) + kcal, trainingSessionId: workoutId });

    // Records are only banked once the session is saved, so a typo that was
    // corrected before finishing can never earn a badge.
    for (const we of saved.exercises) {
      if (we.sets.some((s) => s.isPr)) unlockBadge(`pr_${we.exerciseId}`);
    }

    dispatchTraining({ type: 'FINISH_WORKOUT', workoutId, endedAt });
    go('summary');
  }

  function confirmFinish() {
    const { sets, exercises } = draftStats(live);
    if (sets === 0) {
      Alert.alert('Nothing logged yet', 'Tick off at least one set to save this session, or discard it.', [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Discard session', style: 'destructive', onPress: discard },
      ]);
      return;
    }
    Alert.alert(
      'Finish and save?',
      `${sets} ${sets === 1 ? 'set' : 'sets'} across ${exercises} ${exercises === 1 ? 'exercise' : 'exercises'} will be saved. Sets you have not ticked off are left out. You cannot edit them after this.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Save workout', onPress: saveWorkout },
      ]
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* header */}
      <View
        style={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg,
          paddingBottom: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colors.borderSoft,
        }}
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { color: colors.text }]} numberOfLines={1}>
              {activeWorkout.name}
            </Text>
            <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>
              {elapsedMin} min · {activeWorkout.exercises.length} exercises
            </Text>
            <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>
              Not saved until you tap Finish
            </Text>
          </View>
          <Button label="Finish" onPress={confirmFinish} style={{ paddingVertical: 10, paddingHorizontal: space.lg }} />
        </Row>
      </View>

      {activeWorkout.recovery ? (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          <Banner
            tone={
              activeWorkout.recovery.action === 'rest_day'
                ? 'danger'
                : activeWorkout.recovery.action === 'normal'
                ? 'info'
                : 'warning'
            }
            title={activeWorkout.recovery.headline}
            body={activeWorkout.recovery.body}
          />
        </View>
      ) : null}

      {prFlash ? (
        <View style={{ backgroundColor: colors.accentSoft, paddingVertical: space.sm, alignItems: 'center' }}>
          <Text style={[type.bodyStrong, { color: colors.accent }]}>New personal record · {prFlash}</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: (rest.active || rest.finished ? 120 : 24) + insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        {activeWorkout.exercises.length === 0 ? (
          <EmptyState
            title="Empty session"
            body="Add the exercises you are doing today."
            action={<Button label="Add exercise" onPress={() => setShowPicker(true)} />}
          />
        ) : (
          activeWorkout.exercises.map((we) => (
            <ExerciseCard
              key={we.id}
              workoutExercise={we}
              draft={drafts[we.id] ?? {}}
              onChangeDraft={(next) => setDrafts((d) => ({ ...d, [we.id]: next }))}
              onComplete={(restSeconds, entered) => completeSet(we, restSeconds, entered)}
              onEditSet={(set, weightDisplay, repsText) => editSet(we, set, weightDisplay, repsText)}
              onRemoveSet={(setId) =>
                dispatchTraining({ type: 'REMOVE_SET', workoutId, workoutExerciseId: we.id, setId })
              }
              onRemove={() =>
                dispatchTraining({ type: 'REMOVE_WORKOUT_EXERCISE', workoutId, workoutExerciseId: we.id })
              }
              imperial={imp}
            />
          ))
        )}

        <View style={{ height: space.lg }} />
        <Button label="Add exercise" variant="ghost" onPress={() => setShowPicker(true)} />
        <View style={{ height: space.lg }} />
        <Button label="Discard session" variant="ghost" onPress={confirmDiscard} />
      </ScrollView>

      {showPicker ? (
        <ExercisePicker
          onPick={addExercise}
          onClose={() => setShowPicker(false)}
          existing={activeWorkout.exercises.map((e) => e.exerciseId)}
        />
      ) : null}

      {rest.active || rest.finished ? (
        <RestBar rest={rest} onSkip={rest.dismiss} />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

function ExerciseCard({
  workoutExercise,
  draft,
  onChangeDraft,
  onComplete,
  onEditSet,
  onRemoveSet,
  onRemove,
  imperial,
}: {
  workoutExercise: WorkoutExercise;
  draft: DraftInput;
  onChangeDraft: (d: DraftInput) => void;
  onComplete: (restSeconds: number, entered: { weight: string; reps: string }) => void;
  onEditSet: (set: WorkoutSet, weightDisplay: string, repsText: string) => boolean;
  onRemoveSet: (setId: string) => void;
  onRemove: () => void;
  imperial: boolean;
}) {
  const { getExercise, workouts } = useApp();
  const ex = getExercise(workoutExercise.exerciseId);
  const [editing, setEditing] = useState<{ setId: string; weight: string; reps: string } | null>(null);

  // `workouts` holds saved sessions only, so this is the best from BEFORE
  // today: the number worth beating, and what the inputs pre-fill from.
  const best = useMemo(
    () => personalBest(workoutExercise.exerciseId, workouts),
    [workoutExercise.exerciseId, workouts]
  );

  const completed = workoutExercise.sets.filter((s) => s.completedAt > 0);
  const restSeconds = 120;

  const display = (kg: number) =>
    imperial ? `${Math.round(kgToLb(kg) * 10) / 10}` : `${Math.round(kg * 10) / 10}`;

  // Pre-fill the empty input from last time's best set, converted to the
  // user's display unit. What is shown here is exactly what the tick logs,
  // so confirming a pre-filled set is one tap.
  const prefillWeight =
    draft.weight ?? (best.lastWeight ? String(displayWeight(best.lastWeight, imperial ? 'imperial' : 'metric')) : '');
  const prefillReps = draft.reps ?? (best.lastReps ? String(best.lastReps) : '');

  if (!ex) return null;

  function startEdit(s: WorkoutSet) {
    setEditing({ setId: s.id, weight: display(s.weight), reps: String(s.reps) });
  }

  function saveEdit(s: WorkoutSet) {
    if (!editing) return;
    if (onEditSet(s, editing.weight, editing.reps)) setEditing(null);
  }

  return (
    <Card style={{ marginBottom: space.md }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Row gap={space.md} style={{ flex: 1, alignItems: 'flex-start' }}>
          <ExerciseThumb exercise={ex} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={[type.bodyStrong, { color: colors.text }]}>{ex.name}</Text>
            <Row gap={6} style={{ marginTop: 4, flexWrap: 'wrap' }}>
              {ex.muscles.slice(0, 2).map((m) => (
                <Tag
                  key={m.group}
                  text={`${MUSCLE_LABELS[m.group]} ${Math.round(m.weight * 100)}%`}
                  tone={m.weight >= 0.5 ? 'accent' : 'default'}
                />
              ))}
            </Row>
          </View>
        </Row>
        <MiniButton label="Remove" tone="danger" onPress={onRemove} />
      </Row>

      {best.totalSets > 0 ? (
        <Text style={[type.micro, { color: colors.textDim, marginTop: space.sm }]}>
          Best: {display(best.maxWeight)} {imperial ? 'lb' : 'kg'} x {best.maxWeightReps} · volume{' '}
          {Math.round(best.maxVolume).toLocaleString()} {imperial ? 'lb' : 'kg'}
        </Text>
      ) : (
        <Text style={[type.micro, { color: colors.textFaint, marginTop: space.sm }]}>
          First time logging this exercise
        </Text>
      )}

      <Divider />

      {completed.map((s) =>
        editing?.setId === s.id ? (
          <View
            key={s.id}
            style={{
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderBottomColor: colors.borderSoft,
            }}
          >
            <Text style={[type.micro, { color: colors.textFaint, marginBottom: 6 }]}>Fix set {s.setNumber}</Text>
            <Row gap={space.sm}>
              <TextInput
                value={editing.weight}
                onChangeText={(t) => setEditing({ ...editing, weight: t.replace(/[^0-9.]/g, '') })}
                keyboardType="decimal-pad"
                placeholderTextColor={colors.textFaint}
                style={inputStyle}
              />
              <Text style={[type.caption, { color: colors.textFaint, width: 24 }]}>{imperial ? 'lb' : 'kg'}</Text>
              <TextInput
                value={editing.reps}
                onChangeText={(t) => setEditing({ ...editing, reps: t.replace(/[^0-9]/g, '') })}
                keyboardType="number-pad"
                placeholderTextColor={colors.textFaint}
                style={[inputStyle, { width: 64 }]}
              />
              <Text style={[type.caption, { color: colors.textFaint, width: 34 }]}>reps</Text>
            </Row>
            <Row gap={space.md} style={{ marginTop: space.sm }}>
              <MiniButton label="Save" tone="accent" onPress={() => saveEdit(s)} />
              <MiniButton label="Cancel" onPress={() => setEditing(null)} />
            </Row>
          </View>
        ) : (
          <Pressable key={s.id} onPress={() => startEdit(s)}>
            <Row
              style={{
                justifyContent: 'space-between',
                paddingVertical: 7,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderSoft,
              }}
            >
              <Row gap={space.sm} style={{ width: 40 }}>
                <Text style={[type.caption, { color: colors.textFaint }]}>{s.setNumber}</Text>
              </Row>
              <Text style={[type.body, { color: colors.text, width: 90 }]}>
                {display(s.weight)} {imperial ? 'lb' : 'kg'}
              </Text>
              <Text style={[type.body, { color: colors.text, width: 70 }]}>{s.reps} reps</Text>
              {s.isPr ? <Tag text={s.prKind === 'weight' ? 'PR weight' : 'PR volume'} tone="accent" /> : <View />}
              <MiniButton label="x" tone="danger" onPress={() => onRemoveSet(s.id)} />
            </Row>
          </Pressable>
        )
      )}

      {completed.length > 0 ? (
        <Text style={[type.micro, { color: colors.textFaint, marginTop: space.sm }]}>
          Tap a set to fix its weight or reps
        </Text>
      ) : null}

      <View style={{ height: space.md }} />

      <Row gap={space.sm}>
        <TextInput
          value={prefillWeight}
          onChangeText={(t) => onChangeDraft({ weight: t.replace(/[^0-9.]/g, ''), reps: prefillReps })}
          placeholder={best.lastWeight ? '' : '0'}
          keyboardType="decimal-pad"
          placeholderTextColor={colors.textFaint}
          style={inputStyle}
        />
        <Text style={[type.caption, { color: colors.textFaint, width: 62 }]}>
          {imperial ? 'lb' : 'kg'}
        </Text>
        <TextInput
          value={prefillReps}
          onChangeText={(t) => onChangeDraft({ weight: prefillWeight, reps: t.replace(/[^0-9]/g, '') })}
          placeholder={best.lastReps ? '' : '0'}
          keyboardType="number-pad"
          placeholderTextColor={colors.textFaint}
          style={[inputStyle, { width: 64 }]}
        />
        <Pressable
          onPress={() => onComplete(restSeconds, { weight: prefillWeight, reps: prefillReps })}
          style={({ pressed }) => ({
            width: 48,
            height: 44,
            borderRadius: radius.md,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ fontSize: 18, color: colors.accentText, fontWeight: '700' }}>✓</Text>
        </Pressable>
      </Row>

      <Text style={[type.micro, { color: colors.textFaint, marginTop: space.sm }]}>
        {completed.length === 0 ? 'First set' : `Set ${completed.length + 1}`} · rest {Math.round(restSeconds / 60)} min
      </Text>
    </Card>
  );
}

const inputStyle = {
  flex: 1,
  backgroundColor: colors.surfaceAlt,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colors.border,
  color: colors.text,
  fontSize: 16,
  paddingHorizontal: space.md,
  height: 44,
} as const;

// ---------------------------------------------------------------------------

function RestBar({
  rest,
  onSkip,
}: {
  rest: ReturnType<typeof useRestTimer>;
  onSkip: () => void;
}) {
  const insets = useSafeAreaInsets();
  const done = rest.finished;
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: done ? colors.accentSoft : colors.surfaceAlt,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingHorizontal: space.lg,
        paddingTop: space.md,
        paddingBottom: insets.bottom + space.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View>
        <Text style={[type.micro, { color: done ? colors.accent : colors.textDim, textTransform: 'uppercase' }]}>
          {done ? 'Rest done' : 'Resting'}
        </Text>
        <Text style={[type.title, { color: done ? colors.accent : colors.text }]}>
          {rest.remaining === null ? '0:00' : formatClock(rest.remaining)}
        </Text>
      </View>
      <Row gap={space.sm}>
        {!done ? (
          <>
            <Pressable
              onPress={() => rest.adjust(-30)}
              style={pillStyle}
            >
              <Text style={[type.caption, { color: colors.textDim }]}>-30s</Text>
            </Pressable>
            <Pressable onPress={() => rest.adjust(30)} style={pillStyle}>
              <Text style={[type.caption, { color: colors.textDim }]}>+30s</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable onPress={onSkip} style={[pillStyle, { backgroundColor: colors.accent, borderColor: colors.accent }]}>
          <Text style={[type.caption, { color: colors.accentText, fontWeight: '700' }]}>
            {done ? 'Close' : 'Skip'}
          </Text>
        </Pressable>
      </Row>
    </View>
  );
}

const pillStyle = {
  paddingHorizontal: space.md,
  paddingVertical: 8,
  borderRadius: radius.pill,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: 'transparent',
} as const;

// ---------------------------------------------------------------------------

function ExercisePicker({
  onPick,
  onClose,
  existing,
}: {
  onPick: (id: string) => void;
  onClose: () => void;
  existing: string[];
}) {
  const insets = useSafeAreaInsets();
  const { routines } = useApp();
  const [fromRoutine, setFromRoutine] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const candidates = useMemo(() => {
    if (fromRoutine) {
      const r = routines.find((x) => x.id === fromRoutine);
      return (r?.exercises ?? []).map((e) => e.exerciseId);
    }
    return null;
  }, [fromRoutine, routines]);

  const list = useMemo(() => {
    if (candidates) {
      return candidates
        .filter((id) => !existing.includes(id))
        .map((id) => EXERCISE_BY_ID[id])
        .filter((e): e is Exercise => !!e);
    }
    return searchExercises(query).filter((e) => !existing.includes(e.id));
  }, [candidates, query, existing]);

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: space.md }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
          <Text style={[type.title, { color: colors.text }]}>Add exercise</Text>
          <MiniButton label="Close" tone="danger" onPress={onClose} />
        </Row>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search exercises"
          placeholderTextColor={colors.textFaint}
          style={inputStyle}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.md }}>
          <Row gap={space.sm}>
            <Pressable onPress={() => setFromRoutine(null)} style={filterPill(fromRoutine === null)}>
              <Text style={[type.caption, { color: fromRoutine === null ? colors.accentText : colors.textDim }]}>
                All
              </Text>
            </Pressable>
            {routines.map((r) => (
              <Pressable key={r.id} onPress={() => setFromRoutine(r.id)} style={filterPill(fromRoutine === r.id)}>
                <Text style={[type.caption, { color: fromRoutine === r.id ? colors.accentText : colors.textDim }]} numberOfLines={1}>
                  {r.name}
                </Text>
              </Pressable>
            ))}
          </Row>
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}>
        {list.length === 0 ? (
          <EmptyState title="Nothing left" body="Every matching exercise is already in this session." />
        ) : (
          list.map((e) => (
            <Pressable key={e.id} onPress={() => onPick(e.id)}>
              <Card style={{ marginBottom: space.sm, padding: space.md }}>
                <Row gap={space.md}>
                  <ExerciseThumb exercise={e} size={48} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { color: colors.text }]} numberOfLines={1}>
                      {e.name}
                    </Text>
                    <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]} numberOfLines={1}>
                      {e.equipment} · {e.muscles.slice(0, 2).map((m) => MUSCLE_LABELS[m.group]).join(', ')}
                    </Text>
                  </View>
                </Row>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// Imported lazily to keep the picker self-contained.
function filterPill(active: boolean) {
  return {
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: active ? colors.accent : colors.border,
    backgroundColor: active ? colors.accent : 'transparent',
    maxWidth: 160,
  } as const;
}
