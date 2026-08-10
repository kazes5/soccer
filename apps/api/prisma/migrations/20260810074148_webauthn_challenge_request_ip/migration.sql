-- AlterTable
ALTER TABLE "webauthn_challenges" ADD COLUMN     "request_ip" TEXT;

-- CreateIndex
CREATE INDEX "webauthn_challenges_request_ip_created_at_idx" ON "webauthn_challenges"("request_ip", "created_at");
