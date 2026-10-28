-- CreateTable
CREATE TABLE "XRule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'recent',
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 120,
    "maxPosts" INTEGER NOT NULL DEFAULT 20,
    "autoCards" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "nextToken" TEXT,
    "sinceId" TEXT,
    "windowNewestId" TEXT,
    "archiveComplete" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XCollectionRun" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "page" JSONB,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'CREATED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "token" UUID,
    "leaseUntil" TIMESTAMP(3),
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "added" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "XCollectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XPost" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "quotedText" TEXT NOT NULL DEFAULT '',
    "quoteUrl" TEXT,
    "url" TEXT NOT NULL,
    "authorId" TEXT,
    "authorHandle" TEXT,
    "authorName" TEXT,
    "conversationId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'und',
    "publishedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origin" TEXT NOT NULL,
    "coverage" TEXT NOT NULL,
    "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "utilitySignal" INTEGER NOT NULL DEFAULT 0,
    "engagement" DOUBLE PRECISION,
    "momentum" DOUBLE PRECISION,
    "novelty" DOUBLE PRECISION,
    "indexStatus" "ProcessingStatus" NOT NULL DEFAULT 'CREATED',
    "indexAttempts" INTEGER NOT NULL DEFAULT 0,
    "indexToken" UUID,
    "indexLeaseUntil" TIMESTAMP(3),
    "indexError" TEXT,
    "embeddingProvider" TEXT,
    "embeddingModel" TEXT,
    "vector" vector(1536),
    "jobId" UUID,

    CONSTRAINT "XPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XCapture" (
    "id" UUID NOT NULL,
    "postId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XObservation" (
    "id" UUID NOT NULL,
    "postId" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "engagement" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XUsageDay" (
    "day" DATE NOT NULL,
    "readsReserved" INTEGER NOT NULL DEFAULT 0,
    "cardsReserved" INTEGER NOT NULL DEFAULT 0,
    "embeddingsReserved" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "XUsageDay_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "XAnswer" (
    "id" UUID NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "XCollectionRun_status_leaseUntil_idx" ON "XCollectionRun"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "XPost_jobId_key" ON "XPost"("jobId");

-- CreateIndex
CREATE INDEX "XPost_capturedAt_id_idx" ON "XPost"("capturedAt", "id");

-- CreateIndex
CREATE INDEX "XPost_publishedAt_id_idx" ON "XPost"("publishedAt", "id");

-- CreateIndex
CREATE INDEX "XPost_indexStatus_indexLeaseUntil_idx" ON "XPost"("indexStatus", "indexLeaseUntil");

-- CreateIndex
CREATE INDEX "XPost_utilitySignal_id_idx" ON "XPost"("utilitySignal", "id");

-- CreateIndex
CREATE INDEX "XPost_engagement_id_idx" ON "XPost"("engagement", "id");

-- CreateIndex
CREATE INDEX "XPost_momentum_id_idx" ON "XPost"("momentum", "id");

-- CreateIndex
CREATE UNIQUE INDEX "XCapture_postId_contentHash_origin_key" ON "XCapture"("postId", "contentHash", "origin");

-- CreateIndex
CREATE INDEX "XObservation_postId_capturedAt_idx" ON "XObservation"("postId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "XAnswer_cacheKey_key" ON "XAnswer"("cacheKey");

-- AddForeignKey
ALTER TABLE "XCollectionRun" ADD CONSTRAINT "XCollectionRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "XRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XPost" ADD CONSTRAINT "XPost_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XCapture" ADD CONSTRAINT "XCapture_postId_fkey" FOREIGN KEY ("postId") REFERENCES "XPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XObservation" ADD CONSTRAINT "XObservation_postId_fkey" FOREIGN KEY ("postId") REFERENCES "XPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Search projections are deliberately separate from immutable captures.
CREATE INDEX "XPost_text_search_idx" ON "XPost" USING GIN (to_tsvector('simple', text || ' ' || "quotedText"));
CREATE INDEX "XPost_topics_idx" ON "XPost" USING GIN (topics);
CREATE INDEX "XPost_vector_idx" ON "XPost" USING hnsw (vector vector_cosine_ops);
ALTER TABLE "XPost" ADD CONSTRAINT "XPost_id_check" CHECK (id ~ '^[0-9]{1,25}$');
ALTER TABLE "XPost" ADD CONSTRAINT "XPost_utility_check" CHECK ("utilitySignal" BETWEEN 0 AND 3);
ALTER TABLE "XUsageDay" ADD CONSTRAINT "XUsageDay_nonnegative" CHECK ("readsReserved">=0 AND "cardsReserved">=0 AND "embeddingsReserved">=0);
ALTER TABLE "XRule" ADD CONSTRAINT "XRule_limits" CHECK ("maxPosts" BETWEEN 10 AND 100 AND "intervalMinutes" BETWEEN 30 AND 10080 AND mode IN ('recent','archive'));
