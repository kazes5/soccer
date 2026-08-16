import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { env } from '../src/env';
import { normalizeEmail, normalizePhone } from '../src/lib/identifiers';
import { combineDateAndTime, generateOccurrences } from '../src/lib/recurrence';
import { createSessionWithShifts } from '../src/routes/schedule-templates';
import { wallClockToInstant } from '../src/lib/timezone';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Local demo invites are intentionally long-lived. They are only created by the
// seed script and are reset to pending on each reseed, so this avoids making a
// developer regenerate test links while keeping the normal invite TTL unchanged.
const TEST_INVITE_EXPIRY = new Date('9999-12-31T23:59:59.999Z');

type DemoInviteUser = { phone: string | null; email: string | null };

// Shared by both demo teams below. A pending invite for a user who already has
// team membership (but no passkey yet) resolves through the existing
// "invite_accepted_for_recovery" path (see apps/api/src/routes/invites.ts) —
// the same recovery flow CLAUDE.md §9.1 documents for a lost/inaccessible
// device — so this is safe to point at already-seeded users, not just brand
// new ones.
async function upsertDemoInvites(
  teamId: string,
  createdByUserId: string,
  invites: Array<{ code: string; label: string; user: DemoInviteUser }>,
) {
  for (const invite of invites) {
    await prisma.invite.upsert({
      where: { code: invite.code },
      update: {
        teamId,
        phone: invite.user.phone,
        email: invite.user.email,
        status: 'pending',
        acceptedByUserId: null,
        acceptedAt: null,
        createdByUserId,
        expiresAt: TEST_INVITE_EXPIRY,
      },
      create: {
        teamId,
        code: invite.code,
        phone: invite.user.phone,
        email: invite.user.email,
        createdByUserId,
        expiresAt: TEST_INVITE_EXPIRY,
      },
    });
  }
  return invites.map(({ code, label }) => ({ code, label }));
}

