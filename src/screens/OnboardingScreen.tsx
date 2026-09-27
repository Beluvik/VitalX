import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Card,
  ChoiceCard,
  Field,
  NumberField,
  ProgressBar,
  Row,
  Segmented,
  Tag,
} from '../components/ui';
import {
  ACTIVITY_MULTIPLIERS,
  BULK_TIER_META,
  BULK_SURPLUSES,
  CUT_DEFICITS,
  CUT_TIER_META,
  GOAL_META,
  canUseKatch,
  usesBulkTiers,
  usesCutTiers,
} from '../lib/nutrition';
import { cmToInch, isImperial } from '../lib/units';
import { generatePlan, Level } from '../lib/plan';
import { colors, radius, space, type } from '../theme';
import { ActivityLevel, BmrFormula, BulkTier, CutTier, Equipment, Goal, Profile, Sex, UnitSystem } from '../types';
import { uid } from '../store/trainingReducer';
import { useApp } from '../store/AppState';

const TOTAL_STEPS = 6;

const GOAL_ORDER: Goal[] = ['cut_recomp', 'bulk', 'maintain_recomp', 'cut_fat_only'];

const EQUIPMENT_OPTIONS: { value: Equipment; label: string; blurb: string }[] = [
  { value: 'barbell', label: 'Barbell', blurb: 'Rack, bar, plates' },
  { value: 'dumbbell', label: 'Dumbbells', blurb: 'Adjustable or fixed' },
  { value: 'machine', label: 'Machines', blurb: 'Selectorised, leg press, leg curl' },
  { value: 'cable', label: 'Cables', blurb: 'Pulldown, row, fly, pushdown' },
  { value: 'bodyweight', label: 'Bodyweight', blurb: 'Dips, pull-ups, push-ups' },
  { value: 'kettlebell', label: 'Kettlebell', blurb: 'Swings, goblet squat' },
  { value: 'band', label: 'Bands', blurb: 'Resistance bands' },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { setProfile, saveRoutine } = useApp();
  const [step, setStep] = useState(0);

  // Form state is held in the user's DISPLAY units and converted to metric on
  // commit. That keeps a pound user from ever seeing a stray "kg".
  const [unit, setUnit] = useState<UnitSystem>('metric');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Sex>('male');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [formula, setFormula] = useState<BmrFormula>('mifflin');
  const [bodyFat, setBodyFat] = useState('');
  const [activity, setActivity] = useState<ActivityLevel>('moderate');
  const [sessions, setSessions] = useState('3');
  const [sessionMinutes, setSessionMinutes] = useState('60');
  const [goal, setGoal] = useState<Goal>('cut_recomp');
  const [cutTier, setCutTier] = useState<CutTier>('moderate');
  const [bulkTier, setBulkTier] = useState<BulkTier>('moderate');
  const [level, setLevel] = useState<Level>('beginner');
  const [equipment, setEquipment] = useState<Equipment[]>(['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight']);

  const imp = isImperial(unit);
  const weightSuffix = imp ? 'lb' : 'kg';
  const heightSuffix = imp ? 'in' : 'cm';

  const parsed = useMemo(() => {
    const w = parseFloat(weight);
    const h = parseFloat(height);
    const a = parseInt(age, 10);
    const bf = parseFloat(bodyFat);
    const s = parseInt(sessions, 10) || 0;
    const sm = parseInt(sessionMinutes, 10) || 0;
    return {
      weightKg: imp ? (isFinite(w) ? w * 0.45359237 : NaN) : w,
      heightCm: imp ? (isFinite(h) ? h * 2.54 : NaN) : h,
      age: isFinite(a) ? a : NaN,
      bodyFatPct: isFinite(bf) && bf > 0 && bf < 70 ? bf : undefined,
      sessionsPerWeek: Math.max(0, Math.min(7, s)),
      averageSessionMinutes: Math.max(0, sm),
      heightDisplay: isFinite(h)
        ? imp
          ? `${Math.floor(cmToInch(h) / 12)}'${Math.round(cmToInch(h) % 12)}"`
          : `${h} cm`
        : '',
    };
  }, [weight, height, age, bodyFat, sessions, sessionMinutes, imp]);

  const canAdvance = useMemo(() => {
    switch (step) {
      case 0:
        return (
          isFinite(parsed.age) &&
          parsed.age >= 13 &&
          parsed.age <= 100 &&
          isFinite(parsed.weightKg) &&
          parsed.weightKg >= 30 &&
          isFinite(parsed.heightCm) &&
          parsed.heightCm >= 120 &&
          parsed.heightCm <= 230
        );
      case 1:
        return formula === 'mifflin' || parsed.bodyFatPct !== undefined;
      case 2:
        return parsed.sessionsPerWeek >= 0 && parsed.averageSessionMinutes >= 0;
      case 3:
        // At least one piece of equipment, or the generated plan comes out empty.
        return equipment.length > 0;
      case 4:
        return true;
      case 5:
        return true;
      default:
        return false;
    }
  }, [step, parsed, formula, equipment]);

  function commit() {
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
      return;
    }
    // Katch needs body fat. If the user skipped it, quietly fall back to
    // Mifflin rather than producing a wrong BMR.
    const useKatch = formula === 'katch' && canUseKatch({ bodyFatPct: parsed.bodyFatPct });

    const profile: Profile = {
      age: parsed.age,
      sex,
      weightKg: Math.round(parsed.weightKg * 10) / 10,
      heightCm: Math.round(parsed.heightCm),
      bodyFatPct: useKatch ? parsed.bodyFatPct : undefined,
      activityLevel: activity,
      unitSystem: unit,
      bmrFormula: useKatch ? 'katch' : 'mifflin',
      goal,
      cutTier: usesCutTiers(goal) ? cutTier : undefined,
      bulkTier: usesBulkTiers(goal) ? bulkTier : undefined,
      sessionsPerWeek: parsed.sessionsPerWeek,
      averageSessionMinutes: parsed.averageSessionMinutes,
      level,
      equipment,
      createdAt: Date.now(),
    };

    // Generate the training plan from the inputs just collected, so the first
    // screen after onboarding already has a plan waiting. This is the
    // "onboarding in, plan out" path the submission describes.
    try {
      const plan = generatePlan({
        goal: profile.goal,
        level,
        daysPerWeek: parsed.sessionsPerWeek || 3,
        equipment,
        sessionMinutes: parsed.averageSessionMinutes || 60,
      });
      const withExercises = plan.sessions.filter((s) => s.exercises.length > 0);
      if (withExercises.length > 0) {
        saveRoutine({
          id: uid('r'),
          name: plan.name,
          sessionNames: withExercises.map((s) => s.name),
          exercises: withExercises.flatMap((s) =>
            s.exercises.map((e, i) => ({ ...e, order: i, sessionName: s.name }))
          ),
          isBuiltIn: false,
          createdAt: Date.now(),
        });
      }
    } catch {
      // A failed generation must never block the nutrition plan, which is the
      // more important half. A plan can be built manually afterwards.
    }

    setProfile(profile);
  }

  const stepTitles = ['About you', 'Metabolic formula', 'Training', 'Your gym', 'Your goal', 'Intensity'];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 120 }}
      keyboardShouldPersistTaps="handled"
    >
      <Row style={{ justifyContent: 'space-between', marginBottom: space.lg }}>
        <Text style={[type.micro, { color: colors.textFaint, textTransform: 'uppercase' }]}>
          Step {step + 1} of {TOTAL_STEPS}
        </Text>
        <Tag text="VitalX" tone="accent" />
      </Row>
      <ProgressBar value={(step + 1) / TOTAL_STEPS} />

      <Text style={[type.display, { color: colors.text, marginTop: space.xl, marginBottom: space.sm }]}>
        {stepTitles[step]}
      </Text>

      {/* ---------------- Step 0: basics ---------------- */}
      {step === 0 ? (
        <View style={{ marginTop: space.md }}>
          <Field label="Units">
            <Segmented
              options={[
                { value: 'metric', label: 'kg / cm' },
                { value: 'imperial', label: 'lb / inches' },
              ]}
              value={unit}
              onChange={(v) => {
                // Clear the numeric fields so a stale cm value is never
                // reinterpreted as inches.
                setUnit(v);
                setWeight('');
                setHeight('');
              }}
            />
          </Field>

          <Field label="Age">
            <NumberField value={age} onChangeText={setAge} placeholder="28" suffix="years" keyboardType="number-pad" />
          </Field>

          <Field label="Sex (used by the Mifflin formula)">
            <Segmented
              options={[
                { value: 'male', label: 'Male' },
                { value: 'female', label: 'Female' },
              ]}
              value={sex}
              onChange={setSex}
            />
          </Field>

          <Field label="Weight">
            <NumberField value={weight} onChangeText={setWeight} placeholder={imp ? '176' : '80'} suffix={weightSuffix} />
          </Field>

          <Field label="Height">
            <NumberField
              value={height}
              onChangeText={setHeight}
              placeholder={imp ? '70' : '178'}
              suffix={heightSuffix}
            />
          </Field>

          {parsed.heightDisplay ? (
            <Text style={[type.caption, { color: colors.textDim, marginTop: -space.sm, marginBottom: space.md }]}>
              That is {parsed.heightDisplay}.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ---------------- Step 1: formula ---------------- */}
      {step === 1 ? (
        <View style={{ marginTop: space.md }}>
          <Text style={[type.body, { color: colors.textDim, lineHeight: 22, marginBottom: space.lg }]}>
            Your basal metabolic rate is the calories your body burns at rest. Two reliable ways to
            estimate it, and they need different inputs.
          </Text>

          <ChoiceCard
            title="Mifflin-St Jeor"
            blurb="Uses age, height, weight and sex. A good default if you do not track body fat."
            selected={formula === 'mifflin'}
            onPress={() => setFormula('mifflin')}
          />
          <ChoiceCard
            title="Katch-McArdle"
            blurb="Uses lean body mass, so it ignores sex entirely and is more accurate if your body fat is known."
            selected={formula === 'katch'}
            onPress={() => setFormula('katch')}
            badge="More accurate"
          />

          {formula === 'katch' ? (
            <View style={{ marginTop: space.lg }}>
              <Field label="Body fat percentage">
                <NumberField
                  value={bodyFat}
                  onChangeText={setBodyFat}
                  placeholder="18"
                  suffix="%"
                />
              </Field>
              <Text style={[type.caption, { color: colors.textFaint, lineHeight: 18 }]}>
                Not sure? Leave it blank and VitalX will use Mifflin instead. A rough estimate is
                better than nothing, but a wrong one is worse than either.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ---------------- Step 2: training ---------------- */}
      {step === 2 ? (
        <View style={{ marginTop: space.md }}>
          <Field label="How active are you outside the gym?" hint={ACTIVITY_MULTIPLIERS[activity].hint}>
            <View>
              {(Object.keys(ACTIVITY_MULTIPLIERS) as ActivityLevel[]).map((k) => (
                <View key={k} style={{ marginBottom: space.sm }}>
                  <ChoiceCard
                    title={ACTIVITY_MULTIPLIERS[k].label}
                    blurb={ACTIVITY_MULTIPLIERS[k].hint}
                    selected={activity === k}
                    onPress={() => setActivity(k)}
                    badge={`${ACTIVITY_MULTIPLIERS[k].mult}x`}
                  />
                </View>
              ))}
            </View>
          </Field>

          <Field label="Sessions per week">
            <NumberField value={sessions} onChangeText={setSessions} placeholder="3" suffix="days" keyboardType="number-pad" />
          </Field>

          <Field label="Average session length">
            <NumberField
              value={sessionMinutes}
              onChangeText={setSessionMinutes}
              placeholder="60"
              suffix="minutes"
              keyboardType="number-pad"
            />
          </Field>
        </View>
      ) : null}

      {/* ---------------- Step 3: gym ---------------- */}
      {step === 3 ? (
        <View style={{ marginTop: space.md }}>
          <Text style={[type.body, { color: colors.textDim, lineHeight: 22, marginBottom: space.lg }]}>
            VitalX builds your workout plan from what you can actually do. Pick your experience and
            the kit you have access to.
          </Text>

          <Field label="Training experience">
            <View>
              {(
                [
                  { v: 'beginner', label: 'Beginner', blurb: 'Under a year of consistent training' },
                  { v: 'intermediate', label: 'Intermediate', blurb: 'One to three years, confident with the main lifts' },
                  { v: 'advanced', label: 'Advanced', blurb: 'Three years or more, training around a programme' },
                ] as { v: Level; label: string; blurb: string }[]
              ).map((o) => (
                <ChoiceCard
                  key={o.v}
                  title={o.label}
                  blurb={o.blurb}
                  selected={level === o.v}
                  onPress={() => setLevel(o.v)}
                />
              ))}
            </View>
          </Field>

          <Field label="Equipment you can use">
            <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
              {EQUIPMENT_OPTIONS.map((o) => {
                const on = equipment.includes(o.value);
                return (
                  <Pressable
                    key={o.value}
                    onPress={() =>
                      setEquipment((cur) =>
                        cur.includes(o.value) ? cur.filter((x) => x !== o.value) : [...cur, o.value]
                      )
                    }
                    style={{
                      paddingHorizontal: space.md,
                      paddingVertical: 9,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: on ? colors.accent : colors.border,
                      backgroundColor: on ? colors.accent : 'transparent',
                    }}
                  >
                    <Text style={[type.caption, { color: on ? colors.accentText : colors.textDim }]}>
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
          </Field>

          <Text style={[type.caption, { color: colors.textFaint, lineHeight: 18 }]}>
            Only exercises you can perform will appear in your plan. Select bodyweight at minimum.
          </Text>
        </View>
      ) : null}

      {/* ---------------- Step 4: goal ---------------- */}
      {step === 4 ? (
        <View style={{ marginTop: space.md }}>
          <Text style={[type.body, { color: colors.textDim, lineHeight: 22, marginBottom: space.lg }]}>
            This decides your calorie direction and how VitalX splits your macros.
          </Text>
          {GOAL_ORDER.map((g) => (
            <ChoiceCard
              key={g}
              title={GOAL_META[g].title}
              blurb={GOAL_META[g].blurb}
              selected={goal === g}
              onPress={() => setGoal(g)}
            />
          ))}
        </View>
      ) : null}

      {/* ---------------- Step 5: intensity ---------------- */}
      {step === 5 ? (
        <View style={{ marginTop: space.md }}>
          {usesCutTiers(goal) ? (
            <>
              <Text style={[type.body, { color: colors.textDim, lineHeight: 22, marginBottom: space.lg }]}>
                How hard should the deficit be? All three keep protein at the same level, so the
                difference is mainly how fast you move and how much muscle you risk.
              </Text>
              {(Object.keys(CUT_DEFICITS) as CutTier[]).map((t) => (
                <ChoiceCard
                  key={t}
                  title={CUT_TIER_META[t].label}
                  blurb={CUT_TIER_META[t].blurb}
                  selected={cutTier === t}
                  onPress={() => setCutTier(t)}
                  badge={`-${CUT_DEFICITS[t]} kcal`}
                />
              ))}
            </>
          ) : usesBulkTiers(goal) ? (
            <>
              <Text style={[type.body, { color: colors.textDim, lineHeight: 22, marginBottom: space.lg }]}>
                How much surplus do you want? The higher tiers add fat roughly as fast as they add
                muscle.
              </Text>
              {(Object.keys(BULK_SURPLUSES) as BulkTier[]).map((t) => (
                <ChoiceCard
                  key={t}
                  title={BULK_TIER_META[t].label}
                  blurb={BULK_TIER_META[t].blurb}
                  selected={bulkTier === t}
                  onPress={() => setBulkTier(t)}
                  badge={`+${BULK_SURPLUSES[t]} kcal`}
                />
              ))}
            </>
          ) : (
            <>
              <Text style={[type.body, { color: colors.textDim, lineHeight: 22, marginBottom: space.lg }]}>
                You will eat at maintenance, so calories burned equals calories eaten. All training
                progress should show up as lean mass rather than scale weight.
              </Text>
              <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={[type.bodyStrong, { color: colors.text }]}>Daily adjustment</Text>
                  <Tag text="0 kcal" tone="accent" />
                </Row>
              </Card>
            </>
          )}
        </View>
      ) : null}

      <View style={{ marginTop: space.xl, gap: space.sm }}>
        <Button label={step < TOTAL_STEPS - 1 ? 'Continue' : 'Build my plan'} onPress={commit} disabled={!canAdvance} />
        {step > 0 ? <Button label="Back" variant="ghost" onPress={() => setStep(step - 1)} /> : null}
      </View>
    </ScrollView>
  );
}
