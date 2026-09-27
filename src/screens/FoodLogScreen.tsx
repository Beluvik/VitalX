import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Card,
  EmptyState,
  MiniButton,
  NumberField,
  Row,
  SectionTitle,
  Tag,
} from '../components/ui';
import { searchFoods } from '../data/foods';
import { computeNutritionPlan } from '../lib/nutrition';
import { colors, radius, space, type } from '../theme';
import { FoodItem } from '../types';
import { todayKey, useApp } from '../store/AppState';

/** Common serving sizes, so the common case is one tap instead of typing. */
const PORTIONS: { label: string; grams: number }[] = [
  { label: '50 g', grams: 50 },
  { label: '100 g', grams: 100 },
  { label: '150 g', grams: 150 },
  { label: '200 g', grams: 200 },
];

export default function FoodLogScreen() {
  const insets = useSafeAreaInsets();
  const { profile, day, logFood, removeFood } = useApp();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [grams, setGrams] = useState('100');

  const today = todayKey();
  const log = day(today);

  const results = useMemo(() => searchFoods(query), [query]);
  const plan = useMemo(() => (profile ? computeNutritionPlan(profile) : null), [profile]);

  const consumed = useMemo(
    () =>
      log.foods.reduce(
        (acc, f) => ({
          protein: acc.protein + f.protein,
          carbs: acc.carbs + f.carbs,
          fat: acc.fat + f.fat,
          kcal: acc.kcal + f.kcal,
        }),
        { protein: 0, carbs: 0, fat: 0, kcal: 0 }
      ),
    [log.foods]
  );

  function add(food: FoodItem, g: number) {
    const factor = g / 100;
    logFood(today, {
      id: `${food.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      foodId: food.id,
      name: food.name,
      grams: Math.round(g),
      protein: round1(food.proteinPer100 * factor),
      carbs: round1(food.carbsPer100 * factor),
      fat: round1(food.fatPer100 * factor),
      kcal: Math.round(food.kcalPer100 * factor),
      loggedAt: Date.now(),
    });
    setSelected(null);
    setGrams('100');
    setQuery('');
  }

  const preview = useMemo(() => {
    if (!selected) return null;
    const g = parseFloat(grams);
    if (!isFinite(g) || g <= 0) return null;
    const f = g / 100;
    return {
      kcal: Math.round(selected.kcalPer100 * f),
      protein: round1(selected.proteinPer100 * f),
      carbs: round1(selected.carbsPer100 * f),
      fat: round1(selected.fatPer100 * f),
    };
  }, [selected, grams]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[type.display, { color: colors.text, marginBottom: space.lg }]}>Food log</Text>

      {/* live totals */}
      {plan ? (
        <Card style={{ marginBottom: space.lg }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={[type.title, { color: colors.text }]}>
              {Math.round(consumed.kcal)}{' '}
              <Text style={[type.caption, { color: colors.textDim }]}>/ {plan.targetCalories} kcal</Text>
            </Text>
            <Tag
              text={consumed.kcal > plan.targetCalories ? 'over target' : 'in range'}
              tone={consumed.kcal > plan.targetCalories ? 'warning' : 'accent'}
            />
          </Row>
          <View style={{ height: space.md }} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Mini label="P" value={consumed.protein} target={plan.proteinG} color={colors.protein} />
            <Mini label="C" value={consumed.carbs} target={plan.carbsG} color={colors.carbs} />
            <Mini label="F" value={consumed.fat} target={plan.fatG} color={colors.fat} />
          </Row>
        </Card>
      ) : null}

      {/* search */}
      <View
        style={{
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: space.md,
          marginBottom: space.lg,
        }}
      >
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search foods, Indian first"
          placeholderTextColor={colors.textFaint}
          style={{ color: colors.text, fontSize: 16, paddingVertical: 12 }}
        />
      </View>

      {selected ? (
        /* ---------------- portion sheet ---------------- */
        <Card>
          <SectionTitle>{selected.name}</SectionTitle>

          <Text style={[type.caption, { color: colors.textDim, marginBottom: space.md }]}>
            per 100 g: {selected.kcalPer100} kcal · P {selected.proteinPer100} g · C{' '}
            {selected.carbsPer100} g · F {selected.fatPer100} g
          </Text>

          <Row gap={space.sm} style={{ marginBottom: space.md, flexWrap: 'wrap' }}>
            {PORTIONS.map((p) => (
              <Pressable
                key={p.grams}
                onPress={() => setGrams(`${p.grams}`)}
                style={{
                  paddingHorizontal: space.md,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: parseFloat(grams) === p.grams ? colors.accent : colors.border,
                  backgroundColor: parseFloat(grams) === p.grams ? colors.accentSoft : 'transparent',
                }}
              >
                <Text style={[type.caption, { color: parseFloat(grams) === p.grams ? colors.accent : colors.textDim }]}>
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </Row>

          <Row gap={space.sm} style={{ marginBottom: space.lg }}>
            <NumberField value={grams} onChangeText={setGrams} placeholder="100" suffix="grams" />
          </Row>

          {preview ? (
            <View style={{ marginBottom: space.lg }}>
              <Text style={[type.caption, { color: colors.textDim, marginBottom: space.sm }]}>Adding</Text>
              <Text style={[type.title, { color: colors.accent }]}>{preview.kcal} kcal</Text>
              <Text style={[type.caption, { color: colors.textDim, marginTop: 2 }]}>
                P {preview.protein} g · C {preview.carbs} g · F {preview.fat} g
              </Text>
            </View>
          ) : null}

          <Button
            label="Add to today"
            onPress={() => add(selected, parseFloat(grams) || 0)}
            disabled={!preview}
          />
          <View style={{ height: space.sm }} />
          <Button label="Cancel" variant="ghost" onPress={() => setSelected(null)} />
        </Card>
      ) : (
        /* ---------------- results ---------------- */
        <View style={{ gap: space.xs }}>
          {results.length === 0 ? (
            <EmptyState
              title="No match"
              body="Try a shorter word, or add it as a custom food from the barcode scanner once that ships."
            />
          ) : (
            results.map((f) => (
              <Pressable
                key={f.id}
                onPress={() => setSelected(f)}
                style={({ pressed }) => ({
                  backgroundColor: colors.surface,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.borderSoft,
                  padding: space.md,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { color: colors.text }]} numberOfLines={1}>
                      {f.name}
                    </Text>
                    <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>
                      P {f.proteinPer100} · C {f.carbsPer100} · F {f.fatPer100} / 100 g
                    </Text>
                  </View>
                  <Text style={[type.bodyStrong, { color: colors.accent }]}>{f.kcalPer100}</Text>
                </Row>
              </Pressable>
            ))
          )}
        </View>
      )}

      {/* logged today */}
      {log.foods.length > 0 ? (
        <View style={{ marginTop: space.xl }}>
          <SectionTitle>Logged today</SectionTitle>
          {log.foods.map((f) => (
            <Card key={f.id} style={{ marginBottom: space.sm, padding: space.md }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: colors.text }]} numberOfLines={1}>
                    {f.name}
                  </Text>
                  <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>
                    {f.grams} g · {Math.round(f.kcal)} kcal · P {Math.round(f.protein)} C {Math.round(f.carbs)} F{' '}
                    {Math.round(f.fat)}
                  </Text>
                </View>
                <MiniButton label="Remove" tone="danger" onPress={() => removeFood(today, f.id)} />
              </Row>
            </Card>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function Mini({ label, value, target, color }: { label: string; value: number; target: number; color: string }) {
  const over = value > target;
  return (
    <View>
      <Text style={[type.micro, { color: colors.textFaint }]}>{label}</Text>
      <Text style={[type.heading, { color: over ? colors.warning : color }]}>{Math.round(value)} g</Text>
      <Text style={[type.micro, { color: colors.textFaint }]}>/ {target} g</Text>
    </View>
  );
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
