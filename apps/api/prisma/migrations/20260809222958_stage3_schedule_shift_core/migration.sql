-- CreateEnum
CREATE TYPE "CollectionPointType" AS ENUM ('pickup', 'dropoff', 'both');

-- CreateEnum
CREATE TYPE "ShiftDirection" AS ENUM ('to_practice', 'from_practice');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('scheduled', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('open', 'claimed', 'pending_swap');

-- CreateTable
CREATE TABLE "collection_points" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "gps_lat" DECIMAL(10,8),
    "gps_lng" DECIMAL(11,8),
    "type" "CollectionPointType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_templates" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "recurrence_rule" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "default_time" TEXT NOT NULL,
    "default_field_location" TEXT NOT NULL,
    "horizon_weeks" INTEGER NOT NULL DEFAULT 8,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_template_collection_points" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "point_id" TEXT NOT NULL,

    CONSTRAINT "schedule_template_collection_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_sessions" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "template_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "field_location" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_point_assignments" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "point_id" TEXT NOT NULL,
    "direction" "ShiftDirection" NOT NULL,
    "player_ids" TEXT[],

    CONSTRAINT "session_point_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "point_id" TEXT NOT NULL,
    "direction" "ShiftDirection" NOT NULL,
    "assigned_user_id" TEXT,
    "status" "ShiftStatus" NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collection_points_team_id_idx" ON "collection_points"("team_id");

-- CreateIndex
CREATE INDEX "schedule_templates_team_id_idx" ON "schedule_templates"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_template_collection_points_template_id_point_id_key" ON "schedule_template_collection_points"("template_id", "point_id");

-- CreateIndex
CREATE INDEX "practice_sessions_team_id_starts_at_idx" ON "practice_sessions"("team_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "practice_sessions_template_id_starts_at_key" ON "practice_sessions"("template_id", "starts_at");

-- CreateIndex
CREATE INDEX "session_point_assignments_point_id_idx" ON "session_point_assignments"("point_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_point_assignments_session_id_point_id_direction_key" ON "session_point_assignments"("session_id", "point_id", "direction");

-- CreateIndex
CREATE INDEX "shifts_point_id_idx" ON "shifts"("point_id");

-- CreateIndex
CREATE INDEX "shifts_assigned_user_id_idx" ON "shifts"("assigned_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_session_id_point_id_direction_key" ON "shifts"("session_id", "point_id", "direction");

-- AddForeignKey
ALTER TABLE "collection_points" ADD CONSTRAINT "collection_points_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_template_collection_points" ADD CONSTRAINT "schedule_template_collection_points_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "schedule_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_template_collection_points" ADD CONSTRAINT "schedule_template_collection_points_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "collection_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "schedule_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_point_assignments" ADD CONSTRAINT "session_point_assignments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "practice_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_point_assignments" ADD CONSTRAINT "session_point_assignments_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "collection_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "practice_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "collection_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
