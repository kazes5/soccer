import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { env } from '../src/env';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const team = await prisma.team.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
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
      teamMemberships: {
        create: { teamId: team.id, role: 'admin' },
      },
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
          teamMemberships: {
            create: { teamId: team.id, role: 'parent' },
          },
        },
      }),
    ),
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
