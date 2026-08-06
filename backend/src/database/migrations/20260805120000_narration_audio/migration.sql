-- Metadata of the narration track, so a resumed run can hand the renderer an
-- audio file it did not produce itself. The bytes stay on disk and are still
-- deleted after publishing; only the knowledge of what they are survives.
CREATE TABLE "narration_audios" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "workflow_run_id" UUID,
    "file_name" VARCHAR(255) NOT NULL,
    "relative_path" VARCHAR(1000) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "voice" VARCHAR(128) NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "generation_duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "narration_audios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "narration_audios_content_id_workflow_run_id_key"
    ON "narration_audios"("content_id", "workflow_run_id");

CREATE INDEX "narration_audios_workflow_run_id_idx"
    ON "narration_audios"("workflow_run_id");

ALTER TABLE "narration_audios" ADD CONSTRAINT "narration_audios_content_id_fkey"
    FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
