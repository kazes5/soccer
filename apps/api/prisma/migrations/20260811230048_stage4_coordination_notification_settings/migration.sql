-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('shift_changes', 'swaps', 'reminders', 'escalations', 'admin_changes');

-- DropIndex
DROP INDEX "notification_preferences_user_id_team_id_event_type_channel_key";

-- AlterTable
ALTER TABLE "notification_preferences" DROP COLUMN "event_type",
ADD COLUMN     "category" "NotificationCategory" NOT NULL;

-- CreateTable
CREATE TABLE "coordination_settings" (
    "team_id" TEXT NOT NULL,
    "swap_expiry_hours" INTEGER NOT NULL DEFAULT 24,
    "reminder_offset_minutes" INTEGER[] DEFAULT ARRAY[1440, 120]::INTEGER[],
    "escalation_lead_minutes" INTEGER NOT NULL DEFAULT 120,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coordination_settings_pkey" PRIMARY KEY ("team_id")
);

-- CreateTable
CREATE TABLE "team_notification_settings" (
    "team_id" TEXT NOT NULL,
    "quiet_hours_start" TEXT NOT NULL DEFAULT '22:00',
    "quiet_hours_end" TEXT NOT NULL DEFAULT '07:00',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_notification_settings_pkey" PRIMARY KEY ("team_id")
);

-- CreateTable
CREATE TABLE "member_notification_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "reminder_offset_minutes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_notification_settings_user_id_team_id_key" ON "member_notification_settings"("user_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_team_id_category_channel_key" ON "notification_preferences"("user_id", "team_id", "category", "channel");

-- AddForeignKey
ALTER TABLE "coordination_settings" ADD CONSTRAINT "coordination_settings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_notification_settings" ADD CONSTRAINT "team_notification_settings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_notification_settings" ADD CONSTRAINT "member_notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_notification_settings" ADD CONSTRAINT "member_notification_settings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
