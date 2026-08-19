import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { grantInitialSystemAdmin } from '../src/scripts/grant-system-admin';
import { hashPassword } from '../src/lib/passwords';
import { normalizeEmail } from '../src/lib/identifiers';

describe('grantInitialSystemAdmin', () => {
  const app = buildApp();
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await app.ready();
  });

  afterEach(async () => {
    await app.prisma.systemAuditLog.deleteMany({ where: { targetId: { in: createdUserIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  });

  async function createUser(options: { withPassword?: boolean; systemAdmin?: boolean } = {}) {
    const suffix = randomUUID();
    const email = `${suffix}@grant-test.example`;
    const user = await app.prisma.user.create({
      data: {
        name: `Grant Test ${suffix}`,
        email,
        normalizedEmail: normalizeEmail(email),
        systemRole: options.systemAdmin ? 'system_admin' : null,
        ...(options.withPassword
          ? {
              passwordCredential: {
                create: { passwordHash: await hashPassword('Cedar-River!Otter-52') },
              },
            }
          : {}),
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  it('rejects a target with no password credential', async () => {
    const user = await createUser({ withPassword: false });

    await expect(grantInitialSystemAdmin(app.prisma, user.id)).rejects.toThrow(
      'The target user must have a password set.',
    );
    expect(await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      systemRole: null,
    });
  });

  it('grants the role by user id and records a global audit entry', async () => {
    const user = await createUser({ withPassword: true });

    const granted = await grantInitialSystemAdmin(app.prisma, user.id);
    expect(granted.systemRole).toBe('system_admin');

    const refreshed = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(refreshed.systemRole).toBe('system_admin');

    const auditEntries = await app.prisma.systemAuditLog.findMany({
      where: { targetId: user.id, actionType: 'system_admin_bootstrapped' },
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('grants the role by normalized email identifier', async () => {
    const user = await createUser({ withPassword: true });

    const granted = await grantInitialSystemAdmin(app.prisma, user.email!.toUpperCase());
    expect(granted.id).toBe(user.id);
  });

  it('is idempotent for a user who is already a system admin', async () => {
    const user = await createUser({ withPassword: true, systemAdmin: true });

    const granted = await grantInitialSystemAdmin(app.prisma, user.id);
    expect(granted.systemRole).toBe('system_admin');

    expect(
      await app.prisma.systemAuditLog.count({
        where: { targetId: user.id, actionType: 'system_admin_bootstrapped' },
      }),
    ).toBe(0);
  });

  it('rejects bootstrapping a second system admin once one already exists', async () => {
    await createUser({ withPassword: true, systemAdmin: true });
    const secondUser = await createUser({ withPassword: true });

    await expect(grantInitialSystemAdmin(app.prisma, secondUser.id)).rejects.toThrow(
      'A system admin already exists; grant additional roles through the console.',
    );
  });

  it('rejects an identifier that matches no active user', async () => {
    await expect(
      grantInitialSystemAdmin(app.prisma, `00000000-0000-4000-8000-${Date.now()}`),
    ).rejects.toThrow('Expected exactly one active matching user.');
  });

  it('rejects an inactive user even if they have a password', async () => {
    const user = await createUser({ withPassword: true });
    await app.prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    await expect(grantInitialSystemAdmin(app.prisma, user.id)).rejects.toThrow(
      'Expected exactly one active matching user.',
    );
  });
});
