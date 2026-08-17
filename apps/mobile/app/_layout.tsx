import { useCallback, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { LocaleProvider } from '@/components/locale-provider';

SplashScreen.preventAutoHideAsync().catch(() => {
  // No-op if already hidden/unsupported — never block startup on this.
});

export default function RootLayout() {
  const [localeReady, setLocaleReady] = useState(false);

  const handleLocaleReady = useCallback(() => {
    setLocaleReady(true);
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <LocaleProvider onReady={handleLocaleReady}>{localeReady ? <Stack /> : null}</LocaleProvider>
  );
}
