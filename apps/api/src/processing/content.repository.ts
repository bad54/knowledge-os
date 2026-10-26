import { createHash, randomUUID } from 'node:crypto';
import { Content, Prisma, ProcessingJob } from '@prisma/client';
import {
  NormalizedContent,
  AnalysisResult,
  AIProvider,
  PIPELINE_VERSION,
  RawContent,
} from '@knowledge/domain';
import { globalScore } from '@knowledge/shared';
import { Database } from '../infrastructure/database';
import { canonicalUrl } from '../ingestion/safe-fetcher';
import { json } from './jobs.repository';
export function contentHash(text: string) {
  return createHash('sha256')
    .update(text.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .digest('hex');
}
export function normalized(content: Content): NormalizedContent {
  return {
    ...content,
    sourceType: content.sourceId as NormalizedContent['sourceType'],
    publishedAt: content.publishedAt?.toISOString() || null,
    capturedAt: content.capturedAt.toISOString(),
    metadata: content.metadata as NormalizedContent['metadata'],
  };
}
export class ContentRepository {
  constructor(private readonly db: Database) {}
  async capture(job: ProcessingJob, content: NormalizedContent, raw: RawContent) {
    const hash = contentHash(content.text);
    const key = content.externalId
      ? content.sourceType + ':' + content.externalId
      : content.originalUrl
        ? canonicalUrl(content.originalUrl)
        : null;
    return this.db.$transaction(
      async (tx) => {
        await this.fence(tx, job);
        for (const lock of [hash, key].filter((v): v is string => !!v).sort())
          await tx.$queryRawUnsafe(
            'SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
            lock,
          );
        let record = await tx.content.findFirst({
          where: { OR: [{ contentHash: hash }, ...(key ? [{ canonicalKey: key }] : [])] },
        });
        if (!record)
          record = await tx.content.create({
            data: {
              sourceId: content.sourceType,
              canonicalKey: key,
              contentHash: hash,
              externalId: content.externalId,
              originalUrl: content.originalUrl,
              title: content.title,
              author: content.author,
              publishedAt: content.publishedAt ? new Date(content.publishedAt) : null,
              capturedAt: new Date(content.capturedAt),
              text: content.text,
              language: content.language,
              metadata: json({
                ...content.metadata,
                ...(job.discovery ? { discovery: job.discovery } : {}),
              }),
              raw: json(raw.payload),
            },
          });
        await tx.sourceReference.create({
          data: {
            contentId: record.id,
            originalUrl: content.originalUrl,
            metadata: json({
              submittedTitle: content.title,
              sourceType: content.sourceType,
              ...(job.discovery ? { discovery: job.discovery } : {}),
            }),
          },
        });
        await tx.processingJob.update({ where: { id: job.id }, data: { contentId: record.id } });
        return record;
      },
      { timeout: 10000 },
    );
  }
  async fence(tx: Prisma.TransactionClient, job: ProcessingJob) {
    const result = await tx.processingJob.updateMany({
      where: { id: job.id, token: job.token },
      data: { leaseUntil: new Date(Date.now() + 180000) },
    });
    if (result.count !== 1) throw new Error('Processing lease lost');
  }
  async publish(
    job: ProcessingJob,
    content: Content,
    result: AnalysisResult,
    vector: number[],
    provider: AIProvider,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.fence(tx, job);
        await tx.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
          content.id,
        );
        const existing = await tx.knowledgeCard.findUnique({ where: { contentId: content.id } });
        if (existing && !job.reanalyze) {
          await tx.processingJob.update({
            where: { id: job.id },
            data: { status: 'COMPLETED', cardId: existing.id, token: null, leaseUntil: null },
          });
          return existing;
        }
        const a = result.analysis;
        const labels = (values: string[]) => [
          ...new Set(values.map((v) => v.normalize('NFKC').trim().toLowerCase()).filter(Boolean)),
        ];
        const data = {
          title: a.title,
          summary: a.summary,
          language: a.language,
          globalScore: globalScore(a),
          processingVersion: PIPELINE_VERSION,
          modelUsed: result.model,
          promptVersion: result.promptVersion,
        };
        const card = await tx.knowledgeCard.upsert({
          where: { contentId: content.id },
          create: { contentId: content.id, ...data },
          update: data,
        });
        await tx.knowledgeCard.update({
          where: { id: card.id },
          data: {
            topics: {
              set: [],
              connectOrCreate: labels(a.topics).map((name) => ({
                where: { name },
                create: { name },
              })),
            },
            concepts: {
              set: [],
              connectOrCreate: labels(a.concepts).map((name) => ({
                where: { name },
                create: { name },
              })),
            },
          },
        });
        const revision = await tx.cardAnalysis.create({
          data: {
            cardId: card.id,
            analysis: json(a),
            globalScore: globalScore(a),
            provider: provider.name,
            model: result.model,
            promptVersion: result.promptVersion,
            processingVersion: PIPELINE_VERSION,
            usage: json(result.usage),
          },
        });
        await tx.$executeRawUnsafe(
          'INSERT INTO "Embedding" (id,"revisionId",provider,model,vector) VALUES ($1::uuid,$2::uuid,$3,$4,$5::vector)',
          randomUUID(),
          revision.id,
          provider.name,
          provider.embeddingModel,
          JSON.stringify(vector),
        );
        await tx.knowledgeCard.update({
          where: { id: card.id },
          data: { activeRevisionId: revision.id },
        });
        await tx.processingJob.update({
          where: { id: job.id },
          data: {
            status: 'COMPLETED',
            cardId: card.id,
            token: null,
            leaseUntil: null,
            errorCode: null,
            errorMessage: null,
          },
        });
        return card;
      },
      { timeout: 15000 },
    );
  }
}
