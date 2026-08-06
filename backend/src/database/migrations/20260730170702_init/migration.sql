-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "TopicStatus" AS ENUM ('CANDIDATE', 'ACCEPTED', 'REJECTED_DUPLICATE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('PENDING', 'TOPIC_CREATED', 'SCRIPT_CREATED', 'SCENE_CREATED', 'IMAGES_CREATED', 'VOICE_CREATED', 'SUBTITLE_CREATED', 'VIDEO_CREATED', 'UPLOAD_COMPLETED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "WorkflowStepName" AS ENUM ('TOPIC', 'SCRIPT', 'SCENE', 'IMAGE', 'VOICE', 'SUBTITLE', 'COMPOSE', 'QUALITY_CHECK', 'UPLOAD', 'CLEANUP');

-- CreateEnum
CREATE TYPE "WorkflowStepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "UploadPlatform" AS ENUM ('TIKTOK');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'UPLOADING', 'UPLOADED', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "normalized_title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "language" VARCHAR(16) NOT NULL DEFAULT 'en',
    "status" "TopicStatus" NOT NULL DEFAULT 'CANDIDATE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_embeddings" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vector" vector(1536) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contents" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "script" TEXT NOT NULL,
    "caption" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thumbnail_prompt" TEXT,
    "scene_plan" JSONB,
    "language" VARCHAR(16) NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" UUID NOT NULL,
    "correlation_id" VARCHAR(64) NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'PENDING',
    "topic_id" UUID,
    "content_id" UUID,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "last_error" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_step_runs" (
    "id" UUID NOT NULL,
    "workflow_run_id" UUID NOT NULL,
    "step" "WorkflowStepName" NOT NULL,
    "status" "WorkflowStepStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "last_error" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_step_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "platform" "UploadPlatform" NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "external_url" VARCHAR(1000),
    "external_id" VARCHAR(255),
    "uploaded_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "last_error" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_entries" (
    "id" UUID NOT NULL,
    "correlation_id" VARCHAR(64) NOT NULL,
    "workflow_run_id" UUID,
    "level" "LogLevel" NOT NULL,
    "step" "WorkflowStepName",
    "source" VARCHAR(128),
    "message" TEXT NOT NULL,
    "duration_ms" INTEGER,
    "retry_count" INTEGER,
    "context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "topics_normalized_title_key" ON "topics"("normalized_title");

-- CreateIndex
CREATE INDEX "topics_status_created_at_idx" ON "topics"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "topic_embeddings_topic_id_key" ON "topic_embeddings"("topic_id");

-- CreateIndex
CREATE INDEX "contents_topic_id_idx" ON "contents"("topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_correlation_id_key" ON "workflow_runs"("correlation_id");

-- CreateIndex
CREATE INDEX "workflow_runs_status_created_at_idx" ON "workflow_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "workflow_step_runs_status_idx" ON "workflow_step_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_step_runs_workflow_run_id_step_key" ON "workflow_step_runs"("workflow_run_id", "step");

-- CreateIndex
CREATE INDEX "uploads_status_idx" ON "uploads"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_content_id_platform_key" ON "uploads"("content_id", "platform");

-- CreateIndex
CREATE INDEX "log_entries_correlation_id_created_at_idx" ON "log_entries"("correlation_id", "created_at");

-- CreateIndex
CREATE INDEX "log_entries_level_created_at_idx" ON "log_entries"("level", "created_at");

-- AddForeignKey
ALTER TABLE "topic_embeddings" ADD CONSTRAINT "topic_embeddings_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
