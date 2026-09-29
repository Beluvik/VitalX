import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Button, Card, MiniButton, NumberField, Row, SectionTitle, Tag } from '../components/ui';
import type { FoodCandidate } from '../lib/foodApi';
import { candidateToLogged } from '../lib/mealLog';
import { computeNutritionPlan } from '../lib/nutrition';
import { perServing, recipeToLoggedFood, searchRecipes } from '../lib/recipes';
import type { LabelReading } from '../lib/vision';
import { useFoodSettings } from '../store/foodSettings';
import { todayKey, useApp } from '../store/AppState';
import { uid } from '../store/trainingReducer';
import { colors, radius, space, type } from '../theme';
import type { LoggedFood, Recipe } from '../types';
import ConfirmFood from './food/ConfirmFood';
import ManualFood from './food/ManualFood';
import MealBuilder, { BuilderRow, rowsFromPhoto, rowsFromRecipe } from './food/MealBuilder';
import PhotoCapture from './food/PhotoCapture';
import ScanBarcode from './food/ScanBarcode';
import SearchFood from './food/SearchFood';
import SetupCard from './food/SetupCard';

type Mode =
  | 'home'
  | 'search'
  | 'manual'
  | 'barcode'
  | 'label'
  | 'photo'
  | 'photoMeal'
  | 'recipe'
  | 'confirm'
  | 'setup';

const METHODS: { mode: Mode; title: string; sub: string }[] = [
  { mode: 'search', title: 'Search foods', sub: 'Look up any food in the databases' },
  { mode: 'barcode', title: 'Scan barcode', sub: 'Packaged foods, in a second' },
  { mode: 'label', title: 'Scan a label', sub: 'Read the nutrition table on the pack' },
  { mode: 'photo', title: 'Photo of food', sub: 'Snap an apple, a bowl, a plate' },
  { mode: 'manual', title: 'Enter manually', sub: 'Type the calories yourself' },
  { mode: 'recipe', title: 'Build a recipe', sub: 'List what went in, get the total' },
];

