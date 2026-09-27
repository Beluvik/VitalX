/**
 * Engine tests. These cover the parts of VitalX that produce numbers a user
 * will act on, so a regression here is a health-advice regression.
 *
 * Run with:  npm test
 */

import { adjustmentFor, computeNutritionPlan } from '../src/lib/nutrition';
import { recoveryAdvice, scoreSleep, sleepDurationMinutes } from '../src/lib/sleep';
import { sessionBurn, stepBurn } from '../src/lib/energy';
import { Profile, Goal } from '../src/types';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

const base: Profile = {
  age: 28,
  sex: 'male',
  weightKg: 80,
  heightCm: 178,
  activityLevel: 'moderate',
  unitSystem: 'metric',
  bmrFormula: 'mifflin',
  goal: 'cut_recomp',
  cutTier: 'moderate',
  sessionsPerWeek: 4,
  averageSessionMinutes: 60,
  createdAt: 0,
};

// ---------------------------------------------------------------------------
console.log('\n-- macros always sum to the calorie target --');
const TIER_SETS: Record<string, { goal: Goal; tier: string }[]> = {
  'cut_recomp': [{ goal: 'cut_recomp', tier: 'slow' }, { goal: 'cut_recomp', tier: 'moderate' }, { goal: 'cut_recomp', tier: 'aggressive' }],
  'cut_fat_only': [{ goal: 'cut_fat_only', tier: 'slow' }, { goal: 'cut_fat_only', tier: 'moderate' }, { goal: 'cut_fat_only', tier: 'aggressive' }],
  'bulk': [{ goal: 'bulk', tier: 'slight' }, { goal: 'bulk', tier: 'moderate' }, { goal: 'bulk', tier: 'excess' }],
  'maintain_recomp': [{ goal: 'maintain_recomp', tier: 'none' }],
};

