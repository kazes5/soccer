import { defaultLocale, type Locale } from '@soccer/i18n';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { LocaleProvider } from '@/components/locale-provider';
import { ToastProvider } from '@/components/ui/toast';

export * from '@testing-library/react';

export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions & { locale?: Locale },
) {
  return render(
    <LocaleProvider initialLocale={options?.locale ?? defaultLocale}>
      <ToastProvider>{ui}</ToastProvider>
    </LocaleProvider>,
    options,
  );
}