export default function FoodLogScreen() {
  const insets = useSafeAreaInsets();
  const { profile, day, logFood, removeFood, recipes, saveRecipe, deleteRecipe } = useApp();
  const { settings, update } = useFoodSettings();

  const [mode, setMode] = useState<Mode>('home');
  const [candidate, setCandidate] = useState<FoodCandidate | null>(null);
  const [candidateNote, setCandidateNote] = useState<string | undefined>();
  const [confirmBack, setConfirmBack] = useState<Mode>('home');
  const [photoRows, setPhotoRows] = useState<BuilderRow[]>([]);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [recipeToLog, setRecipeToLog] = useState<Recipe | null>(null);
  const [servingsEaten, setServingsEaten] = useState('1');
  const [notice, setNotice] = useState<string | null>(null);

  const today = todayKey();
  const log = day(today);
  const plan = useMemo(() => (profile ? computeNutritionPlan(profile) : null), [profile]);
  const savedRecipes = useMemo(() => searchRecipes(recipes, ''), [recipes]);

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

  function flash(message: string) {
    setNotice(message);
    setTimeout(() => setNotice(null), 3500);
  }

  function goHome() {
    setMode('home');
    setCandidate(null);
    setCandidateNote(undefined);
    setEditing(null);
    setRecipeToLog(null);
  }

  /** Log finished entries and return to the list. */
  function commit(entries: LoggedFood[]) {
    for (const e of entries) logFood(today, e);
    const kcal = entries.reduce((a, e) => a + e.kcal, 0);
    goHome();
    if (entries.length > 0) {
      flash(`Added ${entries.length === 1 ? entries[0].name : `${entries.length} foods`}, ${kcal} kcal`);
    }
  }

  function pick(c: FoodCandidate, back: Mode, note?: string) {
    setCandidate(c);
    setCandidateNote(note);
    setConfirmBack(back);
    setMode('confirm');
  }

  function fromLabel(reading: LabelReading) {
    pick(reading.candidate, 'label', reading.basisNote);
  }

  function fromPhoto(items: { name: string; grams: number | null }[]) {
    setPhotoRows(rowsFromPhoto(items));
    setMode('photoMeal');
  }

  function logSaved() {
    if (!recipeToLog) return;
    const n = parseFloat(servingsEaten);
    if (!isFinite(n) || n <= 0) return;
    commit([recipeToLoggedFood(recipeToLog, n, uid('lf'), Date.now())]);
  }

  function confirmDelete(r: Recipe) {
    Alert.alert(`Delete "${r.name}"?`, 'Meals you already logged with it stay in your log.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteRecipe(r.id) },
    ]);
  }

  // -------------------------------------------------------------- screens

  let body: React.ReactNode;

  if (mode === 'search') {
    body = (
      <SearchFood
        settings={settings}
        onPick={(c) => pick(c, 'search')}
        onBack={goHome}
        onManual={() => setMode('manual')}
      />
    );
  } else if (mode === 'manual') {
    body = <ManualFood onAdd={(f) => commit([f])} onBack={goHome} />;
  } else if (mode === 'barcode') {
    body = (
      <ScanBarcode
        settings={settings}
        onFound={(c) => pick(c, 'barcode')}
        onBack={goHome}
        onManual={() => setMode('manual')}
        onLabel={() => setMode('label')}
      />
    );
  } else if (mode === 'label' || mode === 'photo') {
    body = (
      <PhotoCapture
        kind={mode === 'label' ? 'label' : 'food'}
        settings={settings}
        onFoods={fromPhoto}
        onLabel={fromLabel}
        onBack={goHome}
        onManual={() => setMode('manual')}
        onSetup={() => setMode('setup')}
      />
    );
  } else if (mode === 'photoMeal') {
    body = (
      <MealBuilder
        key="photo"
        mode="photo"
        settings={settings}
        recipes={recipes}
        initialRows={photoRows}
        autoLookup
        onLog={commit}
        onSaveRecipe={saveRecipe}
        onBack={goHome}
      />
    );
  } else if (mode === 'recipe') {
    body = (
      <MealBuilder
        key={editing?.id ?? 'new'}
        mode="recipe"
        settings={settings}
        recipes={recipes}
        initialRows={editing ? rowsFromRecipe(editing) : undefined}
        initialName={editing?.name}
        initialServings={editing ? String(editing.servings) : undefined}
        editingId={editing?.id ?? null}
        onLog={commit}
        onSaveRecipe={saveRecipe}
        onBack={goHome}
      />
    );
  } else if (mode === 'confirm' && candidate) {
    body = (
      <ConfirmFood
        candidate={candidate}
        note={candidateNote}
        onAdd={(g) => commit([candidateToLogged(candidate, g, uid('lf'), Date.now())])}
        onBack={() => setMode(confirmBack === 'label' || confirmBack === 'barcode' ? 'home' : confirmBack)}
      />
    );
  } else if (mode === 'setup') {
    body = <SetupCard settings={settings} onChange={update} onClose={goHome} />;
  } else {
    body = (
      <>
        <Row style={{ justifyContent: 'space-between', marginBottom: space.lg }}>
          <Text style={[type.display, { color: colors.text }]}>Food log</Text>
          <MiniButton label="Setup" onPress={() => setMode('setup')} />
        </Row>

        {notice ? <Banner tone="info" title={notice} body="" /> : null}

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

        {/* how to add */}
        <SectionTitle>Add what you ate</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.xl }}>
          {METHODS.map((m) => (
            <Pressable
              key={m.mode}
              onPress={() => {
                setEditing(null);
                setMode(m.mode);
              }}
              style={({ pressed }) => ({
                width: '48.5%',
                minHeight: 88,
                backgroundColor: colors.surface,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.borderSoft,
                padding: space.md,
                justifyContent: 'space-between',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={[type.bodyStrong, { color: colors.text }]}>{m.title}</Text>
              <Text style={[type.caption, { color: colors.textFaint, fontSize: 12 }]}>{m.sub}</Text>
            </Pressable>
          ))}
        </View>

        {/* saved recipe: log sheet */}
        {recipeToLog ? (
          <Card style={{ marginBottom: space.lg }}>
            <SectionTitle>{recipeToLog.name}</SectionTitle>
            <Text style={[type.caption, { color: colors.textDim, marginBottom: space.md }]}>
              Makes {recipeToLog.servings} {recipeToLog.servings === 1 ? 'serving' : 'servings'} · per serving{' '}
              {perServing(recipeToLog).kcal} kcal · P {perServing(recipeToLog).protein} g · C {perServing(recipeToLog).carbs}{' '}
              g · F {perServing(recipeToLog).fat} g
            </Text>
            <Row gap={space.sm} style={{ marginBottom: space.md, flexWrap: 'wrap' }}>
              {[0.5, 1, 1.5, 2].map((n) => {
                const on = parseFloat(servingsEaten) === n;
                return (
                  <Pressable
                    key={n}
                    onPress={() => setServingsEaten(String(n))}
                    style={{
                      paddingHorizontal: space.md,
                      paddingVertical: 8,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: on ? colors.accent : colors.border,
                      backgroundColor: on ? colors.accentSoft : 'transparent',
                    }}
                  >
                    <Text style={[type.caption, { color: on ? colors.accent : colors.textDim }]}>
                      {n} {n === 1 ? 'serving' : 'servings'}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
            <Row gap={space.sm} style={{ marginBottom: space.lg }}>
              <NumberField value={servingsEaten} onChangeText={setServingsEaten} placeholder="1" suffix="servings" />
            </Row>
            <Button label="Add to today" onPress={logSaved} disabled={!(parseFloat(servingsEaten) > 0)} />
            <View style={{ height: space.sm }} />
            <Button label="Cancel" variant="ghost" onPress={() => setRecipeToLog(null)} />
          </Card>
        ) : null}

        {/* saved recipes */}
        {savedRecipes.length > 0 ? (
          <View style={{ marginBottom: space.xl }}>
            <SectionTitle hint="Tap one to log it again">Your recipes</SectionTitle>
            {savedRecipes.map((r) => {
              const ps = perServing(r);
              return (
                <Card key={r.id} style={{ marginBottom: space.sm, padding: space.md }}>
                  <Pressable
                    onPress={() => {
                      setRecipeToLog(r);
                      setServingsEaten('1');
                    }}
                  >
                    <Row style={{ justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={[type.body, { color: colors.text }]} numberOfLines={1}>
                          {r.name}
                        </Text>
                        <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>
                          {r.ingredients.length} foods · per serving P {ps.protein} C {ps.carbs} F {ps.fat}
                        </Text>
                      </View>
                      <Text style={[type.bodyStrong, { color: colors.accent }]}>{ps.kcal}</Text>
                    </Row>
                  </Pressable>
                  <Row gap={space.md} style={{ marginTop: space.sm }}>
                    <MiniButton
                      label="Edit"
                      onPress={() => {
                        setEditing(r);
                        setMode('recipe');
                      }}
                    />
                    <MiniButton label="Delete" tone="danger" onPress={() => confirmDelete(r)} />
                  </Row>
                </Card>
              );
            })}
          </View>
        ) : null}

        {/* logged today */}
        <SectionTitle>Logged today</SectionTitle>
        {log.foods.length === 0 ? (
          <Text style={[type.caption, { color: colors.textFaint }]}>
            Nothing yet. Pick a way to add your first meal above.
          </Text>
        ) : (
          log.foods.map((f) => (
            <Card key={f.id} style={{ marginBottom: space.sm, padding: space.md }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: colors.text }]} numberOfLines={1}>
                    {f.name}
                  </Text>
                  <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>
                    {f.grams > 0 ? `${f.grams} g · ` : ''}
                    {Math.round(f.kcal)} kcal · P {Math.round(f.protein)} C {Math.round(f.carbs)} F {Math.round(f.fat)}
                  </Text>
                </View>
                <MiniButton label="Remove" tone="danger" onPress={() => removeFood(today, f.id)} />
              </Row>
            </Card>
          ))
        )}
      </>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: space.lg + insets.top,
        paddingBottom: insets.bottom + space.xxl,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {body}
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