async function main() {
  // One-time cleanup for local databases seeded before this id was fixed to be a
  // schema-valid UUID (see below) — without this, re-running seed against such a
  // database would upsert-create a *second*, duplicate "U-12 Wildcats" team,
  // since upsert matches on id and the old id would no longer match anything.
  await prisma.team.deleteMany({ where: { id: '00000000-0000-0000-0000-000000000001' } });

  // Must be a schema-valid UUID (version + variant nibbles set) — the API's own
  // response validation rejects loosely-formed ids like `...0001` with no version.
  const team = await prisma.team.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'U-12 Wildcats',
      season: 'Fall 2026',
      timezone: 'Asia/Jerusalem',
    },
  });

  const admin = await prisma.user.upsert({
    where: { phone: '+15550000001' },
    update: {
      normalizedPhone: normalizePhone('+15550000001'),
      normalizedEmail: normalizeEmail('dana@example.com'),
    },
    create: {
      name: 'Dana Cohen',
      phone: '+15550000001',
      normalizedPhone: normalizePhone('+15550000001'),
      email: 'dana@example.com',
      normalizedEmail: normalizeEmail('dana@example.com'),
      languagePreference: 'he',
    },
  });

  const parents = await Promise.all(
    [
      {
        name: 'Avi Levi',
        phone: '+15550000002',
        email: 'avi@example.com',
        language: 'he' as const,
      },
      {
        name: 'Sarah Katz',
        phone: '+15550000003',
        email: 'sarah@example.com',
        language: 'en' as const,
      },
      {
        name: 'Noa Peretz',
        phone: '+15550000004',
        email: 'noa@example.com',
        language: 'en' as const,
      },
      {
        name: 'Ron Mizrahi',
        phone: '+15550000005',
        email: 'ron@example.com',
        language: 'en' as const,
      },
      {
        name: 'Liat Shapira',
        phone: '+15550000006',
        email: 'liat@example.com',
        language: 'he' as const,
      },
      // Gets an auto-numbered invite code (english-parent-6-demo, from the
      // `parents.map` below) like everyone else, but no E2E spec ever
      // accepts it — so she reliably has no passkey for the whole suite's
      // lifetime. Exists for apps/e2e/tests/system-console.spec.ts, which
      // needs a team member it can rely on to demonstrate the system
      // console's "target must already hold a passkey" grant safeguard.
      {
        name: 'Maya Golan',
        phone: '+15550000007',
        email: 'maya@example.com',
        language: 'en' as const,
      },
    ].map((parent) =>
      prisma.user.upsert({
        where: { phone: parent.phone },
        update: {
          normalizedPhone: normalizePhone(parent.phone),
          normalizedEmail: normalizeEmail(parent.email),
        },
        create: {
          name: parent.name,
          phone: parent.phone,
          normalizedPhone: normalizePhone(parent.phone),
          email: parent.email,
          normalizedEmail: normalizeEmail(parent.email),
          languagePreference: parent.language,
        },
      }),
    ),
  );

  // Upserted independently of the users above so re-running this script against a
  // database where those users already exist (but were never linked to this team)
  // still leaves everyone with the membership they're supposed to have.
  await Promise.all(
    [
      { userId: admin.id, role: 'admin' as const },
      { userId: parents[0]?.id, role: 'parent' as const },
      { userId: parents[1]?.id, role: 'parent' as const },
      { userId: parents[2]?.id, role: 'parent' as const },
      { userId: parents[3]?.id, role: 'parent' as const },
      { userId: parents[4]?.id, role: 'parent' as const },
      { userId: parents[5]?.id, role: 'parent' as const },
    ].map(({ userId, role }) => {
      if (!userId) return Promise.resolve();
      return prisma.teamMember.upsert({
        where: { teamId_userId: { teamId: team.id, userId } },
        update: { role },
        create: { teamId: team.id, userId, role },
      });
    }),
  );

  const [aviLevi, sarahKatz] = parents;
  if (!aviLevi || !sarahKatz) {
    throw new Error('Expected exactly two seeded parents.');
  }

  const players = await Promise.all(
    [
      { name: 'Yossi Levi', age: 11, parentUserId: aviLevi.id },
      { name: 'Noa Katz', age: 12, parentUserId: sarahKatz.id },
    ].map((player) =>
      prisma.player.create({
        data: {
          teamId: team.id,
          name: player.name,
          age: player.age,
          parents: {
            create: { userId: player.parentUserId, relationship: 'parent' },
          },
        },
      }),
    ),
  );

  const oakSt = await prisma.collectionPoint.upsert({
    where: { id: '00000000-0000-4000-8000-000000000101' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000101',
      teamId: team.id,
      name: 'Oak St',
      address: '123 Oak St',
      type: 'pickup',
    },
  });
  const centralField = await prisma.collectionPoint.upsert({
    where: { id: '00000000-0000-4000-8000-000000000102' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000102',
      teamId: team.id,
      name: 'Central Field',
      address: '1 Field Rd',
      type: 'both',
    },
  });

  // Session generation isn't idempotent (unlike the upserts above), so only run it
  // the first time this script is run against a given database.
  const existingTemplate = await prisma.scheduleTemplate.findFirst({ where: { teamId: team.id } });
  let sessionsCreated = 0;
  if (!existingTemplate) {
    const recurrenceRule = 'FREQ=WEEKLY;BYDAY=MO,WE,FR';
    const startDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const defaultTime = '18:00';
    const dtstart = combineDateAndTime(startDate, defaultTime);

    const template = await prisma.scheduleTemplate.create({
      data: {
        teamId: team.id,
        recurrenceRule,
        startDate,
        defaultTime,
        defaultFieldLocation: centralField.name,
        createdByUserId: admin.id,
        collectionPoints: {
          create: [{ pointId: oakSt.id }, { pointId: centralField.id }],
        },
      },
    });

    const occurrences = generateOccurrences(recurrenceRule, dtstart, template.horizonWeeks).map(
      (occurrence) => wallClockToInstant(occurrence, team.timezone),
    );
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
  }

  const englishInvites = await upsertDemoInvites(team.id, admin.id, [
    { code: 'english-admin-demo', label: 'admin', user: admin },
    ...parents.map((parent, index) => ({
      code: `english-parent-${index + 1}-demo`,
      label: `parent ${index + 1}`,
      user: parent,
    })),
  ]);

  console.log(
    `Seeded team "${team.name}" with 1 admin (${admin.name}), ${parents.length} parents, ${players.length} players, 2 collection points, and ${sessionsCreated || 'no new'} sessions.\n` +
      `Passkey setup invites:\n` +
      englishInvites
        .map(({ label, code }) => `  ${label}: http://localhost:3000/invite/${code}`)
        .join('\n'),
  );

  const hebrewDemo = await seedHebrewDemoData();
  console.log(
    `Seeded Hebrew demo team "${hebrewDemo.team.name}" with passkey setup invites:\n` +
      hebrewDemo.invites
        .map(({ label, code }) => `  ${label}: http://localhost:3000/invite/${code}`)
        .join('\n'),
  );
}

