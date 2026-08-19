import type { Prisma, TeamRole, Language } from '../../generated/prisma/client';
import { normalizeEmail, normalizePhone } from './identifiers';
import { assertAcceptablePassword, hashPassword } from './passwords';
import { HttpError } from './errors';

interface CreateDirectMemberInput {
  teamId: string;
  role: TeamRole;
  name: string;
  phone?: string;
  email?: string;
  language: Language;
  password: string;
  players: Array<{ name: string; age?: number }>;
}

/** Shared by the team-admin direct-add-parent route and the system-admin
 *  add-member route: creates a brand-new user with a password chosen by the
 *  caller, or — if a matching contact exists but is deactivated (e.g. a
 *  previously removed member) — reactivates that account in place instead of
 *  colliding with it on the global unique phone/email columns, mirroring the
 *  invite-onboarding recovery path in invites.ts. Throws 409 if the contact
 *  matches an *active* account. A reactivated user's prior team memberships
 *  were already cleared when they were deactivated (see members.ts's removal
 *  handler — `isActive: false` only happens once `remainingMemberships` hits
 *  zero), so the new membership created here is always a fresh row. */
export async function createOrReactivateTeamMember(
  tx: Prisma.TransactionClient,
  input: CreateDirectMemberInput,
) {
  const normalizedPhone = input.phone ? normalizePhone(input.phone) : undefined;
  const normalizedEmail = input.email ? normalizeEmail(input.email) : undefined;
  const contactWhere = normalizedPhone ? { normalizedPhone } : { normalizedEmail };

  const existing = await tx.user.findFirst({ where: contactWhere });
  if (existing?.isActive) {
    throw new HttpError(409, 'A person with this phone or email already has an account.');
  }

  const password = assertAcceptablePassword(input.password, [input.email ?? '', input.phone ?? '']);
  const passwordHash = await hashPassword(password);

  const reactivating = existing !== null;
  const user = reactivating
    ? await tx.user.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          languagePreference: input.language,
          isActive: true,
          passwordCredential: {
            upsert: { create: { passwordHash }, update: { passwordHash } },
          },
          teamMemberships: { create: { teamId: input.teamId, role: input.role } },
        },
      })
    : await tx.user.create({
        data: {
          name: input.name,
          phone: input.phone,
          email: input.email,
          normalizedPhone,
          normalizedEmail,
          languagePreference: input.language,
          passwordCredential: { create: { passwordHash } },
          teamMemberships: { create: { teamId: input.teamId, role: input.role } },
        },
      });

  if (input.role === 'parent') {
    await Promise.all(
      input.players.map((player) =>
        tx.player.create({
          data: {
            teamId: input.teamId,
            name: player.name,
            age: player.age,
            parents: { create: { userId: user.id, relationship: 'parent' } },
          },
        }),
      ),
    );
  }

  return { user, reactivating };
}
