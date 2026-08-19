import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { env } from '../env';
import { hashPassword } from '../lib/passwords';

/**
 * An exceptional, hardcoded system-admin account for the MVP pilot phase —
 * a known-credential super-admin login that always exists once this script
 * has been run against a given database, independent of the normal
 * invite/password-onboarding flow and the one-time `system-admin:grant`
 * bootstrap (apps/api/src/scripts/grant-system-admin.ts, which requires an
 * existing password-holding account and refuses a second bootstrap).
 *
 * Deliberately bypasses two normal invariants, both intentional and
 * temporary per explicit product direction — revisit before scaling past
 * pilot:
 * - The login "identifier" isn't a real phone or email. Login only ever
 *   requires a non-empty string (passwordLoginRequestSchema has no
 *   format check), and normalizeLoginIdentifier's phone-fallback path
 *   reduces any digit-less string to an empty-string normalizedPhone — so
 *   a user row with `normalizedPhone: ''` is reachable by logging in with
 *   the literal identifier below, without needing a real contact value.
 * - The password is shorter than MIN_PASSWORD_LENGTH (15). hashPassword()
 *   hashes whatever it's given with no length check of its own —
 *   assertAcceptablePassword is what normally enforces the policy, and
 *   this script calls hashPassword directly instead, on purpose.
 *
 * Idempotent: safe to run again (e.g. after a database reset) — upserts
 * rather than failing if the account already exists.
 */
const IDENTIFIER = 'admin';
const PASSWORD = '037610839aA!';
const NAME = 'System Administrator';

export async function bootstrapSuperAdmin(prisma: PrismaClient) {
  const passwordHash = await hashPassword(PASSWORD);
  return prisma.user.upsert({
    where: { normalizedPhone: '' },
    create: {
      name: NAME,
      phone: IDENTIFIER,
      normalizedPhone: '',
      systemRole: 'system_admin',
      isActive: true,
      passwordCredential: { create: { passwordHash } },
    },
    update: {
      name: NAME,
      isActive: true,
      systemRole: 'system_admin',
      passwordCredential: {
        upsert: { create: { passwordHash }, update: { passwordHash } },
      },
    },
  });
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  try {
    const user = await bootstrapSuperAdmin(prisma);
    process.stdout.write(
      `Super admin ready: ${user.name} (${user.id}), login identifier "${IDENTIFIER}".\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('bootstrap-super-admin.ts')) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
