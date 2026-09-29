import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { Banner, Button, Card, MiniButton, Row } from '../../components/ui';
import { lookupBarcodeVia } from '../../lib/api';
import type { FoodCandidate } from '../../lib/foodApi';
import type { FoodSettings } from '../../store/foodSettings';
import { colors, radius, space, type } from '../../theme';

/**
 * Scan a barcode, look it up in Open Food Facts, hand the food back.
 * A typed-barcode box sits below the camera, so this still works when the
 * camera does not (or when demoing on a screen).
 */
export default function ScanBarcode({
  settings,
  onFound,
  onBack,
  onManual,
  onLabel,
}: {
  settings: FoodSettings;
  onFound: (c: FoodCandidate) => void;
  onBack: () => void;
  onManual: () => void;
  onLabel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);

  async function lookup(code: string) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setNotFound(null);
    try {
      const found = await lookupBarcodeVia(settings, code);
      if (found) {
        onFound(found);
        return;
      }
      setNotFound(code);
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      setProblem(
        msg.includes('rate') || msg.includes('busy')
          ? 'The database is busy. Try again in a moment.'
          : msg && !msg.includes('http') && msg.length < 140
          ? msg
          : 'Could not reach the food database. Check your internet connection.'
      );
    } finally {
      setBusy(false);
      // Let the camera read again after a miss.
      setLocked(false);
    }
  }

  const granted = !!permission?.granted;

  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <Text style={[type.title, { color: colors.text }]}>Scan a barcode</Text>
        <MiniButton label="Back" onPress={onBack} />
      </Row>

      {!permission ? (
        <Text style={[type.caption, { color: colors.textDim }]}>Checking camera access...</Text>
      ) : !granted ? (
        <Card>
          <Text style={[type.body, { color: colors.text, marginBottom: space.md }]}>
            VitalX needs the camera to read barcodes. Photos are not saved.
          </Text>
          <Button label="Allow camera" onPress={() => requestPermission()} />
        </Card>
      ) : (
        <View style={{ height: 300, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }}
            onBarcodeScanned={
              locked || busy
                ? undefined
                : (r: { data: string }) => {
                    setLocked(true);
                    lookup(r.data);
                  }
            }
          />
        </View>
      )}

      <Text style={[type.caption, { color: colors.textDim, marginTop: space.md }]}>
        {busy ? 'Looking it up...' : 'Point the camera at the barcode on the pack.'}
      </Text>

      {problem ? (
        <View style={{ marginTop: space.md }}>
          <Banner tone="warning" title="Could not look that up" body={problem} />
        </View>
      ) : null}

      {notFound ? (
        <View style={{ marginTop: space.md }}>
          <Banner
            tone="info"
            title="This product is not in the database"
            body={`Barcode ${notFound} has no nutrition data. Scan its nutrition label instead, or type the numbers in.`}
          />
          <Row gap={space.sm} style={{ marginTop: space.sm }}>
            <MiniButton label="Scan the label" tone="accent" onPress={onLabel} />
            <MiniButton label="Enter manually" onPress={onManual} />
          </Row>
        </View>
      ) : null}

      <Text style={[type.micro, { color: colors.textFaint, marginTop: space.lg, marginBottom: 6 }]}>
        Or type the barcode number
      </Text>
      <Row gap={space.sm}>
        <TextInput
          value={typed}
          onChangeText={(t: string) => setTyped(t.replace(/[^0-9]/g, ''))}
          placeholder="8901058000019"
          placeholderTextColor={colors.textFaint}
          keyboardType="number-pad"
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
        <MiniButton label="Look up" tone="accent" onPress={() => typed.length >= 6 && lookup(typed)} />
      </Row>
    </View>
  );
}
