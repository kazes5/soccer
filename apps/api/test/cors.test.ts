import { describe, expect, it } from 'vitest';
import { env } from '../src/env';
import { buildApp } from '../src/app';

describe('CORS', () => {
  it('answers a preflight request from the web origin', async () => {
    const app = buildApp();

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/teams',
      headers: {
        origin: env.WEB_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers['access-control-allow-origin']).toBe(env.WEB_ORIGIN);

    await app.close();
  });

  it('includes the CORS header on an actual cross-origin response', async () => {
    const app = buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: env.WEB_ORIGIN },
    });

    expect(response.headers['access-control-allow-origin']).toBe(env.WEB_ORIGIN);

    await app.close();
  });
});
