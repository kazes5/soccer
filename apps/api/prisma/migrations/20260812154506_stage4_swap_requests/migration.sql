-- CreateEnum
CREATE TYPE "SwapRequestStatus" AS ENUM ('pending', 'accepted', 'declined', 'expired', 'cancelled');

-- AlterEnum
ALTER TYPE "ScheduledTaskType" ADD VALUE 'swap_expiry';

-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN     "actor_id" TEXT;

-- CreateTable
CREATE TABLE "swap_requests" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "requesting_user_id" TEXT NOT NULL,
    "current_holder_id" TEXT NOT NULL,
    "status" "SwapRequestStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "swap_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Partial unique index, not expressible in schema.prisma's DSL (see the
-- SwapRequest model's doc comment): guarantees at most one *pending* swap
-- request can ever exist per shift at the database level, independent of
-- and in addition to the application-level Shift.status CAS guard.
CREATE UNIQUE INDEX "swap_requests_pending_shift_unique" ON "swap_requests"("shift_id") WHERE "status" = 'pending';

-- CreateIndex
CREATE INDEX "swap_requests_shift_id_idx" ON "swap_requests"("shift_id");

-- CreateIndex
CREATE INDEX "swap_requests_team_id_status_idx" ON "swap_requests"("team_id", "status");

-- CreateIndex
CREATE INDEX "swap_requests_requesting_user_id_idx" ON "swap_requests"("requesting_user_id");

-- CreateIndex
CREATE INDEX "swap_requests_current_holder_id_idx" ON "swap_requests"("current_holder_id");

-- AddForeignKey
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_requesting_user_id_fkey" FOREIGN KEY ("requesting_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_requests" ADD CONSTRAINT "swap_requests_current_holder_id_fkey" FOREIGN KEY ("current_holder_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
