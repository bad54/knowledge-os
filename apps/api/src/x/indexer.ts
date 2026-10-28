import { randomUUID } from 'node:crypto';
import { AIProvider } from '@knowledge/domain';
import { Database } from '../infrastructure/database';
import { validateEmbedding } from '../ai/providers';
import { logger } from '../infrastructure/logger';
import { AppConfig } from '../config';
import { usageDay, xLock } from './store';
export class XIndexer {
  constructor(
    private readonly db: Database,
    private readonly ai: AIProvider,
    private readonly config: AppConfig,
  ) {}
  async runOnce() {
    const token = randomUUID();
    const post = await this.db.$transaction(async (tx) => {
      await xLock(tx, 'index-budget');
      await tx.xPost.updateMany({
        where: {
          indexStatus: 'FETCHING',
          indexAttempts: { gte: 5 },
          indexLeaseUntil: { lt: new Date() },
        },
        data: {
          indexStatus: 'FAILED',
          indexToken: null,
          indexLeaseUntil: null,
          indexError: 'Indexation interrompue plusieurs fois. Réessayez depuis le corpus.',
        },
      });
      const usage = this.ai.name === 'openai' ? await usageDay(tx) : null;
      if (usage && usage.embeddingsReserved >= this.config.X_EMBEDDINGS_PER_DAY) return null;
      const ids = await tx.$queryRawUnsafe<{ id: string }[]>(
        `UPDATE "XPost" p SET "indexStatus"='FETCHING', "indexAttempts"="indexAttempts"+1, "indexToken"=$1::uuid, "indexLeaseUntil"=now()+interval '3 minutes'
        WHERE p.id=(SELECT id FROM "XPost" WHERE "indexStatus"='CREATED' OR ("indexStatus"='FETCHING' AND "indexLeaseUntil"<now() AND "indexAttempts"<5)
        OR ("indexStatus"='COMPLETED' AND ("embeddingProvider"<>$2 OR "embeddingModel"<>$3)) ORDER BY "capturedAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`,
        token,
        this.ai.name,
        this.ai.embeddingModel,
      );
      if (!ids[0]) return null;
      if (usage)
        await tx.xUsageDay.update({
          where: { day: usage.day },
          data: { embeddingsReserved: { increment: 1 } },
        });
      return tx.xPost.findUniqueOrThrow({ where: { id: ids[0].id } });
    });
    if (!post) return false;
    try {
      const vector = validateEmbedding(
        await this.ai.createEmbedding(post.text + '\n' + post.quotedText),
      );
      await this.db.$transaction(async (tx) => {
        const result = await tx.xPost.updateMany({
          where: { id: post.id, indexToken: token, indexStatus: 'FETCHING' },
          data: {
            indexStatus: 'COMPLETED',
            embeddingProvider: this.ai.name,
            embeddingModel: this.ai.embeddingModel,
            indexError: null,
            indexToken: null,
            indexLeaseUntil: null,
          },
        });
        if (!result.count) throw new Error('X index lease lost');
        const encoded = '[' + vector.join(',') + ']';
        const nearest = await tx.$queryRawUnsafe<{ similarity: number }[]>(
          `SELECT 1-(vector <=> $1::vector) AS similarity FROM "XPost" WHERE id<>$2 AND vector IS NOT NULL AND "embeddingProvider"=$3 AND "embeddingModel"=$4 ORDER BY vector <=> $1::vector LIMIT 1`,
          encoded,
          post.id,
          this.ai.name,
          this.ai.embeddingModel,
        );
        await tx.$executeRawUnsafe(
          'UPDATE "XPost" SET vector=$1::vector, novelty=$2 WHERE id=$3',
          encoded,
          nearest[0] ? Math.max(0, Math.min(1, 1 - nearest[0].similarity)) : null,
          post.id,
        );
      });
      logger.info({ event: 'x.indexed', postId: post.id, provider: this.ai.name });
    } catch {
      await this.db.xPost.updateMany({
        where: { id: post.id, indexToken: token },
        data: {
          indexStatus: 'FAILED',
          indexError: 'Indexation indisponible. Le texte reste conservé et recherchable.',
          indexToken: null,
          indexLeaseUntil: null,
        },
      });
      logger.error({ event: 'x.index_failed', postId: post.id });
    }
    return true;
  }
}
