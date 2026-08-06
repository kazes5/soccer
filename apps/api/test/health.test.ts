import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('GET /health', () => {
  it('returns an ok status payload', async () => {
    const app = buildApp();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'api' });

    await app.close();
  });
});
