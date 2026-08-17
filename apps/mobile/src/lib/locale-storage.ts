import AsyncStorage from '@react-native-async-storage/async-storage';
import { isLocale, type Locale } from '@soccer/i18n';

/** Native equivalent of `apps/web/src/lib/locale-cookie.ts` — same role
 * (persist the user's chosen locale across sessions), different mechanism
 * (`AsyncStorage` instead of a cookie, since RN has no cookie jar). */
export const LOCALE_STORAGE_KEY = 'soccer.locale';

export async function readPersistedLocale(): Promise<Locale | null> {
  const value = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
  return value && isLocale(value) ? value : null;
}

export async function writePersistedLocale(locale: Locale): Promise<void> {
  await AsyncStorage.setItem(LOCALE_STORAGE_KEY, locale);
}
