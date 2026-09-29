import React from 'react';
import { Text, TextInput, View } from 'react-native';

import { Card, Field, MiniButton, Row } from '../../components/ui';
import { backendReady } from '../../lib/api';
import { visionReady } from '../../lib/vision';
import { FoodSettings, toVisionConfig } from '../../store/foodSettings';
import { colors, radius, space, type } from '../../theme';

const box = {
  backgroundColor: colors.surfaceAlt,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colors.border,
  color: colors.text,
  fontSize: 15,
  paddingHorizontal: space.md,
  height: 44,
} as const;

const help = { marginTop: 4, marginBottom: space.md, lineHeight: 19 } as const;

/**
 * Where the food data and photo reading come from. With a VitalX server set,
 * nothing else is needed. The other two cards are for running without one.
 */
export default function SetupCard({
  settings,
  onChange,
  onClose,
}: {
  settings: FoodSettings;
  onChange: (patch: Partial<FoodSettings>) => void;
  onClose: () => void;
}) {
  const server = backendReady(settings);
  const ownKey = visionReady(toVisionConfig(settings));

  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <Text style={[type.title, { color: colors.text }]}>Setup</Text>
        <MiniButton label="Done" tone="accent" onPress={onClose} />
      </Row>

      <Card style={{ marginBottom: space.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={[type.bodyStrong, { color: colors.text }]}>VitalX server</Text>
          <Text style={[type.micro, { color: server ? colors.accent : colors.textFaint }]}>
            {server ? 'connected' : 'not set'}
          </Text>
        </Row>
        <Text style={[type.caption, { color: colors.textDim }, help]}>
          With a server, food search, barcodes and photo reading work without any keys on this phone. If the server is down,
          the app falls back to asking the food databases directly.
        </Text>
        <Field label="Server address">
          <TextInput
            value={settings.backendUrl}
            onChangeText={(t: string) => onChange({ backendUrl: t.trim() })}
            placeholder="https://vitalx-api.yourname.workers.dev"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={box}
          />
        </Field>
        <Field label="App token (if the server asks for one)">
          <TextInput
            value={settings.appToken}
            onChangeText={(t: string) => onChange({ appToken: t.trim() })}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={box}
          />
        </Field>
      </Card>

      <Card style={{ marginBottom: space.md }}>
        <Text style={[type.bodyStrong, { color: colors.text }]}>Without a server: food database key</Text>
        <Text style={[type.caption, { color: colors.textDim }, help]}>
          Search works out of the box on a shared demo key that runs out quickly. For steady use, get a free USDA
          FoodData Central key at fdc.nal.usda.gov (search for "API key signup"). Not needed with a server.
        </Text>
        <Field label="USDA API key (optional)">
          <TextInput
            value={settings.usdaKey}
            onChangeText={(t: string) => onChange({ usdaKey: t.trim() })}
            placeholder="Leave blank to use the demo key"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={box}
          />
        </Field>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={[type.bodyStrong, { color: colors.text }]}>Without a server: your own photo key</Text>
          <Text style={[type.micro, { color: ownKey ? colors.accent : colors.textFaint }]}>
            {ownKey ? 'ready' : 'not set up'}
          </Text>
        </Row>
        <Text style={[type.caption, { color: colors.textDim }, help]}>
          Photos are read by an AI service you choose. You need a key and the name of a model that accepts images. Google AI
          Studio offers a free key; the model name is in the provider's model list. The key stays on this phone and is sent
          only to that service. Not needed with a server.
        </Text>
        <Field label="Service address">
          <TextInput
            value={settings.visionBaseUrl}
            onChangeText={(t: string) => onChange({ visionBaseUrl: t.trim() })}
            autoCapitalize="none"
            autoCorrect={false}
            style={box}
          />
        </Field>
        <Field label="API key">
          <TextInput
            value={settings.visionKey}
            onChangeText={(t: string) => onChange({ visionKey: t.trim() })}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Paste your key"
            placeholderTextColor={colors.textFaint}
            style={box}
          />
        </Field>
        <Field label="Model name">
          <TextInput
            value={settings.visionModel}
            onChangeText={(t: string) => onChange({ visionModel: t.trim() })}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Copy it from the provider's list"
            placeholderTextColor={colors.textFaint}
            style={box}
          />
        </Field>
      </Card>
    </View>
  );
}
