-- CreateTable
CREATE TABLE "chat_request_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_ip" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_request_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_request_attempts_user_id_created_at_idx" ON "chat_request_attempts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_request_attempts_request_ip_created_at_idx" ON "chat_request_attempts"("request_ip", "created_at");

-- AddForeignKey
ALTER TABLE "chat_request_attempts" ADD CONSTRAINT "chat_request_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
