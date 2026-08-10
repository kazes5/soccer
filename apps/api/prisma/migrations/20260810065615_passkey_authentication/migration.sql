/*
  Warnings:

  - You are about to drop the `otp_challenges` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "WebauthnChallengeType" AS ENUM ('registration', 'authentication');

-- DropForeignKey
ALTER TABLE "otp_challenges" DROP CONSTRAINT "otp_challenges_user_id_fkey";

-- DropTable
DROP TABLE "otp_challenges";

-- DropEnum
DROP TYPE "OtpChannel";

-- CreateTable
CREATE TABLE "passkeys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL,
    "transports" TEXT[],
    "device_type" TEXT NOT NULL,
    "backed_up" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "WebauthnChallengeType" NOT NULL,
    "challenge" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passkeys_credential_id_key" ON "passkeys"("credential_id");

-- CreateIndex
CREATE INDEX "passkeys_user_id_idx" ON "passkeys"("user_id");

-- CreateIndex
CREATE INDEX "webauthn_challenges_user_id_idx" ON "webauthn_challenges"("user_id");

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
