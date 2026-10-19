CREATE EXTENSION IF NOT EXISTS vector;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('CREATED', 'FETCHING', 'EXTRACTING', 'ANALYZING', 'EMBEDDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Content" (
    "id" UUID NOT NULL,
    "sourceId" TEXT NOT NULL,
    "canonicalKey" TEXT,
    "externalId" TEXT,
    "contentHash" TEXT NOT NULL,
    "originalUrl" TEXT,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "text" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "raw" JSONB NOT NULL,

    CONSTRAINT "Content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceReference" (
    "id" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "originalUrl" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "SourceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeCard" (
    "id" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "globalScore" DOUBLE PRECISION NOT NULL,
    "activeRevisionId" UUID,
    "processingVersion" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAnalysis" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "analysis" JSONB NOT NULL,
    "globalScore" DOUBLE PRECISION NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "processingVersion" TEXT NOT NULL,
    "usage" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concept" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Embedding" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vector" vector(1536) NOT NULL,

    CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" UUID NOT NULL,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'CREATED',
    "input" JSONB NOT NULL,
    "raw" JSONB,
    "contentId" UUID,
    "cardId" UUID,
    "reanalyze" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT true,
    "leaseUntil" TIMESTAMP(3),
    "token" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_KnowledgeCardToTopic" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_KnowledgeCardToTopic_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ConceptToKnowledgeCard" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_ConceptToKnowledgeCard_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Content_canonicalKey_key" ON "Content"("canonicalKey");

-- CreateIndex
CREATE UNIQUE INDEX "Content_contentHash_key" ON "Content"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCard_contentId_key" ON "KnowledgeCard"("contentId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCard_activeRevisionId_key" ON "KnowledgeCard"("activeRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_name_key" ON "Topic"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Concept_name_key" ON "Concept"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Embedding_revisionId_key" ON "Embedding"("revisionId");

-- CreateIndex
CREATE INDEX "ProcessingJob_status_leaseUntil_idx" ON "ProcessingJob"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "_KnowledgeCardToTopic_B_index" ON "_KnowledgeCardToTopic"("B");

-- CreateIndex
CREATE INDEX "_ConceptToKnowledgeCard_B_index" ON "_ConceptToKnowledgeCard"("B");

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceReference" ADD CONSTRAINT "SourceReference_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCard" ADD CONSTRAINT "KnowledgeCard_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAnalysis" ADD CONSTRAINT "CardAnalysis_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KnowledgeCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embedding" ADD CONSTRAINT "Embedding_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CardAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KnowledgeCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_KnowledgeCardToTopic" ADD CONSTRAINT "_KnowledgeCardToTopic_A_fkey" FOREIGN KEY ("A") REFERENCES "KnowledgeCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_KnowledgeCardToTopic" ADD CONSTRAINT "_KnowledgeCardToTopic_B_fkey" FOREIGN KEY ("B") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ConceptToKnowledgeCard" ADD CONSTRAINT "_ConceptToKnowledgeCard_A_fkey" FOREIGN KEY ("A") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ConceptToKnowledgeCard" ADD CONSTRAINT "_ConceptToKnowledgeCard_B_fkey" FOREIGN KEY ("B") REFERENCES "KnowledgeCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO "Source" (id,name) VALUES ('manual','Texte manuel'),('web','Web'),('youtube','YouTube'),('reddit','Reddit'),('x','X / Twitter');
ALTER TABLE "KnowledgeCard" ADD CONSTRAINT "card_score_range" CHECK ("globalScore" BETWEEN 0 AND 10);
CREATE INDEX "embedding_hnsw" ON "Embedding" USING hnsw (vector vector_cosine_ops);
CREATE INDEX "card_text_search" ON "KnowledgeCard" USING gin (to_tsvector('simple', title || ' ' || summary));
