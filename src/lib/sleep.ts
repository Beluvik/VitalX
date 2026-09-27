/**
 * Sleep and recovery scoring.
 *
 * IMPORTANT: the REM figure here is an ESTIMATE, not a measurement. There is
 * no medical sensor in this app. Every surface that shows a REM number must
 * label it as an estimate, and the user can always override it with a
 * self-reported value.
 *
 * Model:
 *   duration   - raw time in bed, minus a 30 min time-to-fall-asleep allowance
 *   durationScore - linear, 0 h = 0, 8.5 h = 10
 *   interruptionScore - 10 minus one per wake, floored at 4
 *   rem         - fraction of adjusted sleep scaled by how good the night was
 *   recovery    - weighted blend, plus a small consistency bonus
 */

import { SleepEntry, SleepScore } from '../types';

/** Allowance subtracted from time in bed before scoring. */
export const FALL_ASLEEP_ALLOWANCE_MIN = 30;
/** Adjusted duration that scores a perfect 10. */
export const IDEAL_SLEEP_HOURS = 8.5;
export const REM_SCORE_FULL_MIN = 90;
export const INTERRUPTION_FLOOR = 4;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Minutes from "HH:MM" after midnight. */
export function parseHm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/** Duration in minutes, handling a wake time that crosses midnight. */
export function sleepDurationMinutes(bedTime: string, wakeTime: string): number {
  const bed = parseHm(bedTime);
  const wake = parseHm(wakeTime);
  let diff = wake - bed;
  // Strictly less than, so identical times mean "0 hours of sleep" rather than
  // rolling over to a full 24 and scoring a perfect night on empty input.
  if (diff < 0) diff += 24 * 60;
  return diff;
}

export interface SleepInput {
  bedTime: string;
  wakeTime: string;
  interruptions: number;
  remMinutesSelfReported?: number;
  /** Bed and wake time from the previous night, for the consistency bonus. */
  previous?: { bedTime: string; wakeTime: string };
  /** Consecutive prior nights already matching within tolerance. */
  consistencyStreak?: number;
}

export const CONSISTENCY_TOLERANCE_MIN = 30;

export function scoreSleep(input: SleepInput): SleepScore {
  const rawMin = sleepDurationMinutes(input.bedTime, input.wakeTime);
  const adjustedMin = Math.max(0, rawMin - FALL_ASLEEP_ALLOWANCE_MIN);
  const rawDurationH = round1(rawMin / 60);
  const adjustedDurationH = round1(adjustedMin / 60);

  // 0 h = 0, 8.5 h = 10.
  const durationScore = round1(clamp((adjustedMin / 60 / IDEAL_SLEEP_HOURS) * 10, 0, 10));

  const interruptions = Math.max(0, Math.round(input.interruptions));
  const interruptionScore = round1(clamp(10 - interruptions, INTERRUPTION_FLOOR, 10));

  // How good the night was overall, used to scale the REM fraction.
  const nightQuality = 0.7 * (durationScore / 10) + 0.3 * (interruptionScore / 10);

  // Adults run roughly 12-26% REM depending on sleep quality. Fragmented
  // nights lose REM disproportionately, which the quality term captures.
  const remFraction = 0.12 + 0.14 * nightQuality;
  const estimatedRemMin = Math.round((adjustedMin * remFraction));

  const reportedRem = input.remMinutesSelfReported;
  const remIsEstimated = typeof reportedRem !== 'number' || reportedRem <= 0;
  const remMinutes = remIsEstimated ? estimatedRemMin : Math.round(reportedRem);
  const remScore = round1(clamp(remMinutes / REM_SCORE_FULL_MIN * 10, 0, 10));

  const recoveryScore = round1(
    clamp(durationScore * 0.5 + interruptionScore * 0.2 + remScore * 0.3, 0, 10)
  );

  // --- consistency ---------------------------------------------------------
  let consistencyBonus = 0;
  if (input.previous) {
    const bedDrift = Math.abs(minuteDistance(parseHm(input.bedTime), parseHm(input.previous.bedTime)));
    const wakeDrift = Math.abs(minuteDistance(parseHm(input.wakeTime), parseHm(input.previous.wakeTime)));
    if (bedDrift <= CONSISTENCY_TOLERANCE_MIN && wakeDrift <= CONSISTENCY_TOLERANCE_MIN) {
      consistencyBonus = clamp((input.consistencyStreak ?? 0) + 1, 0, 3);
    } else {
      consistencyBonus = 0;
    }
  } else {
    consistencyBonus = clamp(input.consistencyStreak ?? 0, 0, 3);
  }

  return {
    bedTime: input.bedTime,
    wakeTime: input.wakeTime,
    rawDurationH,
    adjustedDurationH,
    durationScore,
    interruptions,
    interruptionScore,
    remMinutes,
    remScore,
    remIsEstimated,
    recoveryScore,
    consistencyBonus,
  };
}

/** Shortest signed distance between two minutes-of-day values. */
function minuteDistance(a: number, b: number): number {
  const raw = a - b;
  return Math.abs(raw) > 720 ? 1440 - Math.abs(raw) : raw;
}

