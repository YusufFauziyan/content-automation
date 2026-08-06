-- CreateTable
CREATE TABLE "schedules" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "interval_minutes" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "runs_started" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedules_enabled_next_run_at_idx" ON "schedules"("enabled", "next_run_at");
