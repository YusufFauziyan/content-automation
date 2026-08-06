-- AlterEnum
ALTER TYPE "WorkflowStepName" ADD VALUE 'RENDER_PLAN';

-- CreateTable
CREATE TABLE "rendered_videos" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "workflow_run_id" UUID,
    "file_name" VARCHAR(255) NOT NULL,
    "relative_path" VARCHAR(1000) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "fps" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "video_codec" VARCHAR(64) NOT NULL,
    "audio_codec" VARCHAR(64) NOT NULL,
    "render_duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rendered_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rendered_videos_workflow_run_id_idx" ON "rendered_videos"("workflow_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "rendered_videos_content_id_workflow_run_id_key" ON "rendered_videos"("content_id", "workflow_run_id");

-- AddForeignKey
ALTER TABLE "rendered_videos" ADD CONSTRAINT "rendered_videos_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
