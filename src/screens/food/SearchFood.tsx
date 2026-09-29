import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Banner, Card, EmptyState, MiniButton, Row, Tag } from '../../components/ui';
import { searchFoodsVia } from '../../lib/api';
import { FoodCandidate, SOURCE_LABEL } from '../../lib/foodApi';
import type { FoodSettings } from '../../store/foodSettings';
import { colors, radius, space, type } from '../../theme';

/** Search the food databases. Nothing is listed until the user searches. */
export default function SearchFood({
  settings,
  onPick,
  onBack,
  onManual,
}: {
  settings: FoodSettings;
  onPick: (c: FoodCandidate) => void;
  onBack: () => void;
  onManual: () => void;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<FoodCandidate[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [searched, setSearched] = useState(false);

  async function run() {
    if (!query.trim() || busy) return;
    setBusy(true);
    setNotes([]);
    try {
      const out = await searchFoodsVia(settings, query, 10);
      setResults(out.results);
      setNotes(out.notes);
    } catch {
      setResults([]);
      setNotes(['Something went wrong searching. Try again.']);
    } finally {
      setSearched(true);
      setBusy(false);
    }
  }

  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <Text style={[type.title, { color: colors.text }]}>Search foods</Text>
        <MiniButton label="Back" onPress={onBack} />
      </Row>

      <Row gap={space.sm}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={run}
          returnKeyType="search"
          autoFocus
          placeholder="e.g. paneer, banana, oats"
          placeholderTextColor={colors.textFaint}
          style={{
            flex: 1,
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
        <MiniButton label={busy ? '...' : 'Search'} tone="accent" onPress={run} />
      </Row>
      <Text style={[type.micro, { color: colors.textFaint, marginTop: 6, marginBottom: space.md }]}>
        Results come from the USDA database and Open Food Facts. Values are per 100 g.
      </Text>

      {notes.map((n) => (
        <Banner key={n} tone="warning" title={n} body="" />
      ))}

      {busy ? (
        <Text style={[type.caption, { color: colors.textDim }]}>Searching...</Text>
      ) : searched && results.length === 0 ? (
        <EmptyState
          title="No matches"
          body="Try a simpler word, or type the food and its nutrition in yourself."
          action={<MiniButton label="Enter manually" tone="accent" onPress={onManual} />}
        />
      ) : (
        results.map((f) => (
          <Pressable key={f.id} onPress={() => onPick(f)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Card style={{ marginBottom: space.sm, padding: space.md }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, paddingRight: space.sm }}>
                  <Text style={[type.body, { color: colors.text }]} numberOfLines={2}>
                    {f.name}
                  </Text>
                  <Text style={[type.micro, { color: colors.textFaint, marginTop: 2 }]} numberOfLines={1}>
                    {f.brand ? `${f.brand}  ` : ''}P {f.proteinPer100} C {f.carbsPer100} F {f.fatPer100} per 100 g
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={[type.bodyStrong, { color: colors.accent }]}>{Math.round(f.kcalPer100)}</Text>
                  <Tag text={SOURCE_LABEL[f.source]} />
                </View>
              </Row>
            </Card>
          </Pressable>
        ))
      )}
    </View>
  );
}
