-- AlterTable
ALTER TABLE "invites" ADD COLUMN     "accepted_by_user_id" TEXT;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
