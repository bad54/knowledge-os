-- CreateEnum
CREATE TYPE "WatchRunStatus" AS ENUM ('CREATED', 'FETCHING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "WatchCandidateStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED');

-- AlterTable
ALTER TABLE "ProcessingJob" ADD COLUMN     "discovery" JSONB;

-- CreateTable
CREATE TABLE "WatchSettings" (
    "id" TEXT NOT NULL DEFAULT 'personal',
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includeKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dailyLimit" INTEGER NOT NULL DEFAULT 5,
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchSource" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSuccessAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchRun" (
    "id" UUID NOT NULL,
    "status" "WatchRunStatus" NOT NULL DEFAULT 'CREATED',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "settingsSnapshot" JSONB,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "added" INTEGER NOT NULL DEFAULT 0,
    "filtered" INTEGER NOT NULL DEFAULT 0,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "token" UUID,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WatchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchCandidate" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "author" TEXT,
    "language" TEXT NOT NULL DEFAULT 'und',
    "publishedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feedSnapshot" JSONB NOT NULL,
    "selectionScore" DOUBLE PRECISION NOT NULL,
    "reasons" TEXT[],
    "rankingVersion" TEXT NOT NULL,
    "status" "WatchCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "decision" TEXT,
    "decidedAt" TIMESTAMP(3),
    "jobId" UUID,

    CONSTRAINT "WatchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchSource_url_key" ON "WatchSource"("url");

-- CreateIndex
CREATE INDEX "WatchRun_status_leaseUntil_idx" ON "WatchRun"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "WatchCandidate_url_key" ON "WatchCandidate"("url");

-- CreateIndex
CREATE UNIQUE INDEX "WatchCandidate_jobId_key" ON "WatchCandidate"("jobId");

-- CreateIndex
CREATE INDEX "WatchCandidate_status_discoveredAt_idx" ON "WatchCandidate"("status", "discoveredAt");

-- AddForeignKey
ALTER TABLE "WatchCandidate" ADD CONSTRAINT "WatchCandidate_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "WatchSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchCandidate" ADD CONSTRAINT "WatchCandidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain invariants also apply to non-API writers.
ALTER TABLE "WatchSettings" ADD CONSTRAINT "WatchSettings_personal_check" CHECK ("id" = 'personal');
ALTER TABLE "WatchSettings" ADD CONSTRAINT "WatchSettings_dailyLimit_check" CHECK ("dailyLimit" BETWEEN 1 AND 20);
ALTER TABLE "WatchCandidate" ADD CONSTRAINT "WatchCandidate_selectionScore_check" CHECK ("selectionScore" BETWEEN 0 AND 100);
ALTER TABLE "WatchRun" ADD CONSTRAINT "WatchRun_counts_check" CHECK ("scanned" >= 0 AND "added" >= 0 AND "filtered" >= 0);

