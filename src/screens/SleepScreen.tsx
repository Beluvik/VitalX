import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Banner,
  Button,
  Card,
  Divider,
  NumberField,
  Row,
  SectionTitle,
  StatTile,
  Tag,
} from '../components/ui';
import { formatDuration } from '../lib/format';
import { SLEEP_EDUCATION, recoveryAdvice, scoreSleep, sleepDurationMinutes } from '../lib/sleep';
import { colors, radius, space, type } from '../theme';
import { daysAgoKey, todayKey, useApp } from '../store/AppState';

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export default function SleepScreen() {
  const insets = useSafeAreaInsets();
  const { days, setSleep, unlockBadge } = useApp();
  const today = todayKey();

  const [bedTime, setBedTime] = useState('23:00');
  const [wakeTime, setWakeTime] = useState('07:00');
  const [interruptions, setInterruptions] = useState('0');
  const [remReported, setRemReported] = useState('');
  const [restingHr, setRestingHr] = useState('');
  const [hrv, setHrv] = useState('');

  const timesValid = TIME_RE.test(bedTime) && TIME_RE.test(wakeTime);
  const rawMinutes = timesValid ? sleepDurationMinutes(bedTime, wakeTime) : 0;

  const score = useMemo(() => {
    if (!timesValid) return null;
    const rem = parseInt(remReported, 10);
    // Compare against the previous night's stored times for the streak bonus.
    const prev = days[daysAgoKey(1)]?.sleep;
    return scoreSleep({
      bedTime,
      wakeTime,
      interruptions: parseInt(interruptions, 10) || 0,
      remMinutesSelfReported: isFinite(rem) && rem > 0 ? rem : undefined,
      previous: prev ? { bedTime: prev.bedTime, wakeTime: prev.wakeTime } : undefined,
      consistencyStreak: prev?.consistencyBonus,
    });
  }, [bedTime, wakeTime, interruptions, remReported, timesValid, days, today]);

  const advice = useMemo(() => {
    if (!score) return null;
    const hr = parseInt(restingHr, 10);
    const h = isFinite(hr) ? hr : undefined;
    const v = parseInt(hrv, 10);
    return recoveryAdvice(score.recoveryScore, h, isFinite(v) ? v : undefined);
  }, [score, restingHr, hrv]);

  const saved = days[today]?.sleep;

  function save() {
    if (!score) return;
    setSleep(today, score);
    if (score.consistencyBonus >= 3) {
      unlockBadge('sleep_consistency_3');
    }
    if (score.recoveryScore >= 8) {
      unlockBadge('recovery_8');
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[type.display, { color: colors.text, marginBottom: space.sm }]}>Sleep &amp; recovery</Text>
      <Text style={[type.caption, { color: colors.textDim, marginBottom: space.lg }]}>
        Three questions. VitalX turns them into a recovery score and changes your plan to match.
      </Text>

      {/* ---------------- input ---------------- */}
      <Card>
        <SectionTitle>Last night</SectionTitle>

        <Row gap={space.sm} style={{ marginBottom: space.md }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.micro, { color: colors.textFaint, marginBottom: 4 }]}>FELL ASLEEP</Text>
            <TimeField value={bedTime} onChange={setBedTime} valid={TIME_RE.test(bedTime)} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.micro, { color: colors.textFaint, marginBottom: 4 }]}>WOKE UP</Text>
            <TimeField value={wakeTime} onChange={setWakeTime} valid={TIME_RE.test(wakeTime)} />
          </View>
        </Row>

        {timesValid ? (
          <Text style={[type.caption, { color: colors.textDim, marginBottom: space.lg }]}>
            {formatDuration(rawMinutes)} in bed. VitalX removes 30 minutes for time to fall asleep, so
            it scores {formatDuration(Math.max(0, rawMinutes - 30))}.
          </Text>
        ) : (
          <Text style={[type.caption, { color: colors.danger, marginBottom: space.lg }]}>
            Use 24-hour time like 23:30.
          </Text>
        )}

        <Text style={[type.caption, { color: colors.textDim, marginBottom: space.sm }]}>
          How many times did you wake up or get interrupted?
        </Text>
        <Row gap={space.sm} style={{ marginBottom: space.sm }}>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <Button
              key={n}
              label={`${n}`}
              variant={parseInt(interruptions, 10) === n ? 'primary' : 'ghost'}
              onPress={() => setInterruptions(`${n}`)}
              style={{ flex: 1, paddingVertical: 10 }}
            />
          ))}
        </Row>

        <Divider />

        <SectionTitle hint={SLEEP_EDUCATION.rem.estimateNote}>REM sleep (optional)</SectionTitle>
        <NumberField
          value={remReported}
          onChangeText={setRemReported}
          placeholder="leave blank to estimate"
          suffix="min"
        />

        <View style={{ height: space.lg }} />
        <SectionTitle hint="Optional. Leave blank if you have no wearable.">Recovery extras</SectionTitle>
        <Row gap={space.sm}>
          <View style={{ flex: 1 }}>
            <NumberField value={restingHr} onChangeText={setRestingHr} placeholder="58" suffix="bpm" keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <NumberField value={hrv} onChangeText={setHrv} placeholder="65" suffix="ms" keyboardType="number-pad" />
          </View>
        </Row>

        <View style={{ height: space.lg }} />
        <Button label="Score my night" onPress={save} disabled={!score} />
      </Card>

      {/* ---------------- result ---------------- */}
      {score ? (
        <>
          <Card style={{ marginTop: space.lg }}>
            <SectionTitle>Recovery</SectionTitle>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <Text style={[type.display, { fontSize: 48, color: scoreColor(score.recoveryScore) }]}>
                {score.recoveryScore.toFixed(1)}
              </Text>
              <Tag
                text={score.consistencyBonus > 0 ? `streak +${score.consistencyBonus}` : 'no streak'}
                tone={score.consistencyBonus > 0 ? 'accent' : 'default'}
              />
            </Row>
            <View style={{ height: space.md }} />
            <Divider />
            <Row>
              <StatTile label="Duration" value={`${score.durationScore}/10`} sub={formatDuration(Math.round(score.adjustedDurationH * 60))} />
              <StatTile label="Interruptions" value={`${score.interruptionScore}/10`} sub={`${score.interruptions} wake-ups`} />
              <StatTile
                label="REM"
                value={`${score.remScore}/10`}
                sub={score.remIsEstimated ? 'estimated' : 'self-reported'}
                tint={score.remIsEstimated ? colors.textDim : colors.accent}
              />
            </Row>
          </Card>

          {advice ? (
            <View style={{ marginTop: space.lg }}>
              <Banner
                tone={advice.action === 'rest_day' ? 'danger' : advice.action === 'normal' ? 'info' : 'warning'}
                title={advice.headline}
                body={advice.body}
              />
            </View>
          ) : null}

          <Card style={{ marginTop: space.lg }}>
            <SectionTitle>About REM sleep</SectionTitle>
            <Text style={[type.caption, { color: colors.textDim, lineHeight: 19 }]}>
              {SLEEP_EDUCATION.rem.body}
            </Text>
            <View style={{ height: space.md }} />
            <Text style={[type.caption, { color: colors.textFaint, lineHeight: 18 }]}>
              {SLEEP_EDUCATION.rem.estimateNote}
            </Text>
          </Card>

          <Card style={{ marginTop: space.lg }}>
            <SectionTitle>Why the clock matters</SectionTitle>
            <Text style={[type.caption, { color: colors.textDim, lineHeight: 19 }]}>
              {SLEEP_EDUCATION.consistency.body}
            </Text>
            {score.consistencyBonus >= 3 ? (
              <>
                <View style={{ height: space.md }} />
                <Tag text="Badge earned: consistent clock" tone="accent" />
              </>
            ) : null}
          </Card>
        </>
      ) : null}

      {saved && !score ? (
        <Text style={[type.caption, { color: colors.textFaint, marginTop: space.lg, textAlign: 'center' }]}>
          Saved for today. Change the times above to re-score.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function scoreColor(score: number) {
  if (score >= 8) return colors.accent;
  if (score >= 6.5) return colors.info;
  if (score >= 4) return colors.warning;
  return colors.danger;
}

function TimeField({
  value,
  onChange,
  valid,
}: {
  value: string;
  onChange: (v: string) => void;
  valid: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.surfaceAlt,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: valid ? colors.border : colors.danger,
        paddingHorizontal: space.md,
      }}
    >
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="23:00"
        placeholderTextColor={colors.textFaint}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        style={{ color: colors.text, fontSize: 16, paddingVertical: 12 }}
      />
    </View>
  );
}
