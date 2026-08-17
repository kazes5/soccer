import { Pressable, StyleSheet, Text, View } from 'react-native';
import { nativeSpacing, statusToneColors, type StatusToneColors } from '@soccer/ui-tokens/native';
import { useLocale } from './locale-provider';

/** Native port of `apps/web/src/components/language-toggle.tsx` — same "EN"
 * / "עב" plain-label pattern (locale names, not translated UI copy). */
export function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const active = statusToneColors('mine');

  return (
    <View style={styles.row}>
      <LanguageButton
        label="EN"
        selected={locale === 'en'}
        tone={active}
        onPress={() => setLocale('en')}
      />
      <LanguageButton
        label="עב"
        selected={locale === 'he'}
        tone={active}
        onPress={() => setLocale('he')}
      />
    </View>
  );
}

function LanguageButton({
  label,
  selected,
  tone,
  onPress,
}: {
  label: string;
  selected: boolean;
  tone: StatusToneColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.button, selected ? { backgroundColor: tone.border } : null]}
      hitSlop={nativeSpacing(2)}
    >
      <Text style={[styles.label, selected ? { color: tone.onBackground } : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: nativeSpacing(1),
  },
  button: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
});
