import { applyLocaleDirection, type I18nManagerLike, type UpdatesLike } from './rtl-restart';

function fakeI18nManager(isRTL: boolean): I18nManagerLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    get isRTL() {
      return isRTL;
    },
    allowRTL(allow) {
      calls.push(`allowRTL(${allow})`);
    },
    forceRTL(force) {
      calls.push(`forceRTL(${force})`);
      isRTL = force;
    },
  };
}

describe('applyLocaleDirection', () => {
  it('does nothing when the new locale keeps the same direction', async () => {
    const i18nManager = fakeI18nManager(false);
    const updates: UpdatesLike = { reloadAsync: jest.fn() };

    const result = await applyLocaleDirection('en', { i18nManager, updates });

    expect(result).toEqual({ changed: false, restarted: false });
    expect(i18nManager.calls).toEqual([]);
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('forces RTL and reloads when switching to a language with a different direction', async () => {
    const i18nManager = fakeI18nManager(false);
    const updates: UpdatesLike = { reloadAsync: jest.fn().mockResolvedValue(undefined) };

    const result = await applyLocaleDirection('he', { i18nManager, updates });

    expect(result).toEqual({ changed: true, restarted: true });
    expect(i18nManager.calls).toEqual(['allowRTL(true)', 'forceRTL(true)']);
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('forces LTR when switching back from Hebrew', async () => {
    const i18nManager = fakeI18nManager(true);
    const updates: UpdatesLike = { reloadAsync: jest.fn().mockResolvedValue(undefined) };

    const result = await applyLocaleDirection('en', { i18nManager, updates });

    expect(result).toEqual({ changed: true, restarted: true });
    expect(i18nManager.calls).toEqual(['allowRTL(true)', 'forceRTL(false)']);
  });

  it('still sets the direction flag but reports no restart when reloadAsync fails', async () => {
    const i18nManager = fakeI18nManager(false);
    const updates: UpdatesLike = {
      reloadAsync: jest.fn().mockRejectedValue(new Error('no channel')),
    };

    const result = await applyLocaleDirection('he', { i18nManager, updates });

    expect(result).toEqual({ changed: true, restarted: false });
    expect(i18nManager.calls).toEqual(['allowRTL(true)', 'forceRTL(true)']);
  });
});
