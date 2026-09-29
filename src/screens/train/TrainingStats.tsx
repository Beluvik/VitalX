import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, MiniButton, Row, SectionTitle, Segmented } from '../../components/ui';
import {
  BodyRegion,
  REGION_ORDER,
  calendarRange,
  localDateKey,
  normalizedDistribution,
  rawDistribution,
  sessionCounts,
  trainingDays,
} from '../../lib/trainingStats';
import { useApp } from '../../store/AppState';
import { colors, radius, space, type } from '../../theme';
import type { TrainGo } from '../TrainScreen';

type Window = 7 | 30 | 90;
const WINDOWS: { value: Window; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

export default function TrainingStats({ go }: { go: TrainGo }) {
  const insets = useSafeAreaInsets();
  const { workouts, getExercise } = useApp();
  const [windowDays, setWindowDays] = useState<Window>(30);

  const now = Date.now();

  const counts = useMemo(() => sessionCounts(workouts, now), [workouts, now]);

  const current = useMemo(() => {
    const raw = rawDistribution(workouts, getExercise, { from: now - windowDays * 86_400_000, to: now });
    return normalizedDistribution(raw);
  }, [workouts, getExercise, windowDays, now]);

  const previous = useMemo(() => {
    const raw = rawDistribution(workouts, getExercise, {
      from: now - 2 * windowDays * 86_400_000,
      to: now - windowDays * 86_400_000,
    });
    return normalizedDistribution(raw);
  }, [workouts, getExercise, windowDays, now]);

  const trainedDates = useMemo(() => trainingDays(workouts), [workouts]);
  const days = useMemo(() => calendarRange(now, 84), [now]); // 12 weeks
  const todayKey = localDateKey(now);

  const anyHistory = workouts.some((w) => w.endedAt !== null);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingTop: space.lg + insets.top, paddingBottom: insets.bottom + space.xxl }}
    >
      <Row style={{ justifyContent: 'space-between', marginBottom: space.lg }}>
        <Text style={[type.display, { color: colors.text }]}>Your training</Text>
        <MiniButton label="Back" onPress={() => go('hub')} />
      </Row>

      {/* session counts */}
      <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.lg }}>
        <CountCard label="This week" value={counts.week} />
        <CountCard label="This month" value={counts.month} />
        <CountCard label="Lifetime" value={counts.lifetime} />
      </View>

      {/* radar */}
      <SectionTitle>Muscle distribution</SectionTitle>
      <Card style={{ marginBottom: space.lg, alignItems: 'center' }}>
        {anyHistory ? (
          <>
            <Segmented
              options={WINDOWS.map((w) => ({ value: String(w.value), label: w.label }))}
              value={String(windowDays)}
              onChange={(v) => setWindowDays(Number(v) as Window)}
            />
            <View style={{ height: space.md }} />
            <Radar current={current} previous={previous} />
            <Row gap={space.lg} style={{ marginTop: space.sm }}>
              <Legend color={colors.accent} label="Current" />
              <Legend color={colors.textFaint} label="Previous" />
            </Row>
          </>
        ) : (
          <Text style={[type.caption, { color: colors.textFaint, paddingVertical: space.xl }]}>
            Finish a workout to see how your training spreads across your body.
          </Text>
        )}
      </Card>

      {/* calendar */}
      <SectionTitle>Training days</SectionTitle>
      <Card>
        <Calendar days={days} trainedDates={trainedDates} todayKey={todayKey} />
        <Row gap={space.sm} style={{ marginTop: space.md, alignItems: 'center' }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: colors.accent }} />
          <Text style={[type.caption, { color: colors.textFaint }]}>Trained</Text>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: colors.surfaceAlt, marginLeft: space.md }} />
          <Text style={[type.caption, { color: colors.textFaint }]}>Rest day</Text>
        </Row>
      </Card>
    </ScrollView>
  );
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <Card style={{ flex: 1, alignItems: 'center', paddingVertical: space.md }}>
      <Text style={[type.title, { color: colors.text }]}>{value}</Text>
      <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]}>{label}</Text>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Row gap={6} style={{ alignItems: 'center' }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={[type.caption, { color: colors.textDim }]}>{label}</Text>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Radar
// ---------------------------------------------------------------------------

const SIZE = 260;
const CENTER = SIZE / 2;
const MAX_R = SIZE / 2 - 44;
const RINGS = 4;

function point(index: number, valuePct: number): { x: number; y: number } {
  const angle = (Math.PI * 2 * index) / REGION_ORDER.length - Math.PI / 2;
  const r = (Math.max(0, Math.min(100, valuePct)) / 100) * MAX_R;
  return { x: CENTER + r * Math.cos(angle), y: CENTER + r * Math.sin(angle) };
}

function polygonPoints(dist: Record<BodyRegion, number>): string {
  return REGION_ORDER.map((r, i) => {
    const p = point(i, dist[r]);
    return `${p.x},${p.y}`;
  }).join(' ');
}

function Radar({ current, previous }: { current: Record<BodyRegion, number>; previous: Record<BodyRegion, number> }) {
  const rings = Array.from({ length: RINGS }, (_, i) => ((i + 1) / RINGS) * MAX_R);
  const hasPrevious = REGION_ORDER.some((r) => previous[r] > 0);

  return (
    <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      {rings.map((r, i) => (
        <Polygon
          key={i}
          points={REGION_ORDER.map((_, idx) => {
            const angle = (Math.PI * 2 * idx) / REGION_ORDER.length - Math.PI / 2;
            return `${CENTER + r * Math.cos(angle)},${CENTER + r * Math.sin(angle)}`;
          }).join(' ')}
          fill="none"
          stroke={colors.borderSoft}
          strokeWidth={1}
        />
      ))}
      {REGION_ORDER.map((_, i) => {
        const p = point(i, 100);
        return <Line key={i} x1={CENTER} y1={CENTER} x2={p.x} y2={p.y} stroke={colors.borderSoft} strokeWidth={1} />;
      })}

      {hasPrevious ? (
        <Polygon points={polygonPoints(previous)} fill={colors.textFaint} fillOpacity={0.12} stroke={colors.textFaint} strokeWidth={1.5} />
      ) : null}
      <Polygon points={polygonPoints(current)} fill={colors.accent} fillOpacity={0.28} stroke={colors.accent} strokeWidth={2} />
      {REGION_ORDER.map((r, i) => {
        const p = point(i, current[r]);
        return <Circle key={r} cx={p.x} cy={p.y} r={3.5} fill={colors.accent} />;
      })}

      {REGION_ORDER.map((r, i) => {
        const p = point(i, 122);
        return (
          <SvgText key={r} x={p.x} y={p.y} fill={colors.textDim} fontSize={12} textAnchor="middle" alignmentBaseline="middle">
            {r}
          </SvgText>
        );
      })}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

function Calendar({ days, trainedDates, todayKey }: { days: string[]; trainedDates: Set<string>; todayKey: string }) {
  // Pad to a full number of weeks so the grid lines up under Mon..Sun.
  const first = new Date(`${days[0]}T00:00:00`);
  const leadIn = (first.getDay() + 6) % 7; // days since Monday
  const cells: (string | null)[] = [...Array(leadIn).fill(null), ...days];

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <View>
      <Row gap={4} style={{ marginBottom: 6 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} style={[type.micro, { color: colors.textFaint, width: 24, textAlign: 'center' }]}>
            {d}
          </Text>
        ))}
      </Row>
      {weeks.map((week, wi) => (
        <Row key={wi} gap={4} style={{ marginBottom: 4 }}>
          {week.map((d, di) => {
            if (!d) return <View key={di} style={{ width: 24, height: 24 }} />;
            const trained = trainedDates.has(d);
            return (
              <View
                key={di}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: radius.sm,
                  backgroundColor: trained ? colors.accent : colors.surfaceAlt,
                  borderWidth: d === todayKey ? 1.5 : 0,
                  borderColor: colors.text,
                }}
              />
            );
          })}
        </Row>
      ))}
    </View>
  );
}
