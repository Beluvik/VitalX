import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Button, Card, Field, MiniButton, NumberField, Row } from '../../components/ui';
import { manualToLogged } from '../../lib/mealLog';
import { uid } from '../../store/trainingReducer';
import type { LoggedFood } from '../../types';
import { colors, radius, space, type } from '../../theme';

/** Type in what you ate. The numbers are for the amount eaten, not per 100 g. */
export default function ManualFood({
  onAdd,
  onBack,
}: {
  onAdd: (f: LoggedFood) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [grams, setGrams] = useState('');

  const entry = manualToLogged(
    {
      name,
      kcal: parseFloat(kcal),
      protein: parseFloat(protein),
      carbs: parseFloat(carbs),
      fat: parseFloat(fat),
      grams: parseFloat(grams),
    },
    uid('lf'),
    Date.now()
  );

  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <Text style={[type.title, { color: colors.text }]}>Enter manually</Text>
        <MiniButton label="Back" onPress={onBack} />
      </Row>

      <Card>
        <Field label="What did you eat?">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Homemade dal"
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
            }}
          />
        </Field>

        <Text style={[type.caption, { color: colors.textDim, marginBottom: space.md }]}>
          Enter the numbers for the amount you ate, not per 100 g.
        </Text>

        <Field label="Calories">
          <NumberField value={kcal} onChangeText={setKcal} placeholder="250" suffix="kcal" />
        </Field>
        <Row gap={space.sm}>
          <View style={{ flex: 1 }}>
            <Field label="Protein">
              <NumberField value={protein} onChangeText={setProtein} placeholder="0" suffix="g" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Carbs">
              <NumberField value={carbs} onChangeText={setCarbs} placeholder="0" suffix="g" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Fat">
              <NumberField value={fat} onChangeText={setFat} placeholder="0" suffix="g" />
            </Field>
          </View>
        </Row>
        <Field label="Amount eaten (optional)">
          <NumberField value={grams} onChangeText={setGrams} placeholder="0" suffix="grams" />
        </Field>

        <Button label="Add to today" onPress={() => entry && onAdd(entry)} disabled={!entry} />
      </Card>
    </View>
  );
}
