import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Banner,
  Button,
  Card,
  Divider,
  MacroBar,
  ProgressBar,
  Row,
  SectionTitle,
  StatTile,
  Tag,
} from '../components/ui';
import { timeToGreeting } from '../lib/format';
import { currentRecovery } from '../lib/sleep';
import { CARB_EDUCATION, GOAL_META, computeNutritionPlan } from '../lib/nutrition';
import { displayWeight, isImperial } from '../lib/units';
import { colors, space, type } from '../theme';
import { useApp, todayKey } from '../store/AppState';

interface Props {
  onLogMeal: () => void;
  onTrain: () => void;
}

export default function PlanScreen({ onLogMeal, onTrain }: Props) {
  const insets = useSafeAreaInsets();
  const { profile, day, routines, activeWorkout } = useApp();
  const today = todayKey();
  const log = day(today);

  const plan = useMemo(() => (profile ? computeNutritionPlan(profile) : null), [profile]);

  // Same signal the plan generator uses, so the dashboard and the next
  // session can never disagree about recovery.
  const recovery = useMemo(() => currentRecovery({ [today]: log }), [today, log.sleep]);

  const consumed = useMemo(() => {
    return log.foods.reduce(
      (acc, f) => ({
        protein: acc.protein + f.protein,
        carbs: acc.carbs + f.carbs,
        fat: acc.fat + f.fat,
        kcal: acc.kcal + f.kcal,
      }),
      { protein: 0, carbs: 0, fat: 0, kcal: 0 }
    );
  }, [log.foods]);

  if (!profile || !plan) return null;

  const remaining = Math.max(0, plan.targetCalories - consumed.kcal);
  const progress = plan.targetCalories > 0 ? consumed.kcal / plan.targetCalories : 0;
  const imp = isImperial(profile.unitSystem);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
    >
      <Row style={{ justifyContent: 'space-between', marginBottom: space.lg }}>
        <View>
          <Text style={[type.display, { color: colors.text }]}>{timeToGreeting()}</Text>
          <Text style={[type.caption, { color: colors.textDim, marginTop: 2 }]}>
            {GOAL_META[profile.goal].short} plan
          </Text>
        </View>
        <Tag text={`${displayWeight(profile.weightKg, profile.unitSystem)} ${imp ? 'lb' : 'kg'}`} />
      </Row>

      {/* ---------------- calorie target ---------------- */}
      <Card>
        <SectionTitle>Today's target</SectionTitle>
        <Text style={[type.display, { color: colors.accent, fontSize: 44 }]}>{plan.targetCalories}</Text>
        <Text style={[type.caption, { color: colors.textDim, marginTop: 2 }]}>kcal per day</Text>

        <View style={{ marginTop: space.lg }}>
          <ProgressBar value={progress} tint={progress > 1 ? colors.warning : colors.accent} height={10} />
          <Row style={{ justifyContent: 'space-between', marginTop: space.sm }}>
            <Text style={[type.caption, { color: colors.textDim }]}>
              {consumed.kcal} kcal eaten
            </Text>
            <Text style={[type.caption, { color: remaining > 0 ? colors.textDim : colors.warning }]}>
              {remaining > 0 ? `${remaining} kcal left` : `${Math.abs(remaining)} kcal over`}
            </Text>
          </Row>
        </View>

        <Divider />

        <Row>
          <StatTile label="BMR" value={`${plan.bmr}`} sub="at rest" />
          <StatTile label="TDEE" value={`${plan.tdee}`} sub="maintenance" />
          <StatTile
            label="Adjustment"
            value={`${plan.adjustment > 0 ? '+' : ''}${plan.adjustment}`}
            sub={plan.adjustment === 0 ? 'maintain' : plan.adjustment < 0 ? 'deficit' : 'surplus'}
            tint={plan.adjustment < 0 ? colors.info : plan.adjustment > 0 ? colors.warning : colors.text}
          />
        </Row>
      </Card>

      {/* ---------------- warnings ---------------- */}
      {plan.warnings.length > 0 ? (
        <View style={{ marginTop: space.lg }}>
          {plan.warnings.map((w) => (
            <Banner key={w.code} tone={w.severity} title={w.title} body={w.body} />
          ))}
        </View>
      ) : null}

      {/* ---------------- macros ---------------- */}
      <Card style={{ marginTop: space.lg }}>
        <SectionTitle>Macro split</SectionTitle>

        <MacroBar protein={consumed.protein} carbs={consumed.carbs} fat={consumed.fat} />
        <Row style={{ marginTop: space.md, justifyContent: 'space-between' }}>
          <MacroLegend color={colors.protein} label="Protein" value={consumed.protein} target={plan.proteinG} />
          <MacroLegend color={colors.carbs} label="Carbs" value={consumed.carbs} target={plan.carbsG} />
          <MacroLegend color={colors.fat} label="Fat" value={consumed.fat} target={plan.fatG} />
        </Row>

        <Divider />

        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={[type.caption, { color: colors.textDim }]}>Fat share</Text>
          <Text style={[type.caption, { color: colors.text }]}>
            {Math.round(plan.fatPercent * 100)}% of calories (target 25-30%)
          </Text>
        </Row>
        <View style={{ height: space.sm }} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={[type.caption, { color: colors.textDim }]}>Protein</Text>
          <Text style={[type.caption, { color: colors.text }]}>
            {plan.proteinG} g, {(profile.weightKg * 1.6).toFixed(1)} g/kg bodyweight
          </Text>
        </Row>
      </Card>

      {/* ---------------- carb quality ---------------- */}
      <Card style={{ marginTop: space.lg }}>
        <SectionTitle hint="Most of your carbohydrate should come from the complex side.">
          Which carbs to eat
        </SectionTitle>

        <View style={{ marginBottom: space.md }}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={[type.bodyStrong, { color: colors.accent }]}>Complex</Text>
            <Text style={[type.caption, { color: colors.textDim }]}>{plan.carbs.complexG} g</Text>
          </Row>
          <ProgressBar value={plan.carbs.complexG / Math.max(1, plan.carbsG)} tint={colors.accent} />
        </View>

        <View style={{ marginBottom: space.lg }}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={[type.bodyStrong, { color: colors.warning }]}>Simple</Text>
            <Text style={[type.caption, { color: colors.textDim }]}>{plan.carbs.simpleG} g</Text>
          </Row>
          <ProgressBar value={plan.carbs.simpleG / Math.max(1, plan.carbsG)} tint={colors.warning} />
        </View>

        <Text style={[type.caption, { color: colors.textDim, lineHeight: 19 }]}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{CARB_EDUCATION.complex.title}. </Text>
          {CARB_EDUCATION.complex.body}
        </Text>
        <View style={{ height: space.sm }} />
        <Text style={[type.caption, { color: colors.textDim, lineHeight: 19 }]}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{CARB_EDUCATION.simple.title}. </Text>
          {CARB_EDUCATION.simple.body}
        </Text>

        <View style={{ height: space.md }} />
        <Text style={[type.caption, { color: colors.accent }]}>
          Fibre target: {plan.carbs.fibreG} g a day
        </Text>
      </Card>

      {/* ---------------- recomposition ---------------- */}
      {plan.recomposition ? (
        <Card style={{ marginTop: space.lg }}>
          <SectionTitle hint="An estimate with wide error bars, not a prediction.">
            Recomposition outlook
          </SectionTitle>
          <Row>
            <StatTile
              label="Fat"
              value={`${plan.recomposition.fatChangeKgPerWeek.toFixed(2)} kg`}
              sub="per week"
              tint={colors.info}
            />
            <StatTile
              label="Lean mass"
              value={`${plan.recomposition.leanChangeKgPerWeek > 0 ? '+' : ''}${plan.recomposition.leanChangeKgPerWeek.toFixed(2)} kg`}
              sub="per week"
              tint={plan.recomposition.leanChangeKgPerWeek >= 0 ? colors.accent : colors.warning}
            />
          </Row>
          <View style={{ height: space.md }} />
          <Text style={[type.caption, { color: colors.textDim, lineHeight: 19 }]}>
            {plan.recomposition.caveat}
          </Text>
        </Card>
      ) : null}

      {/* ---------------- training today ---------------- */}
      <Card style={{ marginTop: space.lg }}>
        <SectionTitle>Training</SectionTitle>

        {log.gymBurn > 0 ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Text style={[type.bodyStrong, { color: colors.text }]}>Session logged</Text>
              <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>
                {log.gymBurn} kcal estimated burn
              </Text>
            </View>
            <Tag text="done" tone="accent" />
          </Row>
        ) : activeWorkout ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyStrong, { color: colors.accent }]} numberOfLines={1}>
                {activeWorkout.name}
              </Text>
              <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>In progress</Text>
            </View>
            <Tag text="live" tone="accent" />
          </Row>
        ) : routines.length > 0 ? (
          <View>
            <Text style={[type.bodyStrong, { color: colors.text }]}>{routines[0].name}</Text>
            <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>
              {routines[0].exercises.length} exercises across{' '}
              {routines[0].sessionNames?.length ?? 1} day
              {(routines[0].sessionNames?.length ?? 1) === 1 ? '' : 's'}
            </Text>
          </View>
        ) : (
          <Text style={[type.caption, { color: colors.textFaint }]}>
            No plan yet. The Training tab can build one from your level and equipment.
          </Text>
        )}

        {log.sleep ? (
          <>
            <Divider />
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Text style={[type.bodyStrong, { color: colors.text }]}>Recovery</Text>
                <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>
                  {log.sleep.recoveryScore}/10 · sleep {log.sleep.durationScore} · REM{' '}
                  {log.sleep.remScore}
                  {log.sleep.remIsEstimated ? ' (estimated)' : ''}
                </Text>
              </View>
              <Tag
                text={recovery.advice.action.replace('_', ' ')}
                tone={
                  recovery.advice.action === 'rest_day'
                    ? 'danger'
                    : recovery.advice.action === 'normal'
                    ? 'info'
                    : 'warning'
                }
              />
            </Row>
            <View style={{ height: space.md }} />
            <Text style={[type.caption, { color: colors.textDim, lineHeight: 19 }]}>
              {recovery.advice.headline}. Your next session is adjusted from this.
            </Text>
          </>
        ) : null}
      </Card>

      {/* ---------------- food today ---------------- */}
      <Card style={{ marginTop: space.lg }}>
        <SectionTitle>Today's food</SectionTitle>
        {log.foods.length === 0 ? (
          <Text style={[type.caption, { color: colors.textFaint }]}>
            Nothing logged yet. Add your first meal to see live macro progress.
          </Text>
        ) : (
          <View style={{ gap: space.sm }}>
            {log.foods.slice(-4).map((f) => (
              <Row key={f.id} style={{ justifyContent: 'space-between' }}>
                <Text style={[type.body, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                  {f.name}
                </Text>
                <Text style={[type.caption, { color: colors.textDim }]}>
                  {f.grams} g · {Math.round(f.kcal)} kcal
                </Text>
              </Row>
            ))}
            {log.foods.length > 4 ? (
              <Text style={[type.caption, { color: colors.textFaint }]}>
                +{log.foods.length - 4} more
              </Text>
            ) : null}
          </View>
        )}
        <View style={{ height: space.lg }} />
        <Button label="Log a meal" onPress={onLogMeal} variant="ghost" />
      </Card>

      <View style={{ height: space.md }} />
      <Button label="Go to training" onPress={onTrain} variant="ghost" />
    </ScrollView>
  );
}

function MacroLegend({
  color,
  label,
  value,
  target,
}: {
  color: string;
  label: string;
  value: number;
  target: number;
}) {
  const short = target - value;
  return (
    <View style={{ flex: 1 }}>
      <Row style={{ gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <Text style={[type.caption, { color: colors.textDim }]}>{label}</Text>
      </Row>
      <Text style={[type.heading, { color: colors.text, marginTop: 2 }]}>{Math.round(value)} g</Text>
      <Text style={[type.micro, { color: short < 0 ? colors.warning : colors.textFaint }]}>
        {short >= 0 ? `${Math.round(short)} g left` : `${Math.abs(Math.round(short))} g over`}
      </Text>
    </View>
  );
}
