import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { env } from '../env';
import { normalizeLoginIdentifier } from '../lib/identifiers';
import { recordSystemAuditLog } from '../lib/system-audit';

export async function grantInitialSystemAdmin(prisma: PrismaClient, identifier: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::int AS locked FROM pg_advisory_xact_lock(74139201)
    `;
    const normalized = normalizeLoginIdentifier(identifier);
    const candidates = await tx.user.findMany({
      where: {
        isActive: true,
        OR: [{ id: identifier }, normalized],
      },
      include: { passwordCredential: true },
      take: 2,
    });
    if (candidates.length !== 1) throw new Error('Expected exactly one active matching user.');
    const target = candidates[0]!;
    if (target.passwordCredential === null)
      throw new Error('The target user must have a password set.');
    const existingCount = await tx.user.count({
      where: { systemRole: 'system_admin', isActive: true },
    });
    if (existingCount > 0 && target.systemRole !== 'system_admin') {
      throw new Error('A system admin already exists; grant additional roles through the console.');
    }
    if (target.systemRole === 'system_admin') return target;
    const updated = await tx.user.update({
      where: { id: target.id },
      data: { systemRole: 'system_admin' },
    });
    await recordSystemAuditLog(tx, {
      actionType: 'system_admin_bootstrapped',
      targetEntity: 'user',
      targetId: target.id,
      afterState: { systemRole: 'system_admin' },
    });
    return updated;
  });
}

async function main() {
  const identifier = process.argv[2];
  if (!identifier) throw new Error('Usage: pnpm system-admin:grant <user-id|phone|email>');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  try {
    const user = await grantInitialSystemAdmin(prisma, identifier);
    process.stdout.write(`System administrator granted to ${user.name} (${user.id}).\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('grant-system-admin.ts')) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
