import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocaleProvider, useLocale } from './locale-provider';
import { writePersistedLocale } from '@/lib/locale-storage';

const mockReloadAsync = jest.fn();
jest.mock('expo-updates', () => ({
  reloadAsync: (...args: unknown[]) => mockReloadAsync(...args),
}));

function Probe() {
  const { locale, setLocale, t } = useLocale();
  return (
    <>
      <Text testID="locale">{locale}</Text>
      <Text testID="appName">{t('common.appName')}</Text>
      <Text testID="toggle" onPress={() => setLocale(locale === 'en' ? 'he' : 'en')}>
        toggle
      </Text>
    </>
  );
}

describe('LocaleProvider', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockReloadAsync.mockReset();
  });

  it('starts at the default locale and calls onReady once storage has been checked', async () => {
    const onReady = jest.fn();
    const { getByTestId } = await render(
      <LocaleProvider onReady={onReady}>
        <Probe />
      </LocaleProvider>,
    );

    expect(getByTestId('locale').props.children).toBe('en');
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it('initializes from a persisted locale', async () => {
    await writePersistedLocale('he');

    const { getByTestId } = await render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );

    await waitFor(() => expect(getByTestId('locale').props.children).toBe('he'));
    expect(getByTestId('appName').props.children).toBe('מערכת הסעות לכדורגל');
  });

  it('persists a locale change and reloads to apply the new direction', async () => {
    mockReloadAsync.mockResolvedValue(undefined);
    const { getByTestId } = await render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    await waitFor(() => expect(getByTestId('locale').props.children).toBe('en'));

    await act(async () => {
      fireEvent.press(getByTestId('toggle'));
    });

    expect(getByTestId('locale').props.children).toBe('he');
    await waitFor(() => expect(mockReloadAsync).toHaveBeenCalledTimes(1));
    await waitFor(async () => {
      const stored = await AsyncStorage.getItem('soccer.locale');
      expect(stored).toBe('he');
    });
  });
});
