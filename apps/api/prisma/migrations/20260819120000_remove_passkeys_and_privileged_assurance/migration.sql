-- Passkeys/WebAuthn are removed entirely in favor of password-only auth for
-- both parents and admins (see CLAUDE.md's 2026-08-19 revision note). v1
-- (passkey-onboarding) invites can never be completed anymore, since their
-- accept + passkey-registration routes are gone — deleted here rather than
-- left as permanently-dead rows blocking onboarding_code_hash from becoming
-- NOT NULL (the only invite shape left is the split link-token + numeric-code
-- flow, which always sets it).
DELETE FROM "invites" WHERE "onboarding_code_hash" IS NULL;

-- DropForeignKey
ALTER TABLE "passkeys" DROP CONSTRAINT "passkeys_user_id_fkey";
ALTER TABLE "webauthn_challenges" DROP CONSTRAINT "webauthn_challenges_user_id_fkey";

-- DropTable
DROP TABLE "passkeys";
DROP TABLE "webauthn_challenges";

-- AlterTable: sessions no longer distinguish an auth method or track
-- freshness for a "privileged assurance" step-up — password + role checks
-- are now the whole story.
ALTER TABLE "sessions" DROP COLUMN "auth_method";
ALTER TABLE "sessions" DROP COLUMN "authenticated_at";

-- AlterTable: invites no longer have a legacy v1 shape.
ALTER TABLE "invites" DROP COLUMN "code_version";
ALTER TABLE "invites" ALTER COLUMN "onboarding_code_hash" SET NOT NULL;

-- DropEnum
DROP TYPE "AuthMethod";
DROP TYPE "WebauthnChallengeType";
