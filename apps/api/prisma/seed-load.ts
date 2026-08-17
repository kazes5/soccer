import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { env } from '../src/env';
import { hashSecret } from '../src/lib/crypto';
import { combineDateAndTime, generateOccurrences } from '../src/lib/recurrence';
import { createSessionWithShifts } from '../src/routes/schedule-templates';
import { wallClockToInstant } from '../src/lib/timezone';

/**
 * Synthetic data for `apps/load`'s `pnpm test:load` — a team well past
 * CLAUDE.md §7's ~100-user target (120 members: 1 admin + 119 parents) with
 * enough open shifts that the claim-traffic scenario can fire hundreds of
 * concurrent, *distinct*-shift claims without contending for the same row
 * (that race is `apps/api/test/shifts.test.ts`'s job, not this one's).
 *
 * Never run against anything but a disposable load-test database — invoked
 * exclusively by `apps/load/scripts/run.ts`, after that script's own reset
 * step, the same way `apps/e2e` shells out to this package's `db:seed` for
 * its own disposable database rather than duplicating seeding logic.
 */
const PARENT_COUNT = 119;
/** Every seeded member gets a valid bearer-token session row so load
 * scenarios can authenticate real requests without a passkey ceremony —
 * `sha256(loadTestToken(i))` must exactly match what `apps/load`'s scripts
 * compute independently to build `Authorization: Bearer` headers, so this
 * naming scheme is a contract between the two, not an implementation detail
 * either side can change alone. */
export function loadTestToken(memberIndex: number): string {
  return `load-test-token-${memberIndex}`;
}

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const team = await prisma.team.create({
    data: { name: 'Load Test FC', season: 'Load 2026', timezone: 'Asia/Jerusalem' },
  });

  const admin = await prisma.user.create({
    data: {
      name: 'Load Admin',
      phone: '+15559990000',
      normalizedPhone: '+15559990000',
      email: 'load-admin@example.com',
      normalizedEmail: 'load-admin@example.com',
      languagePreference: 'en',
    },
  });

  const parents = await Promise.all(
    Array.from({ length: PARENT_COUNT }, (_, i) =>
      prisma.user.create({
        data: {
          name: `Load Parent ${i + 1}`,
          phone: `+1555999${String(i + 1).padStart(4, '0')}`,
          normalizedPhone: `+1555999${String(i + 1).padStart(4, '0')}`,
          email: `load-parent-${i + 1}@example.com`,
          normalizedEmail: `load-parent-${i + 1}@example.com`,
          languagePreference: 'en',
        },
      }),
    ),
  );

  const members = [admin, ...parents];
  await Promise.all(
    members.map((user, index) =>
      prisma.teamMember.create({
        data: { teamId: team.id, userId: user.id, role: index === 0 ? 'admin' : 'parent' },
      }),
    ),
  );

  // A real, valid session per member — sha256(loadTestToken(i)) matches what
  // `apps/load` computes for its `Authorization: Bearer` headers, so load
  // scenarios hit real authenticated/authorized code paths without needing
  // a WebAuthn ceremony per virtual user (infeasible at this scale, and not
  // what a load test is for — that's `apps/e2e`'s job).
  const sessionExpiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await Promise.all(
    members.map((user, index) =>
      prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hashSecret(loadTestToken(index)),
          expiresAt: sessionExpiresAt,
          authMethod: 'passkey',
        },
      }),
    ),
  );

  const oakSt = await prisma.collectionPoint.create({
    data: { teamId: team.id, name: 'Oak St', address: '123 Oak St', type: 'pickup' },
  });
  const centralField = await prisma.collectionPoint.create({
    data: { teamId: team.id, name: 'Central Field', address: '1 Field Rd', type: 'both' },
  });

  // 5x/week for 40 weeks (~200 sessions) x 3 shifts/session (Oak St pickup,
  // Central Field pickup+dropoff) = ~600 open shifts — comfortably more than
  // any single claim-traffic run needs, with headroom to re-run the scenario
  // against the same seed without re-seeding.
  const recurrenceRule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  const startDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const defaultTime = '18:00';
  const dtstart = combineDateAndTime(startDate, defaultTime);
  const horizonWeeks = 40;

  const template = await prisma.scheduleTemplate.create({
    data: {
      teamId: team.id,
      recurrenceRule,
      startDate,
      defaultTime,
      defaultFieldLocation: centralField.name,
      horizonWeeks,
      createdByUserId: admin.id,
      collectionPoints: {
        create: [{ pointId: oakSt.id }, { pointId: centralField.id }],
      },
    },
  });

  const occurrences = generateOccurrences(recurrenceRule, dtstart, horizonWeeks).map((occurrence) =>
    wallClockToInstant(occurrence, team.timezone),
  );
  let sessionsCreated = 0;
  for (const startsAt of occurrences) {
    await createSessionWithShifts(prisma, {
      teamId: team.id,
      templateId: template.id,
      startsAt,
      fieldLocation: centralField.name,
      points: [oakSt, centralField],
    });
    sessionsCreated += 1;
  }

  const shiftCount = await prisma.shift.count({ where: { session: { teamId: team.id } } });
  console.log(
    JSON.stringify({
      teamId: team.id,
      memberCount: members.length,
      sessionsCreated,
      shiftCount,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
