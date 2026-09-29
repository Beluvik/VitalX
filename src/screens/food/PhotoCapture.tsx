import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { Banner, Button, Card, MiniButton, Row } from '../../components/ui';
import { photoAvailable, readFoodPhoto, readLabelPhoto } from '../../lib/api';
import type { LabelReading, PhotoFood } from '../../lib/vision';
import type { FoodSettings } from '../../store/foodSettings';
import { colors, radius, space, type } from '../../theme';

/**
 * Take a photo of either a plate of food or a nutrition label, and have it
 * read. Needs the user's photo-service key (Setup); without one it explains
 * how to get one and offers manual entry, so it never dead-ends.
 */
export default function PhotoCapture({
  kind,
  settings,
  onFoods,
  onLabel,
  onBack,
  onManual,
  onSetup,
}: {
  kind: 'food' | 'label';
  settings: FoodSettings;
  onFoods: (items: PhotoFood[]) => void;
  onLabel: (reading: LabelReading) => void;
  onBack: () => void;
  onManual: () => void;
  onSetup: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const ready = photoAvailable(settings);
  const granted = !!permission?.granted;
  const title = kind === 'food' ? 'Photo of your food' : 'Scan a nutrition label';

  async function snap() {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    setProblem(null);
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: true });
      if (!pic?.base64) throw new Error('The camera did not return a picture. Try again.');

      if (kind === 'food') {
        const items = await readFoodPhoto(settings, pic.base64);
        if (items.length === 0) {
          setProblem('No food was recognised in that photo. Try again in better light, or enter it manually.');
          return;
        }
        onFoods(items);
      } else {
        const reading = await readLabelPhoto(settings, pic.base64);
        if (!reading) {
          setProblem('The calories on the label could not be read. Fill the frame with the label and hold steady, or enter it manually.');
          return;
        }
        onLabel(reading);
      }
    } catch (e: any) {
      setProblem(String(e?.message ?? 'Something went wrong reading that photo.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
        <Text style={[type.title, { color: colors.text }]}>{title}</Text>
        <MiniButton label="Back" onPress={onBack} />
      </Row>

      {!ready ? (
        <Card>
          <Text style={[type.bodyStrong, { color: colors.text }]}>Photo reading is not set up yet</Text>
          <Text style={[type.caption, { color: colors.textDim, marginTop: 6, lineHeight: 19 }]}>
            Reading photos needs either the VitalX server address or your own free key from an image-capable AI service.
            Add one in Setup, once. Until then, search, barcodes and typing foods in all work without it.
          </Text>
          <View style={{ height: space.md }} />
          <Button label="Open Setup" onPress={onSetup} />
          <View style={{ height: space.sm }} />
          <Button label="Enter manually instead" variant="ghost" onPress={onManual} />
        </Card>
      ) : !permission ? (
        <Text style={[type.caption, { color: colors.textDim }]}>Checking camera access...</Text>
      ) : !granted ? (
        <Card>
          <Text style={[type.body, { color: colors.text, marginBottom: space.md }]}>
            VitalX needs the camera to take the photo. It is sent to your photo service to be read and is not saved.
          </Text>
          <Button label="Allow camera" onPress={() => requestPermission()} />
        </Card>
      ) : (
        <>
          <View style={{ height: 340, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' }}>
            <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
          </View>
          <Text style={[type.caption, { color: colors.textDim, marginTop: space.md, lineHeight: 19 }]}>
            {kind === 'food'
              ? 'Put the food in the middle of the frame. You can correct the amounts before anything is added.'
              : 'Fill the frame with the nutrition table, flat and well lit. You confirm the numbers before they are added.'}
          </Text>
          <View style={{ height: space.md }} />
          <Button label={busy ? 'Reading photo...' : 'Take photo'} onPress={snap} disabled={busy} />
        </>
      )}

      {problem ? (
        <View style={{ marginTop: space.md }}>
          <Banner tone="warning" title="That did not work" body={problem} />
          <Row gap={space.sm}>
            <MiniButton label="Enter manually" onPress={onManual} />
            <MiniButton label="Setup" onPress={onSetup} />
          </Row>
        </View>
      ) : null}
    </View>
  );
}

