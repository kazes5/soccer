import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPushStatus,
  isPushSupported,
  needsHomeScreenInstall,
  urlBase64ToUint8Array,
} from './push';

describe('urlBase64ToUint8Array', () => {
  it('decodes a standard base64 string', () => {
    expect(Array.from(urlBase64ToUint8Array('aGVsbG8='))).toEqual([104, 101, 108, 108, 111]);
  });

  it('decodes a URL-safe string using - and _ in place of + and /', () => {
    // Standard base64 for bytes [251, 255, 191] is "+/+/"; the URL-safe
    // encoding VAPID keys actually use substitutes "-_-_".
    expect(Array.from(urlBase64ToUint8Array('-_-_'))).toEqual([251, 255, 191]);
  });

  it('pads strings whose length is not a multiple of 4', () => {
    // "aGk" (3 chars, unpadded) decodes the same as "aGk=" ("hi").
    expect(Array.from(urlBase64ToUint8Array('aGk'))).toEqual([104, 105]);
  });
});

describe('isPushSupported', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('returns false when the browser lacks serviceWorker/PushManager/Notification (plain jsdom)', () => {
    expect(isPushSupported()).toBe(false);
  });

  it('returns true once serviceWorker, PushManager, and Notification are all present', () => {
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'default';
      },
    );

    expect(isPushSupported()).toBe(true);
  });
});

describe('needsHomeScreenInstall', () => {
  const IPHONE_SAFARI =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const IPAD_DESKTOP_MODE =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

  function stubDevice(
    userAgent: string,
    options: { touchPoints?: number; standalone?: boolean } = {},
  ) {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: options.touchPoints ?? 0,
      configurable: true,
    });
    Object.defineProperty(window, 'matchMedia', {
      value: (query: string) => ({
        matches: query === '(display-mode: standalone)' && !!options.standalone,
      }),
      configurable: true,
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'maxTouchPoints');
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('is true for iPhone Safari in a browser tab', () => {
    stubDevice(IPHONE_SAFARI);
    expect(needsHomeScreenInstall()).toBe(true);
  });

  it('is false once opened from the Home Screen', () => {
    stubDevice(IPHONE_SAFARI, { standalone: true });
    expect(needsHomeScreenInstall()).toBe(false);
  });

  it('treats a touch-capable "Macintosh" as an iPad', () => {
    stubDevice(IPAD_DESKTOP_MODE, { touchPoints: 5 });
    expect(needsHomeScreenInstall()).toBe(true);
  });

  it('is false for a real Mac and for other browsers', () => {
    stubDevice(IPAD_DESKTOP_MODE);
    expect(needsHomeScreenInstall()).toBe(false);
    stubDevice(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
    );
    expect(needsHomeScreenInstall()).toBe(false);
  });

  it('makes getPushStatus report needs-install instead of unsupported on iPhone', async () => {
    stubDevice(IPHONE_SAFARI);
    expect(await getPushStatus()).toBe('needs-install');
  });
});

describe('getPushStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  function stubSupported(permission: NotificationPermission) {
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal(
      'Notification',
      class {
        static permission = permission;
      },
    );
  }

  it('reports unsupported when required browser APIs are missing', async () => {
    expect(await getPushStatus()).toBe('unsupported');
  });

  it('reports denied when Notification permission was refused', async () => {
    stubSupported('denied');
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });

    expect(await getPushStatus()).toBe('denied');
  });

  it('reports default when permission has not been requested yet', async () => {
    stubSupported('default');
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });

    expect(await getPushStatus()).toBe('default');
  });

  it('reports granted-not-subscribed when permission is granted but there is no subscription', async () => {
    stubSupported('granted');
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: { getSubscription: vi.fn().mockResolvedValue(null) },
        }),
      },
      configurable: true,
    });

    expect(await getPushStatus()).toBe('granted-not-subscribed');
  });

  it('reports subscribed when a push subscription already exists', async () => {
    stubSupported('granted');
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue({ endpoint: 'https://push.example.com/x' }),
          },
        }),
      },
      configurable: true,
    });

    expect(await getPushStatus()).toBe('subscribed');
  });

  it('reports granted-not-subscribed when there is no existing service worker registration', async () => {
    stubSupported('granted');
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });

    expect(await getPushStatus()).toBe('granted-not-subscribed');
  });
});
