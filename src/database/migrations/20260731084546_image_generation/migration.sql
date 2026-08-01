-- AlterEnum
ALTER TYPE "WorkflowStepName" ADD VALUE 'VISUAL_PLAN';

-- AlterTable
ALTER TABLE "contents" ADD COLUMN     "visual_plan" JSONB;

-- CreateTable
CREATE TABLE "scene_images" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "workflow_run_id" UUID,
    "scene_number" INTEGER NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "relative_path" VARCHAR(1000) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "generation_duration_ms" INTEGER NOT NULL,
    "combo" VARCHAR(128) NOT NULL,
    "prompt" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scene_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scene_images_workflow_run_id_idx" ON "scene_images"("workflow_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "scene_images_content_id_scene_number_key" ON "scene_images"("content_id", "scene_number");

-- AddForeignKey
ALTER TABLE "scene_images" ADD CONSTRAINT "scene_images_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
