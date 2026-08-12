import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('POST/DELETE /push-subscriptions', () => {
  const app = buildApp();
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await app.prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdTeamIds.length = 0;
    createdUserIds.length = 0;
  });

  async function createAdmin() {
    const response = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: {
        teamName: 'U-12 Wildcats',
        season: 'Fall 2026',
        adminName: 'Dana Cohen',
        adminPhone: `+1555127${Math.floor(Math.random() * 9000 + 1000)}`,
      },
    });
    const body = response.json();
    createdTeamIds.push(body.team.id);
    createdUserIds.push(body.admin.id);
    return { token: body.sessionToken as string, userId: body.admin.id as string };
  }

  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/push-subscriptions',
      payload: {
        endpoint: 'https://push.example.com/abc',
        keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /push-subscriptions/config requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/push-subscriptions/config' });
    expect(response.statusCode).toBe(401);
  });

  it('GET /push-subscriptions/config reports push as unavailable when VAPID is not configured', async () => {
    const { token } = await createAdmin();
    const response = await app.inject({
      method: 'GET',
      url: '/push-subscriptions/config',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    // No VAPID_* env vars are set for the test run, matching production
    // behavior when the operator hasn't configured push.
    expect(response.json()).toEqual({ publicKey: null });
  });

  it('registers and later removes a subscription for the current user', async () => {
    const { token, userId } = await createAdmin();
    const endpoint = `https://push.example.com/${crypto.randomUUID()}`;

    const create = await app.inject({
      method: 'POST',
      url: '/push-subscriptions',
      headers: { authorization: `Bearer ${token}` },
      payload: { endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } },
    });
    expect(create.statusCode).toBe(204);

    const stored = await app.prisma.pushSubscription.findUnique({ where: { endpoint } });
    expect(stored?.userId).toBe(userId);

    const remove = await app.inject({
      method: 'DELETE',
      url: '/push-subscriptions',
      headers: { authorization: `Bearer ${token}` },
      payload: { endpoint },
    });
    expect(remove.statusCode).toBe(204);

    const afterRemoval = await app.prisma.pushSubscription.findUnique({ where: { endpoint } });
    expect(afterRemoval).toBeNull();
  });

  it('re-registering the same endpoint upserts rather than duplicating', async () => {
    const { token: tokenA } = await createAdmin();
    const { token: tokenB, userId: userIdB } = await createAdmin();
    const endpoint = `https://push.example.com/${crypto.randomUUID()}`;

    await app.inject({
      method: 'POST',
      url: '/push-subscriptions',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/push-subscriptions',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { endpoint, keys: { p256dh: 'new-value', auth: 'auth-value' } },
    });
    expect(second.statusCode).toBe(204);

    const stored = await app.prisma.pushSubscription.findUnique({ where: { endpoint } });
    expect(stored?.userId).toBe(userIdB);
    expect(await app.prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);
  });
});
