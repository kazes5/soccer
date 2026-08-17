import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { nativeSpacing, statusToneColors, typeScale } from '@soccer/ui-tokens/native';
import { LanguageToggle } from '@/components/language-toggle';
import { useLocale } from '@/components/locale-provider';

/**
 * Checkpoint 2 placeholder: renders through the real `LocaleProvider`
 * context (persisted locale, RTL flip + restart on toggle) instead of a
 * hardcoded `defaultLocale`. Real screens (Home/Schedule/claim-release-swap)
 * are Checkpoint 4; auth is Checkpoint 3.
 */
function fontWeightStyle(weight: number): TextStyle['fontWeight'] {
  return String(weight) as TextStyle['fontWeight'];
}

export default function HomePlaceholder() {
  const { t } = useLocale();
  const openStatus = statusToneColors('open');

  return (
    <View style={styles.container}>
      <LanguageToggle />
      <Text style={styles.title}>{t('common.appName')}</Text>
      <View
        style={[
          styles.badge,
          { backgroundColor: openStatus.background, borderColor: openStatus.border },
        ]}
      >
        <Text style={[styles.badgeText, { color: openStatus.onBackground }]}>
          Stage 8 · Checkpoint 2 scaffold
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: nativeSpacing(4),
    padding: nativeSpacing(6),
  },
  title: {
    fontSize: typeScale.headline.fontSizePx,
    lineHeight: typeScale.headline.lineHeightPx,
    fontWeight: fontWeightStyle(typeScale.headline.fontWeight),
  },
  badge: {
    borderWidth: 1,
    borderRadius: nativeSpacing(2),
    paddingVertical: nativeSpacing(2),
    paddingHorizontal: nativeSpacing(3),
  },
  badgeText: {
    fontSize: typeScale.label.fontSizePx,
    lineHeight: typeScale.label.lineHeightPx,
    fontWeight: fontWeightStyle(typeScale.label.fontWeight),
  },
});
