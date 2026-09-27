import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Divider, EmptyState, MiniButton, Row, SectionTitle } from '../../components/ui';
import { EXERCISES, searchExercises } from '../../data/exercises';
import { estimateDurationSeconds } from '../../lib/plan';
import { colors, radius, space, type } from '../../theme';
import { Exercise, Routine, RoutineExercise } from '../../types/training';
import { uid } from '../../store/trainingReducer';
import { useApp } from '../../store/AppState';
import type { TrainGo } from '../TrainScreen';

const REST_PRESETS = [60, 90, 120, 150, 180];
export default function RoutineBuilder({
  go,
  initialRoutineId,
}: {
  go: TrainGo;
  initialRoutineId?: string;
}) {
  const insets = useSafeAreaInsets();
  const { routines, saveRoutine, dispatchTraining } = useApp();

  // Load the routine being edited once, on mount. Keying the component by id
  // in the router makes this safe when switching between routines.
  const initial = useMemo(
    () => routines.find((r) => r.id === initialRoutineId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [name, setName] = useState(initial?.name ?? 'My routine');
  const [items, setItems] = useState<RoutineExercise[]>(initial?.exercises ?? []);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(initial?.id ?? null);

  function reset() {
    setName('My routine');
    setItems([]);
    setEditingId(null);
  }

  function add(ex: Exercise) {
    setItems((cur) => [
      ...cur,
      {
        exerciseId: ex.id,
        order: cur.length,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        restSeconds: 120,
      },
    ]);
  }

  function patch(i: number, p: Partial<RoutineExercise>) {
    setItems((cur) => cur.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
  }

  /**
   * Reordering with explicit up/down controls rather than drag handles.
   * Drag-to-reorder needs a gesture library (react-native-draggable-flatlist and
   * friends) which adds real bundle weight; controls do the same job and work
   * on every device. Worth revisiting if reorder becomes a daily action.
   */
  function move(i: number, dir: -1 | 1) {
    setItems((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((it, idx) => ({ ...it, order: idx }));
    });
  }

  function save() {
    if (items.length === 0) return;
    if (editingId) {
      const existing = routines.find((r) => r.id === editingId);
      saveRoutine({
        id: editingId,
        name,
        exercises: items,
        sessionNames: existing?.sessionNames,
        isBuiltIn: false,
        createdAt: existing?.createdAt ?? Date.now(),
      });
    } else {
      saveRoutine({ id: uid('r'), name, exercises: items, isBuiltIn: false, createdAt: Date.now() });
    }
    go('hub');
  }

  const results = useMemo(() => searchExercises(query, EXERCISES, 25), [query]);
  const inRoutine = new Set(items.map((i) => i.exerciseId));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      <Row style={{ justifyContent: 'space-between', marginBottom: space.lg }}>
        <Text style={[type.display, { color: colors.text }]}>
          {editingId ? 'Edit routine' : 'New routine'}
        </Text>
        <Row gap={space.md}>
          {editingId ? <MiniButton label="New" onPress={reset} /> : null}
          <MiniButton label="Back" onPress={() => go('hub')} />
        </Row>
      </Row>

      <SectionTitle>Routine name</SectionTitle>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Push Pull Legs"
        placeholderTextColor={colors.textFaint}
        style={{
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          color: colors.text,
          fontSize: 16,
          paddingHorizontal: space.md,
          height: 46,
          marginBottom: space.lg,
        }}
      />

      {/* current contents */}
      <SectionTitle hint={`${items.length} exercises · about ${Math.round(estimateDurationSeconds(items) / 60)} min`}>
        Exercises
      </SectionTitle>

      {items.length === 0 ? (
        <EmptyState title="Empty" body="Search below to add your first exercise." />
      ) : (
        items.map((it, i) => (
          <Card key={`${it.exerciseId}-${i}`} style={{ marginBottom: space.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={[type.bodyStrong, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                {EXERCISES.find((e) => e.id === it.exerciseId)?.name ?? it.exerciseId}
              </Text>
              <Row gap={space.sm}>
                <MiniButton label="↑" onPress={() => move(i, -1)} />
                <MiniButton label="↓" onPress={() => move(i, 1)} />
                <MiniButton
                  label="x"
                  tone="danger"
                  onPress={() => setItems((cur) => cur.filter((_, idx) => idx !== i))}
                />
              </Row>
            </Row>

            <Divider />

            <Row gap={space.md}>
              <NumberStepper
                label="Sets"
                value={it.targetSets}
                onChange={(v) => patch(i, { targetSets: v })}
                min={1}
                max={10}
              />
              <RepsField
                min={it.targetRepsMin}
                max={it.targetRepsMax}
                onChange={(lo, hi) => patch(i, { targetRepsMin: lo, targetRepsMax: hi })}
              />
            </Row>

            <View style={{ height: space.sm }} />
            <Row gap={6} style={{ flexWrap: 'wrap' }}>
              {REST_PRESETS.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => patch(i, { restSeconds: r })}
                  style={{
                    paddingHorizontal: space.sm,
                    paddingVertical: 5,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: it.restSeconds === r ? colors.accent : colors.border,
                    backgroundColor: it.restSeconds === r ? colors.accent : 'transparent',
                  }}
                >
                  <Text style={[type.micro, { color: it.restSeconds === r ? colors.accentText : colors.textDim }]}>
                    {r}s
                  </Text>
                </Pressable>
              ))}
            </Row>
          </Card>
        ))
      )}

      <View style={{ height: space.xl }} />
      <SectionTitle>Add an exercise</SectionTitle>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search exercises"
        placeholderTextColor={colors.textFaint}
        style={{
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          color: colors.text,
          fontSize: 16,
          paddingHorizontal: space.md,
          height: 46,
          marginBottom: space.md,
        }}
      />

      <Card style={{ padding: 0 }}>
        {results
          .filter((e) => !inRoutine.has(e.id))
          .slice(0, 12)
          .map((e, i, arr) => (
            <View key={e.id}>
              <Pressable onPress={() => add(e)}>
                <Row style={{ justifyContent: 'space-between', padding: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { color: colors.text }]}>{e.name}</Text>
                    <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>
                      {e.equipment} · {e.compound ? 'compound' : 'isolation'}
                    </Text>
                  </View>
                  <Text style={[type.bodyStrong, { color: colors.accent }]}>+</Text>
                </Row>
              </Pressable>
              {i < arr.length - 1 ? <Divider /> : null}
            </View>
          ))}
      </Card>

      {editingId ? (
        <View style={{ height: space.lg }} />
      ) : null}
      {editingId ? (
        <Button
          label="Delete this routine"
          variant="ghost"
          onPress={() => {
            dispatchTraining({ type: 'DELETE_ROUTINE', routineId: editingId });
            reset();
            go('hub');
          }}
        />
      ) : null}

      <View style={{ height: space.lg }} />
      <Button label={editingId ? 'Save changes' : 'Save routine'} onPress={save} disabled={items.length === 0} />
    </ScrollView>
  );
}

function NumberStepper({
  label,
  value,
  onChange,
  min = 1,
  max = 999,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[type.micro, { color: colors.textFaint, marginBottom: 4 }]}>{label}</Text>
      <Row gap={space.sm}>
        <Pressable onPress={() => onChange(Math.max(min, value - step))} style={stepBtn}>
          <Text style={{ color: colors.textDim, fontSize: 16 }}>−</Text>
        </Pressable>
        <Text style={[type.bodyStrong, { color: colors.text, flex: 1, textAlign: 'center' }]}>{value}</Text>
        <Pressable onPress={() => onChange(Math.min(max, value + step))} style={stepBtn}>
          <Text style={{ color: colors.textDim, fontSize: 16 }}>+</Text>
        </Pressable>
      </Row>
    </View>
  );
}

/** Rep target as a range. Kept as two halves because "8-12" is one decision. */
function RepsField({
  min,
  max,
  onChange,
}: {
  min: number;
  max: number;
  onChange: (lo: number, hi: number) => void;
}) {
  const clampPair = (lo: number, hi: number): [number, number] => {
    const l = Math.max(1, Math.min(30, lo));
    const h = Math.max(l, Math.min(30, hi));
    return [l, h];
  };

  return (
    <View style={{ flex: 1 }}>
      <Text style={[type.micro, { color: colors.textFaint, marginBottom: 4 }]}>Reps</Text>
      <Row gap={6}>
        <RepBox
          value={min}
          onChange={(v) => {
            const [l, h] = clampPair(v, max);
            onChange(l, h);
          }}
        />
        <Text style={{ color: colors.textFaint }}>–</Text>
        <RepBox
          value={max}
          onChange={(v) => {
            const [l, h] = clampPair(min, v);
            onChange(l, h);
          }}
        />
      </Row>
    </View>
  );
}

function RepBox({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(`${value}`);
  return (
    <TextInput
      value={text}
      onChangeText={(t) => {
        const digits = t.replace(/[^0-9]/g, '').slice(0, 2);
        setText(digits);
        const n = parseInt(digits, 10);
        if (isFinite(n) && n > 0) onChange(n);
      }}
      keyboardType="number-pad"
      style={{
        flex: 1,
        backgroundColor: colors.surfaceAlt,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
        color: colors.text,
        fontSize: 15,
        textAlign: 'center',
        height: 34,
      }}
    />
  );
}

const stepBtn = {
  width: 34,
  height: 34,
  borderRadius: radius.sm,
  borderWidth: 1,
  borderColor: colors.border,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
