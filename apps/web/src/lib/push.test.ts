import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPushStatus, isPushSupported, urlBase64ToUint8Array } from './push';

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
