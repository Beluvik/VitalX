import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Banner, Button, Card, NumberField, Row, SectionTitle, Tag } from '../../components/ui';
import { FoodCandidate, SOURCE_LABEL } from '../../lib/foodApi';
import { macrosFor } from '../../lib/mealLog';
import { colors, radius, space, type } from '../../theme';

/** Choose how much you ate of a food, see the numbers, add it. */
export default function ConfirmFood({
  candidate,
  note,
  onAdd,
  onBack,
}: {
  candidate: FoodCandidate;
  /** Extra explanation, e.g. how a label was converted. */
  note?: string;
  onAdd: (grams: number) => void;
  onBack: () => void;
}) {
  const [grams, setGrams] = useState(String(candidate.servingGrams ?? 100));
  const g = parseFloat(grams);
  const valid = isFinite(g) && g > 0;
  const m = useMemo(() => macrosFor(candidate, valid ? g : 0), [candidate, g, valid]);

  const portions = [50, 100, 150, 200];

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: space.sm }}>
          <SectionTitle>{candidate.name}</SectionTitle>
        </View>
        <Tag text={SOURCE_LABEL[candidate.source]} />
      </Row>

      <Text style={[type.caption, { color: colors.textDim, marginBottom: space.md }]}>
        per 100 g: {Math.round(candidate.kcalPer100)} kcal · P {candidate.proteinPer100} g · C {candidate.carbsPer100} g · F{' '}
        {candidate.fatPer100} g
      </Text>

      {note ? <Banner tone="info" title={note} body="" /> : null}

      <Row gap={space.sm} style={{ marginBottom: space.md, flexWrap: 'wrap' }}>
        {candidate.servingGrams ? (
          <Pill
            label={`1 serving (${Math.round(candidate.servingGrams)} g)`}
            active={g === candidate.servingGrams}
            onPress={() => setGrams(String(candidate.servingGrams))}
          />
        ) : null}
        {portions.map((p) => (
          <Pill key={p} label={`${p} g`} active={g === p} onPress={() => setGrams(String(p))} />
        ))}
      </Row>

      <Row gap={space.sm} style={{ marginBottom: space.lg }}>
        <NumberField value={grams} onChangeText={setGrams} placeholder="100" suffix="grams" />
      </Row>

      {valid ? (
        <View style={{ marginBottom: space.lg }}>
          <Text style={[type.caption, { color: colors.textDim, marginBottom: space.sm }]}>Adding</Text>
          <Text style={[type.title, { color: colors.accent }]}>{m.kcal} kcal</Text>
          <Text style={[type.caption, { color: colors.textDim, marginTop: 2 }]}>
            P {m.protein} g · C {m.carbs} g · F {m.fat} g
          </Text>
        </View>
      ) : null}

      <Button label="Add to today" onPress={() => onAdd(g)} disabled={!valid} />
      <View style={{ height: space.sm }} />
      <Button label="Cancel" variant="ghost" onPress={onBack} />
    </Card>
  );
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: space.md,
        paddingVertical: 8,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.border,
        backgroundColor: active ? colors.accentSoft : 'transparent',
      }}
    >
      <Text style={[type.caption, { color: active ? colors.accent : colors.textDim }]}>{label}</Text>
    </Pressable>
  );
}

