import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@/test/render';
import { LanguageToggle } from './language-toggle';
import { LocaleProvider, useLocale } from './locale-provider';

function Probe() {
  const { locale, t } = useLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="message">{t('common.logIn')}</span>
      <LanguageToggle />
    </div>
  );
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ?? null;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0`;
}

describe('LocaleProvider', () => {
  beforeEach(() => {
    clearCookie('soccer.locale');
    document.documentElement.lang = '';
    document.documentElement.dir = '';
  });

  it('renders with the server-resolved initial locale (English/LTR)', () => {
    render(
      <LocaleProvider initialLocale="en">
        <Probe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('message')).toHaveTextContent('Log in');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('renders with a server-resolved Hebrew initial locale (RTL) with no client-side flip needed', () => {
    render(
      <LocaleProvider initialLocale="he">
        <Probe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('he');
    expect(screen.getByTestId('message')).toHaveTextContent('התחברות');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('switches locale on toggle and writes the cookie the server reads next time', () => {
    render(
      <LocaleProvider initialLocale="en">
        <Probe />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'עב' }));

    expect(screen.getByTestId('locale')).toHaveTextContent('he');
    expect(document.documentElement.lang).toBe('he');
    expect(document.documentElement.dir).toBe('rtl');
    expect(readCookie('soccer.locale')).toBe('he');
  });
});
