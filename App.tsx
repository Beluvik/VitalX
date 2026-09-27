import React, { useState } from 'react';
import { Pressable, StatusBar, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Loading } from './src/components/ui';
import { colors, space, type } from './src/theme';
import { AppStateProvider, useApp } from './src/store/AppState';
import FoodLogScreen from './src/screens/FoodLogScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import PlanScreen from './src/screens/PlanScreen';
import SleepScreen from './src/screens/SleepScreen';
import TrainScreen from './src/screens/TrainScreen';

type TabKey = 'plan' | 'food' | 'train' | 'sleep';

const TABS: { key: TabKey; label: string; glyph: string }[] = [
  { key: 'plan', label: 'Plan', glyph: '◈' },
  { key: 'food', label: 'Food', glyph: '◉' },
  { key: 'train', label: 'Train', glyph: '⬢' },
  { key: 'sleep', label: 'Sleep', glyph: '☾' },
];

function Shell() {
  const { hydrated, profile } = useApp();
  const [tab, setTab] = useState<TabKey>('plan');

  if (!hydrated) return <Loading label="Loading VitalX" />;
  if (!profile) return <OnboardingScreen />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>
        {tab === 'plan' ? <PlanScreen onLogMeal={() => setTab('food')} onTrain={() => setTab('train')} /> : null}
        {tab === 'food' ? <FoodLogScreen /> : null}
        {tab === 'train' ? <TrainScreen /> : null}
        {tab === 'sleep' ? <SleepScreen /> : null}
      </View>
      <TabBar current={tab} onChange={setTab} />
    </View>
  );
}

function TabBar({ current, onChange }: { current: TabKey; onChange: (t: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.borderSoft,
        paddingTop: space.sm,
        paddingBottom: insets.bottom + space.sm,
      }}
    >
      {TABS.map((t) => {
        const active = t.key === current;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 4, gap: 2 }}
          >
            <Text style={{ fontSize: 18, color: active ? colors.accent : colors.textFaint }}>{t.glyph}</Text>
            <Text style={[type.micro, { color: active ? colors.accent : colors.textFaint }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <AppStateProvider>
        <Shell />
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
