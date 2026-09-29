import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { Banner, Button, Card, EmptyState, MiniButton, NumberField, Row, Tag } from '../../components/ui';
import { searchFoodsVia } from '../../lib/api';
import { FoodCandidate, SOURCE_LABEL, bestMatch, zeroCalorieFood } from '../../lib/foodApi';
import { FoodUnit, isApproximate, nextUnit, toGrams } from '../../lib/foodUnits';
import { parseIngredientText } from '../../lib/ingredients';
import { candidateToLogged, macrosFor } from '../../lib/mealLog';
import {
  buildRecipe,
  candidateFromIngredient,
  copyName,
  findRecipeByName,
  ingredientFromCandidate,
  perServing,
  recipeToLoggedFood,
  recipeTotals,
} from '../../lib/recipes';
import type { PhotoFood } from '../../lib/vision';
import type { FoodSettings } from '../../store/foodSettings';
import { uid } from '../../store/trainingReducer';
import { colors, radius, space, type } from '../../theme';
import type { LoggedFood, Recipe } from '../../types';

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface BuilderRow {
  key: string;
  /** What the food is called: the search term, and the label on the row. */
  text: string;
  /** Kept as text so a half-typed number never fights the user. */
  amount: string;
  unit: FoodUnit;
  match: FoodCandidate | null;
  status: 'idle' | 'loading' | 'found' | 'missing';
  /** Why the database lookup failed, if it did. */
  note?: string;
  /** A prompt about the amount, e.g. "enter the weight in grams". */
  hint?: string;
  manualOpen: boolean;
  manual: { kcal: string; p: string; c: string; f: string };
}

let rowCounter = 0;
export function newRow(
  text = '',
  amount = '',
  unit: FoodUnit = 'g',
  match: FoodCandidate | null = null
): BuilderRow {
  rowCounter += 1;
  return {
    key: `row${rowCounter}-${Date.now().toString(36)}`,
    text,
    amount,
    unit,
    match,
    status: match ? 'found' : 'idle',
    manualOpen: false,
    manual: { kcal: '', p: '', c: '', f: '' },
  };
}

export function rowsFromPhoto(items: PhotoFood[]): BuilderRow[] {
  return items.map((i) => newRow(i.name, i.grams !== null ? String(i.grams) : '', 'g'));
}

export function rowsFromRecipe(r: Recipe): BuilderRow[] {
  return r.ingredients.map((i) =>
    newRow(
      i.name,
      String(i.amount ?? i.grams),
      (['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup'].includes(i.unit ?? '') ? i.unit : 'g') as FoodUnit,
      candidateFromIngredient(i)
    )
  );
}

function manualMatch(r: BuilderRow): FoodCandidate | null {
  const kcal = parseFloat(r.manual.kcal);
  if (!isFinite(kcal) || kcal < 0) return null;
  const pos = (s: string) => {
    const n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : 0;
  };
  return {
    id: `manual:${r.text || 'food'}`,
    name: r.text || 'Food',
    source: 'manual',
    kcalPer100: kcal,
    proteinPer100: pos(r.manual.p),
    carbsPer100: pos(r.manual.c),
    fatPer100: pos(r.manual.f),
  };
}

const matchOf = (r: BuilderRow) => r.match ?? manualMatch(r);
const gramsOf = (r: BuilderRow) =>
  toGrams(parseFloat(r.amount), r.unit, `${r.text} ${r.match?.name ?? ''}`);
const isZeroCal = (c: FoodCandidate) =>
  c.kcalPer100 === 0 && c.proteinPer100 === 0 && c.carbsPer100 === 0 && c.fatPer100 === 0;
const isBlank = (r: BuilderRow) => !r.text.trim() && !r.amount.trim() && !r.match;

// ---------------------------------------------------------------------------

interface PickerState {
  key: string;
  query: string;
  results: FoodCandidate[];
  notes: string[];
  busy: boolean;
}