for (const list of Object.values(TIER_SETS)) {
  for (const { goal, tier } of list) {
    const plan = computeNutritionPlan({ ...base, goal, cutTier: tier as any, bulkTier: tier as any });
    const sum = plan.proteinG * 4 + plan.fatG * 9 + plan.carbsG * 4;
    check(`${goal}/${tier} sums to target`, isFinite(sum) && near(sum, plan.targetCalories, 12), `${sum} vs ${plan.targetCalories}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n-- bad tier data must not poison the plan --');
const badTier = computeNutritionPlan({ ...base, goal: 'bulk', bulkTier: 'nonsense' as any });
check('unknown bulk tier falls back', isFinite(badTier.targetCalories) && badTier.targetCalories > 0, `${badTier.targetCalories}`);
check('missing cut tier falls back', adjustmentFor({ ...base, cutTier: undefined }) === -600);

// ---------------------------------------------------------------------------
console.log('\n-- tier adjustments match the spec --');
check('cut slow = -500', adjustmentFor({ ...base, goal: 'cut_recomp', cutTier: 'slow' }) === -500);
check('cut moderate = -600', adjustmentFor({ ...base, goal: 'cut_recomp', cutTier: 'moderate' }) === -600);
check('cut aggressive = -800', adjustmentFor({ ...base, goal: 'cut_recomp', cutTier: 'aggressive' }) === -800);
check('bulk slight = +250', adjustmentFor({ ...base, goal: 'bulk', bulkTier: 'slight' }) === 250);
check('bulk moderate = +550', adjustmentFor({ ...base, goal: 'bulk', bulkTier: 'moderate' }) === 550);
check('bulk excess = +1000', adjustmentFor({ ...base, goal: 'bulk', bulkTier: 'excess' }) === 1000);
check('maintain = 0', adjustmentFor({ ...base, goal: 'maintain_recomp' }) === 0);

// ---------------------------------------------------------------------------
console.log('\n-- protein floor --');
check('recomp protein >= 1.6 g/kg', computeNutritionPlan(base).proteinG >= 1.6 * 80);
check('bulk protein >= 1.6 g/kg', computeNutritionPlan({ ...base, goal: 'bulk', bulkTier: 'slight' }).proteinG >= 1.6 * 80);

// ---------------------------------------------------------------------------
console.log('\n-- safe calorie floor --');
const small = computeNutritionPlan({ ...base, sex: 'female', weightKg: 50, heightCm: 160, age: 25, activityLevel: 'sedentary', goal: 'cut_fat_only', cutTier: 'aggressive' });
check('never below 1200 for female', small.targetCalories >= 1200, `${small.targetCalories}`);
check('floored warning raised', small.warnings.some((w) => w.code === 'below_safe_floor'));
check('never below 1500 for male', computeNutritionPlan({ ...base, weightKg: 45, goal: 'cut_fat_only', cutTier: 'aggressive' }).targetCalories >= 1500);

// ---------------------------------------------------------------------------
console.log('\n-- BMR formulas --');
const katch = computeNutritionPlan({ ...base, bmrFormula: 'katch', bodyFatPct: 20 });
check('katch used when body fat present', katch.bmrFormulaUsed === 'katch');
// 370 + 21.6 * (80 * 0.8) = 1752, times the moderate multiplier
check('katch math correct', near(katch.tdee, Math.round(1752 * 1.55)), `${katch.tdee}`);
check('falls back to mifflin without body fat', computeNutritionPlan({ ...base, bmrFormula: 'katch', bodyFatPct: undefined }).bmrFormulaUsed === 'mifflin');

// ---------------------------------------------------------------------------
console.log('\n-- warnings --');
check('large surplus warned', computeNutritionPlan({ ...base, goal: 'bulk', bulkTier: 'excess' }).warnings.some((w) => w.code === 'excess_surplus'));

// ---------------------------------------------------------------------------
console.log('\n-- recomposition --');
const recomp = computeNutritionPlan({ ...base, goal: 'cut_recomp', cutTier: 'moderate', bodyFatPct: 22 });
check('projection present', !!recomp.recomposition);
check('fat loss is negative', recomp.recomposition!.fatChangeKgPerWeek < 0);
check('lean roughly held at -600', recomp.recomposition!.leanChangeKgPerWeek > -0.1, `${recomp.recomposition!.leanChangeKgPerWeek}`);
check('low body fat flagged', computeNutritionPlan({ ...base, goal: 'cut_recomp', cutTier: 'moderate', bodyFatPct: 9 }).warnings.some((w) => w.code === 'recomp_unrealistic'));

// ---------------------------------------------------------------------------
console.log('\n-- carb quality --');
check('complex > simple', recomp.carbs.complexG > recomp.carbs.simpleG);
check('fibre > 0', recomp.carbs.fibreG > 0);
check('fat within 25-30%', recomp.fatPercent >= 0.25 && recomp.fatPercent <= 0.3, `${(recomp.fatPercent * 100).toFixed(1)}%`);

// ---------------------------------------------------------------------------
console.log('\n-- sleep scoring --');
const good = scoreSleep({ bedTime: '23:00', wakeTime: '07:00', interruptions: 0 });
check('8h in bed -> 7.5h adjusted', near(good.adjustedDurationH, 7.5, 0.1), `${good.adjustedDurationH}`);
check('8.5h adjusted scores 10', scoreSleep({ bedTime: '22:00', wakeTime: '07:00', interruptions: 0 }).durationScore === 10);
check('0h scores 0', scoreSleep({ bedTime: '07:00', wakeTime: '07:00', interruptions: 0 }).adjustedDurationH === 0);
check('no interruptions = 10', good.interruptionScore === 10);
check('interruptions lower score', scoreSleep({ bedTime: '23:00', wakeTime: '07:00', interruptions: 3 }).interruptionScore === 7);
check('interruptions floor at 4', scoreSleep({ bedTime: '23:00', wakeTime: '07:00', interruptions: 20 }).interruptionScore === 4);
check('REM estimated by default', good.remIsEstimated === true);
check('REM self-report wins', scoreSleep({ bedTime: '23:00', wakeTime: '07:00', interruptions: 0, remMinutesSelfReported: 100 }).remMinutes === 100);
check('midnight crossing works', near(scoreSleep({ bedTime: '22:30', wakeTime: '06:00', interruptions: 1 }).adjustedDurationH, 7, 0.1));
check('duration helper is 0 for same time', sleepDurationMinutes('07:00', '07:00') === 0);

// ---------------------------------------------------------------------------
console.log('\n-- consistency bonus --');
check('within 30 min earns a streak', scoreSleep({ bedTime: '23:00', wakeTime: '07:00', interruptions: 0, previous: { bedTime: '23:10', wakeTime: '07:05' } }).consistencyBonus === 1);
check('drifted bedtime breaks it', scoreSleep({ bedTime: '23:00', wakeTime: '07:00', interruptions: 0, previous: { bedTime: '01:00', wakeTime: '07:00' } }).consistencyBonus === 0);

// ---------------------------------------------------------------------------
console.log('\n-- recovery advice --');
check('low recovery -> rest day', recoveryAdvice(2).action === 'rest_day');
check('mid recovery -> reduce volume', recoveryAdvice(5).action === 'reduce_volume');
check('high recovery -> progress', recoveryAdvice(9, 55, 70).action === 'progress');
check('normal recovery -> normal', recoveryAdvice(7).action === 'normal');

// ---------------------------------------------------------------------------
console.log('\n-- energy --');
check('strong band 400', sessionBurn('strong', 60) === 400);
check('moderate band 325', sessionBurn('moderate', 60) === 325);
check('minimal band 250', sessionBurn('minimal', 60) === 250);
check('short session burns less', sessionBurn('strong', 30) < sessionBurn('strong', 60));
check('long session burns more', sessionBurn('strong', 90) > sessionBurn('strong', 60));
check('10k steps at 70kg = 350', stepBurn(10000, 70) === 350);

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) throw new Error(`${fail} test(s) failed`);