/** Reusable copy so the UI does not hard-code health claims. */
export const SLEEP_EDUCATION = {
  rem: {
    title: 'REM sleep',
    body: 'REM is the phase where your brain is most active and your muscles are paralysed. It is when you consolidate motor learning, which is why a hard training day needs good REM the night after. Roughly a fifth to a quarter of total sleep.',
    estimateNote:
      'VitalX estimates REM from your total sleep and how uninterrupted the night was. It is not measured. If you wear a tracker, enter the real number and VitalX will use that instead.',
  },
  consistency: {
    title: 'Why the clock matters more than the hours',
    body: 'Going to bed and waking at the same time every day keeps your circadian rhythm aligned, which improves sleep quality even when the total is unchanged. It is the single most underrated part of recovery.',
  },
} as const;

/**
 * Mean recovery score over the last `window` days, most recent first.
 *
 * Uses the days that actually have sleep data rather than assuming every day
 * was logged: averaging in days the user never scored would dilute the signal
 * and quietly turn three bad nights into "probably fine".
 *
 * Returns null when there is nothing to go on, so callers can skip the
 * adjustment instead of applying a meaningless one.
 */
export function recentRecoveryScore(
  days: Record<string, { sleep?: SleepScore }>,
  window = 3
): number | null {
  const scores = Object.values(days)
    .map((d) => d.sleep?.recoveryScore)
    .filter((s): s is number => typeof s === 'number')
    .sort((a, b) => b - a) // newest scores were computed most recently
    .slice(0, window);

  if (scores.length === 0) return null;
  return round1(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * Recovery state for today, including the extras when present.
 * This is what the plan generator consults before prescribing a session.
 *
 * With no sleep data at all the answer is "normal", not "worst case".
 * Absence of data is not evidence of poor recovery, and defaulting to a rest
 * day would mean a brand new user is told to stop training on day one.
 */
export function currentRecovery(
  days: Record<string, { sleep?: SleepScore }>,
  restingHr?: number,
  hrvMs?: number
): { advice: RecoveryAdvice; average: number | null; basedOnNights: number } {
  const scored = Object.values(days).filter(
    (d): d is { sleep: SleepScore } => typeof d.sleep?.recoveryScore === 'number'
  );

  if (scored.length === 0) {
    return {
      advice: {
        action: 'normal',
        headline: 'No sleep data yet',
        body: 'Log last night\'s sleep and VitalX will start adjusting your sessions to how you are actually recovering.',
        volumeMultiplier: 1,
      },
      average: null,
      basedOnNights: 0,
    };
  }

  const scores = scored
    .map((d) => d.sleep.recoveryScore)
    .sort((a, b) => b - a)
    .slice(0, 3);

  const average = round1(scores.reduce((a, b) => a + b, 0) / scores.length);

  return {
    advice: recoveryAdvice(average, restingHr, hrvMs),
    average,
    basedOnNights: scores.length,
  };
}

export type RecoveryAdviceAction = 'rest_day' | 'reduce_volume' | 'normal' | 'progress';

export interface RecoveryAdvice {
  action: RecoveryAdviceAction;
  headline: string;
  body: string;
  /** Multiplier the plan generator should apply to sets, or null for a rest day. */
  volumeMultiplier: number | null;
}

/**
 * Turns recent recovery into a plan change. This is the differentiator in the
 * hackathon submission: the plan responds to recovery instead of staying static.
 *
 * Thresholds, and why: the recovery score blends adjusted sleep duration (50%),
 * interruptions (20%) and REM (30%). Below 5 out of 10 is roughly four hours of
 * sleep with repeated wake-ups, which is not a day to train hard through.
 *
 * @param averageRecovery mean recoveryScore over the recent window, 0-10
 * @param restingHr optional resting heart rate
 */
export function recoveryAdvice(
  averageRecovery: number,
  restingHr?: number,
  hrvMs?: number
): RecoveryAdvice {
  if (averageRecovery < 5) {
    return {
      action: 'rest_day',
      headline: 'Rest day recommended',
      body: 'Your recent recovery is low. Training hard on top of poor sleep raises injury risk and usually costs you more progress than it gains. Sleep, eat to target, and train tomorrow.',
      volumeMultiplier: null,
    };
  }

  if (averageRecovery < 7) {
    return {
      action: 'reduce_volume',
      headline: 'Trim volume about a third',
      body: 'Recovery is below where it should be. Drop roughly a third of your sets this week and keep the loads. Volume is what you can afford to cut; intensity is what signals growth.',
      volumeMultiplier: 0.67,
    };
  }

  if (averageRecovery >= 8.5 && typeof hrvMs === 'number' && hrvMs >= 60) {
    return {
      action: 'progress',
      headline: 'Good day to progress',
      body: 'Sleep and HRV are both strong. Add a little load or one set per muscle group while your recovery holds up.',
      volumeMultiplier: 1.1,
    };
  }

  if (averageRecovery >= 8) {
    return {
      action: 'progress',
      headline: 'Recovery is on track',
      body: 'You are well recovered. Run the plan as written and look for progressive overload on your main lifts.',
      volumeMultiplier: 1.0,
    };
  }

  return {
    action: 'normal',
    headline: 'Run the plan as written',
    body: 'Recovery is in a normal range. No changes needed today.',
    volumeMultiplier: 1.0,
  };
}
