import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { env } from '../src/env';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

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
    update: {},
    create: {
      name: 'Dana Cohen',
      phone: '+15550000001',
      email: 'dana@example.com',
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
    ].map((parent) =>
      prisma.user.upsert({
        where: { phone: parent.phone },
        update: {},
        create: {
          name: parent.name,
          phone: parent.phone,
          email: parent.email,
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

  console.log(
    `Seeded team "${team.name}" with 1 admin (${admin.name}), ${parents.length} parents, and ${players.length} players.`,
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
