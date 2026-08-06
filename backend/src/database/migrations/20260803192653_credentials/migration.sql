-- CreateEnum
CREATE TYPE "CredentialPlatform" AS ENUM ('TIKTOK', 'INSTAGRAM', 'THREADS', 'YOUTUBE');

-- CreateTable
CREATE TABLE "credentials" (
    "id" UUID NOT NULL,
    "platform" "CredentialPlatform" NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "secret" TEXT NOT NULL,
    "iv" VARCHAR(64) NOT NULL,
    "tag" VARCHAR(64) NOT NULL,
    "field_names" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credentials_platform_label_key" ON "credentials"("platform", "label");
