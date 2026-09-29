import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BACKEND_TOKEN, BACKEND_URL } from '../config';
import type { VisionConfig } from '../lib/vision';
import { uid } from './trainingReducer';

/**
 * Keys and endpoints for the food databases and photo reading.
 *
 * Kept apart from the main app state: these are credentials the user typed,
 * they live on this phone only, and they are never uploaded anywhere but the
 * service they belong to.
 */
export interface FoodSettings {
  /** VitalX backend address. Filled from src/config.ts, and editable in Setup. */
  backendUrl: string;
  appToken: string;
  /** Random id made on first use so the server can rate-limit a phone without knowing who owns it. */
  deviceId: string;
  /** Free key from fdc.nal.usda.gov. Blank uses the shared demo key, which is heavily rate-limited. */
  usdaKey: string;
  visionBaseUrl: string;
  visionKey: string;
  visionModel: string;
}

const STORAGE_KEY = 'vitalx.foodsettings.v1';

export const DEFAULT_SETTINGS: FoodSettings = {
  backendUrl: BACKEND_URL,
  appToken: BACKEND_TOKEN,
  deviceId: '',
  usdaKey: '',
  // Google's OpenAI-compatible endpoint. Any OpenAI-compatible service that
  // accepts images works; change it in Setup.
  visionBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  visionKey: '',
  visionModel: '',
};

export function toVisionConfig(s: FoodSettings): VisionConfig {
  return { baseUrl: s.visionBaseUrl, apiKey: s.visionKey, model: s.visionModel };
}

export function useFoodSettings() {
  const [settings, setSettings] = useState<FoodSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          // An address typed in Setup wins; otherwise the one built into the app is used.
          setSettings({
            ...DEFAULT_SETTINGS,
            ...saved,
            backendUrl: saved.backendUrl || DEFAULT_SETTINGS.backendUrl,
            appToken: saved.appToken || DEFAULT_SETTINGS.appToken,
          });
        }
      } catch {
        // Unreadable settings must never stop the food log opening.
      }
      setSettings((cur) => {
        if (cur.deviceId) return cur;
        const next = { ...cur, deviceId: uid('dev') };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
        return next;
      });
      setLoaded(true);
    })();
  }, []);

  const update = useCallback((patch: Partial<FoodSettings>) => {
    setSettings((cur) => {
      const next = { ...cur, ...patch };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  return { settings, loaded, update };
}
