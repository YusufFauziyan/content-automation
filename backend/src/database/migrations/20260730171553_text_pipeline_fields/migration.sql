-- AlterTable
ALTER TABLE "contents" ADD COLUMN     "hook" TEXT,
ADD COLUMN     "target_duration_seconds" INTEGER;

-- AlterTable
ALTER TABLE "topics" ADD COLUMN     "audience" VARCHAR(255),
ADD COLUMN     "category" VARCHAR(255);
