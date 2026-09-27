import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { card, colors, radius, space, type } from '../theme';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[card, style]}>{children}</View>;
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={[type.micro, { color: colors.textFaint, textTransform: 'uppercase' }]}>
        {children}
      </Text>
      {hint ? <Text style={[type.caption, { color: colors.textDim, marginTop: 2 }]}>{hint}</Text> : null}
    </View>
  );
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.borderSoft, marginVertical: space.lg }} />;
}

export function Row({ children, style, gap = space.sm }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg =
    variant === 'primary' ? colors.accent : variant === 'danger' ? colors.dangerSoft : 'transparent';
  const fg = variant === 'primary' ? colors.accentText : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radius.md,
          paddingVertical: 15,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
        variant === 'ghost' && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}
    >
      <Text style={[type.bodyStrong, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** Small inline button for list rows. */
export function MiniButton({ label, onPress, tone = 'default' }: { label: string; onPress: () => void; tone?: 'default' | 'danger' | 'accent' }) {
  const color = tone === 'danger' ? colors.danger : tone === 'accent' ? colors.accent : colors.textDim;
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <Text style={[type.caption, { color }]}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function NumberField({
  value,
  onChangeText,
  placeholder,
  suffix,
  keyboardType = 'decimal-pad',
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  keyboardType?: 'decimal-pad' | 'number-pad';
}) {
  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surfaceAlt,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: space.md,
      }}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType}
        style={[{ flex: 1, color: colors.text, fontSize: 16, paddingVertical: 12 }, type.body]}
      />
      {suffix ? <Text style={[type.caption, { color: colors.textFaint }]}>{suffix}</Text> : null}
    </View>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={[type.caption, { color: colors.textDim, marginBottom: hint ? 2 : space.sm }]}>{label}</Text>
      {hint ? (
        <Text style={[type.micro, { color: colors.textFaint, marginBottom: space.sm }]}>{hint}</Text>
      ) : null}
      {children}
    </View>
  );
}

/** Single-select pill row. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surfaceAlt,
        borderRadius: radius.md,
        padding: 3,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              paddingVertical: 9,
              borderRadius: radius.sm,
              alignItems: 'center',
              backgroundColor: active ? colors.accent : 'transparent',
            }}
          >
            <Text
              numberOfLines={1}
              style={[type.caption, { color: active ? colors.accentText : colors.textDim, fontWeight: '600' }]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Selectable card with a title and a description. */
export function ChoiceCard({
  title,
  blurb,
  selected,
  onPress,
  badge,
}: {
  title: string;
  blurb?: string;
  selected: boolean;
  onPress: () => void;
  badge?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: selected ? colors.accentSoft : colors.surfaceAlt,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: selected ? colors.accent : colors.border,
          padding: space.lg,
          marginBottom: space.sm,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={[type.bodyStrong, { color: selected ? colors.accent : colors.text, flex: 1 }]}>
          {title}
        </Text>
        {badge ? <Tag text={badge} tone="accent" /> : null}
      </Row>
      {blurb ? (
        <Text style={[type.caption, { color: colors.textDim, marginTop: 4, lineHeight: 18 }]}>{blurb}</Text>
      ) : null}
    </Pressable>
  );
}

export function Tag({ text, tone = 'default' }: { text: string; tone?: 'default' | 'accent' | 'warning' | 'danger' | 'info' }) {
  const map = {
    default: { bg: colors.surfaceHigh, fg: colors.textDim },
    accent: { bg: colors.accentSoft, fg: colors.accent },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    info: { bg: colors.infoSoft, fg: colors.info },
  } as const;
  const c = map[tone];
  return (
    <View style={{ backgroundColor: c.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill }}>
      <Text style={[type.micro, { color: c.fg }]}>{text.toUpperCase()}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Data display
// ---------------------------------------------------------------------------

export function ProgressBar({
  value,
  tint = colors.accent,
  track = colors.surfaceHigh,
  height = 8,
}: {
  /** 0-1, may exceed 1 and will be clamped visually. */
  value: number;
  tint?: string;
  track?: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={{ height, backgroundColor: track, borderRadius: radius.pill, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: tint }} />
    </View>
  );
}

/**
 * Macro split bar. Segments are proportional to grams, each capped so a
 * single dominant macro cannot hide the others.
 */
export function MacroBar({ protein, carbs, fat, height = 10 }: { protein: number; carbs: number; fat: number; height?: number }) {
  const p = Math.max(0, protein);
  const c = Math.max(0, carbs);
  const f = Math.max(0, fat);
  const total = p + c + f;
  if (total <= 0) {
    return <View style={{ height, backgroundColor: colors.surfaceHigh, borderRadius: radius.pill }} />;
  }
  return (
    <View style={{ flexDirection: 'row', height, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceHigh }}>
      <View style={{ flex: p, backgroundColor: colors.protein }} />
      <View style={{ flex: c, backgroundColor: colors.carbs }} />
      <View style={{ flex: f, backgroundColor: colors.fat }} />
    </View>
  );
}

export function StatTile({ label, value, sub, tint = colors.text }: { label: string; value: string; sub?: string; tint?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[type.micro, { color: colors.textFaint, textTransform: 'uppercase' }]}>{label}</Text>
      <Text style={[type.title, { color: tint, marginTop: 2 }]}>{value}</Text>
      {sub ? <Text style={[type.caption, { color: colors.textDim }]}>{sub}</Text> : null}
    </View>
  );
}

export function Banner({ tone, title, body }: { tone: 'info' | 'warning' | 'danger'; title: string; body: string }) {
  const map = {
    info: { bg: colors.infoSoft, fg: colors.info },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
  } as const;
  const c = map[tone];
  return (
    <View
      style={{
        backgroundColor: c.bg,
        borderLeftWidth: 3,
        borderLeftColor: c.fg,
        borderRadius: radius.sm,
        padding: space.md,
        marginBottom: space.sm,
      }}
    >
      <Text style={[type.bodyStrong, { color: c.fg }]}>{title}</Text>
      <Text style={[type.caption, { color: colors.text, marginTop: 3, lineHeight: 18 }]}>{body}</Text>
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg }}>
      <Text style={[type.heading, { color: colors.textDim, textAlign: 'center' }]}>{title}</Text>
      <Text style={[type.caption, { color: colors.textFaint, textAlign: 'center', marginTop: 6, lineHeight: 19 }]}>
        {body}
      </Text>
      {action ? <View style={{ marginTop: space.lg }}>{action}</View> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ padding: space.xxl, alignItems: 'center', gap: space.md }}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Text style={[type.caption, { color: colors.textDim }]}>{label}</Text> : null}
    </View>
  );
}

/** Screen header used on every tab. */
export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginBottom: space.lg }}>
      <View style={{ flex: 1 }}>
        <Text style={[type.display, { color: colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[type.caption, { color: colors.textDim, marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </Row>
  );
}

export const s = StyleSheet.create({
  flex: { flex: 1 },
  textCenter: { textAlign: 'center' as TextStyle['textAlign'] },
});
