CREATE TYPE "SystemRole" AS ENUM ('system_admin');
CREATE TYPE "AuthMethod" AS ENUM ('bootstrap', 'password', 'passkey');

ALTER TABLE "users"
  ADD COLUMN "normalized_phone" TEXT,
  ADD COLUMN "normalized_email" TEXT,
  ADD COLUMN "system_role" "SystemRole";

UPDATE "users"
SET
  "normalized_phone" = CASE
    WHEN "phone" IS NULL THEN NULL
    ELSE regexp_replace("phone", '[^0-9+]', '', 'g')
  END,
  "normalized_email" = CASE
    WHEN "email" IS NULL THEN NULL
    ELSE lower(btrim("email"))
  END;

CREATE UNIQUE INDEX "users_normalized_phone_key" ON "users"("normalized_phone");
CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");

ALTER TABLE "invites"
  ADD COLUMN "code_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "onboarding_code_hash" TEXT,
  ADD COLUMN "failed_code_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_failed_code_at" TIMESTAMP(3),
  ADD COLUMN "verification_token_hash" TEXT,
  ADD COLUMN "verification_expires_at" TIMESTAMP(3);

ALTER TABLE "sessions"
  ADD COLUMN "auth_method" "AuthMethod" NOT NULL DEFAULT 'bootstrap',
  ADD COLUMN "authenticated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "password_credentials" (
  "user_id" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "password_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "password_reset_tokens" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "password_login_attempts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "identifier_hash" TEXT NOT NULL,
  "request_ip" TEXT NOT NULL,
  "succeeded" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "password_login_attempts_identifier_hash_created_at_idx" ON "password_login_attempts"("identifier_hash", "created_at");
CREATE INDEX "password_login_attempts_request_ip_created_at_idx" ON "password_login_attempts"("request_ip", "created_at");

CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

CREATE TABLE "system_audit_logs" (
  "id" TEXT NOT NULL,
  "actor_id" TEXT,
  "action_type" TEXT NOT NULL,
  "target_entity" TEXT NOT NULL,
  "target_id" TEXT,
  "team_id" TEXT,
  "before_state" JSONB,
  "after_state" JSONB,
  "source" "AuditSource" NOT NULL DEFAULT 'app',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_audit_logs_created_at_idx" ON "system_audit_logs"("created_at");
CREATE INDEX "system_audit_logs_actor_id_idx" ON "system_audit_logs"("actor_id");
CREATE INDEX "system_audit_logs_team_id_idx" ON "system_audit_logs"("team_id");
CREATE INDEX "system_audit_logs_action_type_idx" ON "system_audit_logs"("action_type");

ALTER TABLE "password_credentials"
  ADD CONSTRAINT "password_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "password_login_attempts"
  ADD CONSTRAINT "password_login_attempts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "system_audit_logs"
  ADD CONSTRAINT "system_audit_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
