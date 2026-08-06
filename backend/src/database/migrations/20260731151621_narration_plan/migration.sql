-- AlterEnum
ALTER TYPE "WorkflowStepName" ADD VALUE 'NARRATION_PLAN';

-- AlterTable
ALTER TABLE "contents" ADD COLUMN     "narration_plan" JSONB;
