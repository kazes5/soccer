import { defaultLocale, directionFor, isLocale, type Locale } from '@soccer/i18n';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import { LocaleProvider } from '@/components/locale-provider';
import { LOCALE_COOKIE_NAME } from '@/lib/locale-cookie';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Soccer Carpool Coordinator',
  description: 'Coordinate youth soccer team carpool pickups and drop-offs.',
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
