import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Card,
  ChoiceCard,
  Divider,
  MiniButton,
  NumberField,
  Row,
  SectionTitle,
  Segmented,
  Tag,
} from '../../components/ui';
import { EQUIPMENT_LABELS, Equipment, MUSCLE_LABELS, MuscleGroup, Routine } from '../../types/training';
import { GOAL_META } from '../../lib/nutrition';
import { GeneratedPlan, Level, generatePlan } from '../../lib/plan';
import { estimateDurationSeconds } from '../../lib/plan';
import { colors, radius, space, type } from '../../theme';
import { uid } from '../../store/trainingReducer';
import { useApp } from '../../store/AppState';
import type { TrainGo } from '../TrainScreen';

const ALL_EQUIPMENT: Equipment[] = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'bodyweight',
  'kettlebell',
  'band',
];

const FOCUS_OPTIONS: MuscleGroup[] = [
  'chest',
  'back',
  'lats',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
];

export default function PlanBuilder({ go }: { go: TrainGo }) {
  const insets = useSafeAreaInsets();
  const { profile, saveRoutine, getExercise } = useApp();

  const [level, setLevel] = useState<Level>('beginner');
  const [days, setDays] = useState(String(profile?.sessionsPerWeek ?? 3));
  const [minutes, setMinutes] = useState(String(profile?.averageSessionMinutes ?? 60));
  const [equipment, setEquipment] = useState<Equipment[]>(['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight']);
  const [focus, setFocus] = useState<MuscleGroup[]>([]);
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);

  const daysNum = Math.max(1, Math.min(7, parseInt(days, 10) || 3));
  const minutesNum = Math.max(20, Math.min(180, parseInt(minutes, 10) || 60));

  function toggleEquipment(e: Equipment) {
    setEquipment((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));
  }

  function toggleFocus(m: MuscleGroup) {
    setFocus((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  }

  function generate() {
    setPlan(
      generatePlan({
        goal: profile?.goal ?? 'cut_recomp',
        level,
        daysPerWeek: daysNum,
        equipment,
        sessionMinutes: minutesNum,
        focus,
      })
    );
  }

  function save() {
    if (!plan) return;
    const routine: Routine = {
      id: uid('r'),
      name: plan.name,
      sessionNames: plan.sessions.map((s) => s.name),
      exercises: plan.sessions.flatMap((s) =>
        s.exercises.map((e, i) => ({ ...e, order: i, sessionName: s.name }))
      ),
      isBuiltIn: false,
      createdAt: Date.now(),
    };
    saveRoutine(routine);
    go('hub');
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
    >
      <Text style={[type.display, { color: colors.text, marginBottom: space.sm }]}>Plan builder</Text>
      <Text style={[type.caption, { color: colors.textDim, marginBottom: space.lg, lineHeight: 19 }]}>
        Tell VitalX what you have and how much time you have. It builds the split from exercises you
        can actually perform, then fits it to the clock.
      </Text>

      <SectionTitle>Experience</SectionTitle>
      <Segmented
        options={[
          { value: 'beginner', label: 'Beginner' },
          { value: 'intermediate', label: 'Intermediate' },
          { value: 'advanced', label: 'Advanced' },
        ]}
        value={level}
        onChange={setLevel}
      />

      <View style={{ height: space.lg }} />
      <Row gap={space.md}>
        <View style={{ flex: 1 }}>
          <Text style={[type.caption, { color: colors.textDim, marginBottom: 6 }]}>Days per week</Text>
          <NumberField value={days} onChangeText={setDays} placeholder="3" keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.caption, { color: colors.textDim, marginBottom: 6 }]}>Session minutes</Text>
          <NumberField value={minutes} onChangeText={setMinutes} placeholder="60" keyboardType="number-pad" />
        </View>
      </Row>

      <View style={{ height: space.lg }} />
      <SectionTitle hint="Only exercises you can perform will be used.">Equipment you have</SectionTitle>
      <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
        {ALL_EQUIPMENT.map((e) => (
          <Pressable key={e} onPress={() => toggleEquipment(e)} style={chip(equipment.includes(e))}>
            <Text style={[type.caption, { color: equipment.includes(e) ? colors.accentText : colors.textDim }]}>
              {EQUIPMENT_LABELS[e]}
            </Text>
          </Pressable>
        ))}
      </Row>

      <View style={{ height: space.lg }} />
      <SectionTitle hint="Optional. Prioritised when picking exercises.">Focus muscles</SectionTitle>
      <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
        {FOCUS_OPTIONS.map((m) => (
          <Pressable key={m} onPress={() => toggleFocus(m)} style={chip(focus.includes(m))}>
            <Text style={[type.caption, { color: focus.includes(m) ? colors.accentText : colors.textDim }]}>
              {MUSCLE_LABELS[m]}
            </Text>
          </Pressable>
        ))}
      </Row>

      <View style={{ height: space.xl }} />
      <Button label="Generate plan" onPress={generate} />

      {plan ? (
        <View style={{ marginTop: space.xl }}>
          <SectionTitle hint={`About ${plan.estimatedMinutes} min per session on average.`}>
            {plan.name}
          </SectionTitle>

          {plan.notes.map((n, i) => (
            <Text
              key={i}
              style={[type.caption, { color: colors.warning, marginBottom: 6, lineHeight: 18 }]}
            >
              {n}
            </Text>
          ))}

          {plan.sessions.map((s) => (
            <Card key={s.name} style={{ marginTop: space.sm }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={[type.bodyStrong, { color: colors.text }]}>{s.name}</Text>
                <Tag text={`${Math.round(estimateDurationSeconds(s.exercises) / 60)} min`} />
              </Row>
              <Divider />
              {s.exercises.length === 0 ? (
                <Text style={[type.caption, { color: colors.textFaint }]}>
                  Nothing fits your equipment for this day.
                </Text>
              ) : (
                s.exercises.map((e) => (
                  <Row key={e.exerciseId} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={[type.caption, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                      {getExercise(e.exerciseId)?.name ?? e.exerciseId}
                    </Text>
                    <Text style={[type.micro, { color: colors.textFaint }]}>
                      {e.targetSets} x {e.targetRepsMin}-{e.targetRepsMax}
                    </Text>
                  </Row>
                ))
              )}
            </Card>
          ))}

          <View style={{ height: space.lg }} />
          <Button label="Save as routine" onPress={save} />
          <View style={{ height: space.sm }} />
          <Button label="Regenerate" variant="ghost" onPress={generate} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function chip(active: boolean) {
  return {
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: active ? colors.accent : colors.border,
    backgroundColor: active ? colors.accent : 'transparent',
  } as const;
}
