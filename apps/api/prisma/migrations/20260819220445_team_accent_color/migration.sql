-- CreateEnum
CREATE TYPE "TeamAccentColor" AS ENUM ('green', 'blue', 'indigo', 'purple', 'fuchsia', 'slate');

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "primary_color" "TeamAccentColor";
