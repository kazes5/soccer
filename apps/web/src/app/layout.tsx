import { defaultLocale, directionFor, isLocale, type Locale } from '@soccer/i18n';
import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Heebo } from 'next/font/google';
import { cookies } from 'next/headers';
import { LocaleProvider } from '@/components/locale-provider';
import { ToastProvider } from '@/components/ui/toast';
import { LOCALE_COOKIE_NAME } from '@/lib/locale-cookie';
import './globals.css';

// Heebo renders both Latin and Hebrew glyphs from one family, so the UI never
// swaps fonts when the locale switches (CLAUDE.md §3.10).
const heebo = Heebo({
  variable: '--font-heebo',
  subsets: ['latin', 'hebrew'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Soccer Carpool Coordinator',
  description: 'Coordinate youth soccer team carpool pickups and drop-offs.',
  // Opened from the iOS Home Screen, the app runs standalone (no Safari
  // chrome) — which is also what unlocks web push there. See manifest.ts.
  appleWebApp: {
    capable: true,
    title: 'Carpool',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#1f7a4d',
};

async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const value = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  return value && isLocale(value) ? value : defaultLocale;
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const locale = await resolveLocale();

  return (
    <html
      lang={locale}
      dir={directionFor(locale)}
      className={`${heebo.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-surface text-ink" suppressHydrationWarning>
        <LocaleProvider initialLocale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
