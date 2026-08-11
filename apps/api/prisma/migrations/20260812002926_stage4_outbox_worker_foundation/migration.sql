-- CreateEnum
CREATE TYPE "RecipientScope" AS ENUM ('team_broadcast', 'participants', 'self');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('normal', 'emergency');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('in_app', 'push', 'sms', 'email');

-- CreateEnum
CREATE TYPE "ScheduledTaskType" AS ENUM ('reminder', 'escalation');

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'normal',
    "recipient_scope" "RecipientScope" NOT NULL,
    "participant_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "self_user_id" TEXT,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notifications" (
    "id" TEXT NOT NULL,
    "outbox_event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'normal',
    "payload" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "user_notification_id" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "type" "ScheduledTaskType" NOT NULL,
    "payload" JSONB NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_processed_at_idx" ON "outbox_events"("processed_at");

-- CreateIndex
CREATE INDEX "outbox_events_team_id_created_at_idx" ON "outbox_events"("team_id", "created_at");

-- CreateIndex
CREATE INDEX "user_notifications_user_id_team_id_created_at_idx" ON "user_notifications"("user_id", "team_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_notifications_outbox_event_id_user_id_key" ON "user_notifications"("outbox_event_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_user_notification_id_channel_key" ON "notification_deliveries"("user_notification_id", "channel");

-- CreateIndex
CREATE INDEX "scheduled_tasks_completed_at_cancelled_at_run_at_idx" ON "scheduled_tasks"("completed_at", "cancelled_at", "run_at");

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_outbox_event_id_fkey" FOREIGN KEY ("outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_notification_id_fkey" FOREIGN KEY ("user_notification_id") REFERENCES "user_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
