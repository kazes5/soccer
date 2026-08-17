import { defaultLocale, translate, type Locale, type MessageKey } from '@soccer/i18n';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert, I18nManager } from 'react-native';
import * as Updates from 'expo-updates';
import { readPersistedLocale, writePersistedLocale } from '@/lib/locale-storage';
import { applyLocaleDirection } from '@/lib/rtl-restart';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  children,
  onReady,
}: {
  children: ReactNode;
  /** Fires once the persisted locale has loaded from `AsyncStorage`. Unlike
   * web (`layout.tsx` resolves the locale server-side before the first
   * paint), there's nothing to seed an initial value from here — the root
   * layout uses this to hold the native splash screen up until then, so
   * the first frame doesn't flash the wrong locale/direction. */
  onReady?: () => void;
}) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    let cancelled = false;
    readPersistedLocale().then((persisted) => {
      if (cancelled) return;
      if (persisted) setLocaleState(persisted);
      onReady?.();
    });
    return () => {
      cancelled = true;
    };
    // Intentionally run once — `onReady` is expected to be referentially
    // stable for the life of the provider (see RootLayout), and re-running
    // this on every render would re-flash the splash screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    void writePersistedLocale(next);
    void applyLocaleDirection(next, { i18nManager: I18nManager, updates: Updates }).then(
      (result) => {
        // A successful reload destroys and restarts the JS context, so there's
        // nothing left to do here in that path — only the failure-to-restart
        // case needs a prompt telling the user to do it themselves.
        if (result.changed && !result.restarted) {
          Alert.alert(
            translate(next, 'common.restartRequiredTitle'),
            translate(next, 'common.restartRequiredBody'),
          );
        }
      },
    );
  }, []);

  const t = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}