async function seedHebrewDemoData() {
  const team = await prisma.team.upsert({
    where: { id: '00000000-0000-4000-8000-000000000002' },
    update: { name: 'נבחרת אריות U-12', season: 'סתיו 2026', timezone: 'Asia/Jerusalem' },
    create: {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'נבחרת אריות U-12',
      season: 'סתיו 2026',
      timezone: 'Asia/Jerusalem',
    },
  });

  const admin = await prisma.user.upsert({
    where: { phone: '+972501234567' },
    update: {
      name: 'יעל כהן',
      email: 'yael@example.test',
      normalizedPhone: normalizePhone('+972501234567'),
      normalizedEmail: normalizeEmail('yael@example.test'),
      languagePreference: 'he',
      isActive: true,
    },
    create: {
      name: 'יעל כהן',
      phone: '+972501234567',
      normalizedPhone: normalizePhone('+972501234567'),
      email: 'yael@example.test',
      normalizedEmail: normalizeEmail('yael@example.test'),
      languagePreference: 'he',
    },
  });

  const parents = await Promise.all(
    [
      {
        name: 'אבי לוי',
        phone: '+972502345678',
        email: 'avi.he@example.test',
      },
      {
        name: 'שרה כץ',
        phone: '+972503456789',
        email: 'sarah.he@example.test',
      },
      {
        name: 'מיכל פרץ',
        phone: '+972504567890',
        email: 'michal.he@example.test',
      },
      {
        name: 'רון מזרחי',
        phone: '+972505678901',
        email: 'ron.he@example.test',
      },
      {
        name: 'ליאת שפירא',
        phone: '+972506789012',
        email: 'liat.he@example.test',
      },
    ].map((parent) =>
      prisma.user.upsert({
        where: { phone: parent.phone },
        update: {
          name: parent.name,
          email: parent.email,
          normalizedPhone: normalizePhone(parent.phone),
          normalizedEmail: normalizeEmail(parent.email),
          languagePreference: 'he',
          isActive: true,
        },
        create: {
          ...parent,
          normalizedPhone: normalizePhone(parent.phone),
          normalizedEmail: normalizeEmail(parent.email),
          languagePreference: 'he',
        },
      }),
    ),
  );

  await Promise.all(
    [
      { userId: admin.id, role: 'admin' as const },
      { userId: parents[0]!.id, role: 'parent' as const },
      { userId: parents[1]!.id, role: 'parent' as const },
      { userId: parents[2]!.id, role: 'parent' as const },
      { userId: parents[3]!.id, role: 'parent' as const },
      { userId: parents[4]!.id, role: 'parent' as const },
    ].map(({ userId, role }) =>
      prisma.teamMember.upsert({
        where: { teamId_userId: { teamId: team.id, userId } },
        update: { role },
        create: { teamId: team.id, userId, role },
      }),
    ),
  );

  const playerDefinitions = [
    {
      id: '00000000-0000-4000-8000-000000000201',
      name: 'יואב לוי',
      age: 11,
      parentUserId: parents[0]!.id,
    },
    {
      id: '00000000-0000-4000-8000-000000000202',
      name: 'נועה כץ',
      age: 12,
      parentUserId: parents[1]!.id,
    },
  ];

  for (const player of playerDefinitions) {
    await prisma.player.upsert({
      where: { id: player.id },
      update: { teamId: team.id, name: player.name, age: player.age },
      create: {
        id: player.id,
        teamId: team.id,
        name: player.name,
        age: player.age,
        parents: {
          create: { userId: player.parentUserId, relationship: 'parent' },
        },
      },
    });

    await prisma.playerParent.upsert({
      where: { playerId_userId: { playerId: player.id, userId: player.parentUserId } },
      update: { relationship: 'parent' },
      create: { playerId: player.id, userId: player.parentUserId, relationship: 'parent' },
    });
  }

  const neighborhoodPoint = await prisma.collectionPoint.upsert({
    where: { id: '00000000-0000-4000-8000-000000000201' },
    update: {
      teamId: team.id,
      name: 'רחוב האלון',
      address: 'רחוב האלון 12, תל אביב',
      type: 'pickup',
    },
    create: {
      id: '00000000-0000-4000-8000-000000000201',
      teamId: team.id,
      name: 'רחוב האלון',
      address: 'רחוב האלון 12, תל אביב',
      type: 'pickup',
    },
  });
  const centralPoint = await prisma.collectionPoint.upsert({
    where: { id: '00000000-0000-4000-8000-000000000202' },
    update: {
      teamId: team.id,
      name: 'הפארק המרכזי',
      address: 'שדרות העצמאות 8, תל אביב',
      type: 'both',
    },
    create: {
      id: '00000000-0000-4000-8000-000000000202',
      teamId: team.id,
      name: 'הפארק המרכזי',
      address: 'שדרות העצמאות 8, תל אביב',
      type: 'both',
    },
  });

  const existingTemplate = await prisma.scheduleTemplate.findFirst({ where: { teamId: team.id } });
  let sessionsCreated = 0;
  if (!existingTemplate) {
    const recurrenceRule = 'FREQ=WEEKLY;BYDAY=SU,TU,TH';
    const startDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const defaultTime = '17:30';
    const dtstart = combineDateAndTime(startDate, defaultTime);

    const template = await prisma.scheduleTemplate.create({
      data: {
        id: '00000000-0000-4000-8000-000000000203',
        teamId: team.id,
        recurrenceRule,
        startDate,
        defaultTime,
        defaultFieldLocation: 'מגרש מרכזי',
        createdByUserId: admin.id,
        collectionPoints: {
          create: [{ pointId: neighborhoodPoint.id }, { pointId: centralPoint.id }],
        },
      },
    });

    const occurrences = generateOccurrences(recurrenceRule, dtstart, template.horizonWeeks).map(
      (occurrence) => wallClockToInstant(occurrence, team.timezone),
    );
    for (const startsAt of occurrences) {
      await createSessionWithShifts(prisma, {
        teamId: team.id,
        templateId: template.id,
        startsAt,
        fieldLocation: 'מגרש מרכזי',
        points: [neighborhoodPoint, centralPoint],
      });
      sessionsCreated += 1;
    }
  }

  const invites = await upsertDemoInvites(team.id, admin.id, [
    { code: 'hebrew-admin-demo', label: 'admin', user: admin },
    ...parents.map((parent, index) => ({
      code: `hebrew-parent-${index + 1}-demo`,
      label: `parent ${index + 1}`,
      user: parent,
    })),
  ]);

  return { team, sessionsCreated, invites };
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
