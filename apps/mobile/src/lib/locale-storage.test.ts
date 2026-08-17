import AsyncStorage from '@react-native-async-storage/async-storage';
import { LOCALE_STORAGE_KEY, readPersistedLocale, writePersistedLocale } from './locale-storage';

describe('locale-storage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns null when nothing has been persisted yet', async () => {
    expect(await readPersistedLocale()).toBeNull();
  });

  it('round-trips a written locale', async () => {
    await writePersistedLocale('he');
    expect(await readPersistedLocale()).toBe('he');
  });

  it('ignores a corrupted or foreign value under the same key', async () => {
    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    expect(await readPersistedLocale()).toBeNull();
  });
});
