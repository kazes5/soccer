-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('practice', 'game');

-- AlterTable
ALTER TABLE "practice_sessions" ADD COLUMN     "kind" "SessionKind" NOT NULL DEFAULT 'practice',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "coach_message_import_enabled" BOOLEAN NOT NULL DEFAULT true;