export default function MealBuilder({
  mode,
  settings,
  recipes,
  initialRows,
  initialName,
  initialServings,
  editingId,
  autoLookup,
  onLog,
  onSaveRecipe,
  onBack,
}: {
  mode: 'recipe' | 'photo';
  settings: FoodSettings;
  recipes: Recipe[];
  initialRows?: BuilderRow[];
  initialName?: string;
  initialServings?: string;
  editingId?: string | null;
  autoLookup?: boolean;
  onLog: (foods: LoggedFood[]) => void;
  onSaveRecipe: (r: Recipe) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<BuilderRow[]>(initialRows ?? []);
  const [name, setName] = useState(initialName ?? '');
  const [servingsMade, setServingsMade] = useState(initialServings ?? '1');
  const [servingsEaten, setServingsEaten] = useState('1');
  const [message, setMessage] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [working, setWorking] = useState(false);

  // ------------------------------------------------------------- lookups

  function patchRow(key: string, patch: Partial<BuilderRow>) {
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function lookupRow(key: string, query: string) {
    patchRow(key, { status: 'loading' });
    const zero = zeroCalorieFood(query);
    if (zero) {
      patchRow(key, { match: zero, status: 'found', note: undefined });
      return;
    }
    try {
      const out = await searchFoodsVia(settings, query, 6);
      const best = bestMatch(query, out.results);
      patchRow(
        key,
        best
          ? { match: best, status: 'found', note: undefined }
          : {
              match: null,
              status: 'missing',
              note: out.notes[0] ?? 'Not found. Search again with another word, or enter the values yourself.',
            }
      );
    } catch {
      patchRow(key, { match: null, status: 'missing', note: 'Could not look this up. Check your connection.' });
    }
  }

  useEffect(() => {
    if (!autoLookup) return;
    let cancelled = false;
    (async () => {
      for (const r of initialRows ?? []) {
        if (cancelled) return;
        if (r.status === 'idle' && r.text.trim()) await lookupRow(r.key, r.text);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fromText() {
    const parsed = parseIngredientText(text);
    if (parsed.length === 0) {
      setMessage('Type what went into the meal, for example: 100g paneer, 10ml oil, 50g tomato, onion, salt');
      return;
    }
    setMessage(null);
    const built = parsed.map((p) => {
      const noUnit = p.amount !== null && p.unit === null;
      const row = newRow(p.name, p.amount !== null && !noUnit ? String(p.amount) : '', p.unit ?? 'g');
      if (noUnit) row.hint = `Enter the weight of "${p.amount} ${p.name}" in grams.`;
      return row;
    });
    setRows((cur) => [...cur, ...built]);
    setText('');
    setWorking(true);
    for (const r of built) await lookupRow(r.key, r.text);
    setWorking(false);
  }

  async function runPicker(query: string, key: string) {
    setPicker({ key, query, results: [], notes: [], busy: true });
    try {
      const out = await searchFoodsVia(settings, query, 10);
      setPicker({ key, query, results: out.results, notes: out.notes, busy: false });
    } catch {
      setPicker({ key, query, results: [], notes: ['Something went wrong searching.'], busy: false });
    }
  }

  // --------------------------------------------------------------- totals

  const { included, blocking } = useMemo(() => {
    const inc: BuilderRow[] = [];
    let block = 0;
    for (const r of rows) {
      if (isBlank(r)) continue;
      const m = matchOf(r);
      const g = gramsOf(r);
      if (m && g > 0) inc.push(r);
      // A zero-calorie item with no amount, like plain "salt", cannot change
      // the numbers, so it never blocks.
      else if (m && isZeroCal(m) && g === 0) continue;
      else block += 1;
    }
    return { included: inc, blocking: block };
  }, [rows]);

  const ingredients = useMemo(
    () =>
      included.map((r) =>
        ingredientFromCandidate(matchOf(r) as FoodCandidate, gramsOf(r), parseFloat(r.amount), r.unit)
      ),
    [included]
  );
  const totals = useMemo(() => recipeTotals(ingredients), [ingredients]);
  const made = parseFloat(servingsMade);
  const eaten = parseFloat(servingsEaten);
  const ready = ingredients.length > 0 && blocking === 0;

  // -------------------------------------------------------------- actions

  function addPhotoMeal() {
    const now = Date.now();
    onLog(
      included.map((r) =>
        candidateToLogged(matchOf(r) as FoodCandidate, gramsOf(r), uid('lf'), now, r.text ? capitalise(r.text) : undefined)
      )
    );
  }

  function tempRecipe(): Recipe | null {
    const built = buildRecipe({
      id: uid('rec'),
      name: name.trim() || 'Meal',
      ingredients,
      servings: made,
      now: Date.now(),
    });
    if (!built.ok) {
      Alert.alert('Cannot add yet', built.error);
      return null;
    }
    return built.recipe;
  }

  function addRecipeMeal() {
    const rec = tempRecipe();
    if (!rec) return;
    if (!isFinite(eaten) || eaten <= 0) {
      Alert.alert('Cannot add yet', 'Servings you ate must be above zero.');
      return;
    }
    onLog([recipeToLoggedFood(rec, eaten, uid('lf'), Date.now())]);
  }

  /** Save under a name; asks before replacing a different recipe with the same name. */
  function save(thenLog: boolean) {
    if (!name.trim()) {
      Alert.alert('Name it first', 'Give the recipe a name so you can find it later.');
      return;
    }
    if (thenLog && (!isFinite(eaten) || eaten <= 0)) {
      Alert.alert('Cannot add yet', 'Servings you ate must be above zero.');
      return;
    }
    const existing = editingId ? recipes.find((r) => r.id === editingId) : undefined;
    const built = buildRecipe({
      id: editingId ?? uid('rec'),
      name,
      ingredients,
      servings: made,
      now: Date.now(),
      createdAt: existing?.createdAt,
    });
    if (!built.ok) {
      Alert.alert('Cannot save yet', built.error);
      return;
    }

    const commit = (rec: Recipe) => {
      onSaveRecipe(rec);
      if (thenLog) onLog([recipeToLoggedFood(rec, eaten, uid('lf'), Date.now())]);
      else onBack();
    };

    const clash = findRecipeByName(recipes, built.recipe.name);
    if (clash && clash.id !== built.recipe.id) {
      Alert.alert(`You already have "${clash.name}"`, 'Replace it with this version, or keep both by saving this one as a copy.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save as copy', onPress: () => commit({ ...built.recipe, id: uid('rec'), name: copyName(recipes, built.recipe.name) }) },
        { text: 'Replace', style: 'destructive', onPress: () => commit({ ...built.recipe, id: clash.id, createdAt: clash.createdAt }) },
      ]);
      return;
    }
    commit(built.recipe);
  }

  // ------------------------------------------------------------------ UI

  const isRecipe = mode === 'recipe';

  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <Text style={[type.title, { color: colors.text }]}>
          {isRecipe ? (editingId ? 'Edit recipe' : 'Build a recipe') : 'What was in the photo'}
        </Text>
        <MiniButton label="Back" onPress={onBack} />
      </Row>

      {isRecipe ? (
        <Card style={{ marginBottom: space.md }}>
          <Text style={[type.bodyStrong, { color: colors.text }]}>List what went in</Text>
          <Text style={[type.caption, { color: colors.textDim, marginTop: 4, marginBottom: space.sm, lineHeight: 19 }]}>
            Type it the way you would say it. VitalX finds each food in the nutrition database and works out the
            calories.
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder="100g paneer, 10 ml oil, 50g tomato, onion, salt"
            placeholderTextColor={colors.textFaint}
            style={{
              backgroundColor: colors.surfaceAlt,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              color: colors.text,
              fontSize: 16,
              paddingHorizontal: space.md,
              paddingVertical: 10,
              minHeight: 76,
              textAlignVertical: 'top',
              marginBottom: space.sm,
            }}
          />
          <Button label={working ? 'Finding nutrition...' : 'Find nutrition'} onPress={fromText} disabled={working || !text.trim()} />
        </Card>
      ) : null}

      {message ? <Banner tone="info" title={message} body="" /> : null}

      {rows.length === 0 ? (
        !isRecipe ? (
          <EmptyState title="Nothing here" body="Go back and try another photo, or add the foods yourself." />
        ) : null
      ) : (
        rows.map((r) => {
          const m = matchOf(r);
          const g = gramsOf(r);
          const macros = m && g > 0 ? macrosFor(m, g) : null;
          const approx = g > 0 && isApproximate(r.unit, `${r.text} ${r.match?.name ?? ''}`);
          const pickerOpen = picker?.key === r.key;
          return (
            <Card key={r.key} style={{ marginBottom: space.sm, padding: space.md }}>
              <Row gap={space.sm}>
                <TextInput
                  value={r.text}
                  onChangeText={(t: string) => patchRow(r.key, { text: t })}
                  placeholder="Food"
                  placeholderTextColor={colors.textFaint}
                  style={{
                    flex: 1,
                    color: colors.text,
                    fontSize: 16,
                    fontWeight: '600',
                    paddingVertical: 4,
                  }}
                />
                <MiniButton label="Remove" tone="danger" onPress={() => setRows((cur) => cur.filter((x) => x.key !== r.key))} />
              </Row>

              <Row gap={space.sm} style={{ marginTop: space.sm, alignItems: 'center' }}>
                <TextInput
                  value={r.amount}
                  onChangeText={(t: string) => patchRow(r.key, { amount: t.replace(/[^0-9./]/g, ''), hint: undefined })}
                  placeholder="Amount"
                  placeholderTextColor={colors.textFaint}
                  keyboardType="decimal-pad"
                  style={{
                    width: 90,
                    backgroundColor: colors.surfaceAlt,
                    borderRadius: radius.sm,
                    borderWidth: 1,
                    borderColor: colors.border,
                    color: colors.text,
                    paddingHorizontal: space.sm,
                    height: 40,
                  }}
                />
                <Pressable
                  onPress={() => patchRow(r.key, { unit: nextUnit(r.unit) })}
                  style={{
                    minWidth: 64,
                    height: 40,
                    borderRadius: radius.sm,
                    borderWidth: 1,
                    borderColor: colors.accent,
                    backgroundColor: colors.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: space.sm,
                  }}
                >
                  <Text style={[type.caption, { color: colors.accent, fontWeight: '700' }]}>{r.unit}</Text>
                </Pressable>
                <Text style={[type.caption, { color: colors.textFaint, flex: 1 }]} numberOfLines={1}>
                  {g > 0 && r.unit !== 'g' ? `${approx ? '≈ ' : '= '}${g} g` : 'tap unit to change'}
                </Text>
              </Row>

              {/* nutrition match */}
              <View style={{ marginTop: space.sm }}>
                {r.status === 'loading' ? (
                  <Text style={[type.caption, { color: colors.textDim }]}>Looking it up...</Text>
                ) : m ? (
                  <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, paddingRight: space.sm }}>
                      <Text style={[type.caption, { color: colors.textDim }]} numberOfLines={2}>
                        {m.name} · {SOURCE_LABEL[m.source]}
                      </Text>
                      <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>
                        per 100 g: {Math.round(m.kcalPer100)} kcal · P {m.proteinPer100} C {m.carbsPer100} F {m.fatPer100}
                      </Text>
                    </View>
                    {macros ? <Tag text={`${macros.kcal} kcal`} tone="accent" /> : null}
                  </Row>
                ) : (
                  <Text style={[type.caption, { color: colors.warning }]}>{r.note ?? 'No nutrition yet.'}</Text>
                )}
                {r.hint && g === 0 ? (
                  <Text style={[type.micro, { color: colors.warning, marginTop: 2 }]}>{r.hint}</Text>
                ) : null}
              </View>

              {r.status !== 'loading' ? (
                <Row gap={space.md} style={{ marginTop: space.sm }}>
                  <MiniButton
                    label={r.match ? 'Change' : 'Search'}
                    onPress={() => runPicker(r.text || '', r.key)}
                  />
                  <MiniButton
                    label={r.manualOpen ? 'Hide values' : 'Enter values'}
                    onPress={() => patchRow(r.key, { manualOpen: !r.manualOpen })}
                  />
                </Row>
              ) : null}

              {r.manualOpen ? (
                <View style={{ marginTop: space.sm }}>
                  <Text style={[type.micro, { color: colors.textFaint, marginBottom: 6 }]}>
                    Nutrition per 100 g. Used when the database has no match.
                  </Text>
                  <Row gap={space.sm}>
                    {(
                      [
                        ['kcal', 'kcal'],
                        ['p', 'protein'],
                        ['c', 'carbs'],
                        ['f', 'fat'],
                      ] as const
                    ).map(([k, label]) => (
                      <TextInput
                        key={k}
                        value={r.manual[k]}
                        onChangeText={(t: string) =>
                          patchRow(r.key, { manual: { ...r.manual, [k]: t.replace(/[^0-9.]/g, '') }, match: null, status: 'idle' })
                        }
                        placeholder={label}
                        placeholderTextColor={colors.textFaint}
                        keyboardType="decimal-pad"
                        style={{
                          flex: 1,
                          backgroundColor: colors.surfaceAlt,
                          borderRadius: radius.sm,
                          borderWidth: 1,
                          borderColor: colors.border,
                          color: colors.text,
                          paddingHorizontal: space.sm,
                          height: 40,
                        }}
                      />
                    ))}
                  </Row>
                </View>
              ) : null}

              {pickerOpen && picker ? (
                <View style={{ marginTop: space.md, borderTopWidth: 1, borderTopColor: colors.borderSoft, paddingTop: space.md }}>
                  <Row gap={space.sm}>
                    <TextInput
                      value={picker.query}
                      onChangeText={(t: string) => setPicker({ ...picker, query: t })}
                      onSubmitEditing={() => runPicker(picker.query, r.key)}
                      placeholder="Search a food"
                      placeholderTextColor={colors.textFaint}
                      style={{
                        flex: 1,
                        backgroundColor: colors.surfaceAlt,
                        borderRadius: radius.sm,
                        borderWidth: 1,
                        borderColor: colors.border,
                        color: colors.text,
                        paddingHorizontal: space.sm,
                        height: 40,
                      }}
                    />
                    <MiniButton label="Search" tone="accent" onPress={() => runPicker(picker.query, r.key)} />
                    <MiniButton label="Close" onPress={() => setPicker(null)} />
                  </Row>
                  {picker.busy ? (
                    <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm }]}>Searching...</Text>
                  ) : null}
                  {picker.notes.map((n) => (
                    <Text key={n} style={[type.micro, { color: colors.warning, marginTop: space.sm }]}>
                      {n}
                    </Text>
                  ))}
                  {picker.results.map((f) => (
                    <Pressable
                      key={f.id}
                      onPress={() => {
                        patchRow(r.key, { match: f, status: 'found', note: undefined, manual: { kcal: '', p: '', c: '', f: '' } });
                        setPicker(null);
                      }}
                      style={({ pressed }) => ({
                        paddingVertical: 8,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.borderSoft,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text style={[type.caption, { color: colors.text, flex: 1, paddingRight: space.sm }]} numberOfLines={2}>
                          {f.name}
                        </Text>
                        <Text style={[type.caption, { color: colors.accent }]}>{Math.round(f.kcalPer100)}</Text>
                      </Row>
                      <Text style={[type.micro, { color: colors.textFaint }]}>
                        {SOURCE_LABEL[f.source]} · P {f.proteinPer100} C {f.carbsPer100} F {f.fatPer100} per 100 g
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </Card>
          );
        })
      )}

      <View style={{ marginBottom: space.md }}>
        <Button label="Add another food" variant="ghost" onPress={() => setRows((cur) => [...cur, newRow()])} />
      </View>

      {/* totals */}
      {rows.length > 0 ? (
        <Card style={{ marginBottom: space.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={[type.bodyStrong, { color: colors.text }]}>{isRecipe ? 'Whole recipe' : 'This meal'}</Text>
            <Text style={[type.title, { color: colors.accent }]}>{totals.kcal} kcal</Text>
          </Row>
          <Text style={[type.caption, { color: colors.textDim, marginTop: 4 }]}>
            P {totals.protein} g · C {totals.carbs} g · F {totals.fat} g · {totals.grams} g in total
          </Text>
          {isRecipe && isFinite(made) && made > 0 && made !== 1 ? (
            <Text style={[type.caption, { color: colors.textDim, marginTop: 2 }]}>
              Per serving: {perServing({ ingredients, servings: made }).kcal} kcal
            </Text>
          ) : null}
          {blocking > 0 ? (
            <Text style={[type.caption, { color: colors.warning, marginTop: space.sm }]}>
              {blocking} {blocking === 1 ? 'food still needs' : 'foods still need'} an amount or nutrition before you can add
              this.
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* actions */}
      {isRecipe ? (
        <Card>
          <Text style={[type.micro, { color: colors.textFaint, marginBottom: 6 }]}>Recipe name (needed to save it)</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Paneer bhurji"
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
          <Row gap={space.sm} style={{ marginBottom: space.md }}>
            <View style={{ flex: 1 }}>
              <Text style={[type.micro, { color: colors.textFaint, marginBottom: 6 }]}>Servings it makes</Text>
              <Row>
                <NumberField value={servingsMade} onChangeText={setServingsMade} placeholder="1" />
              </Row>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.micro, { color: colors.textFaint, marginBottom: 6 }]}>Servings you ate</Text>
              <Row>
                <NumberField value={servingsEaten} onChangeText={setServingsEaten} placeholder="1" />
              </Row>
            </View>
          </Row>

          <Button label="Add to today" onPress={addRecipeMeal} disabled={!ready} />
          <View style={{ height: space.sm }} />
          <Button label="Save recipe and add to today" variant="ghost" onPress={() => save(true)} disabled={!ready} />
          <View style={{ height: space.sm }} />
          <Button label="Save recipe only" variant="ghost" onPress={() => save(false)} disabled={!ready} />
          <Text style={[type.micro, { color: colors.textFaint, marginTop: space.md, lineHeight: 16 }]}>
            "Add to today" logs this meal without keeping the recipe. Saved recipes appear on the Food tab for next time.
            Spoon and cup amounts are approximate; use grams when you can.
          </Text>
        </Card>
      ) : (
        <Button label="Add to today" onPress={addPhotoMeal} disabled={!ready} />
      )}
    </View>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
