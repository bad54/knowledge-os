import { ConflictException, NotFoundException } from '@nestjs/common';
import { z } from '@knowledge/shared';
import type { AIProvider } from '@knowledge/domain';
import type { XOverview } from '@knowledge/shared';
import { Database } from '../infrastructure/database';
import { AppConfig } from '../config';
import { normalizeV12Post } from './client';
import { XPostStore, utcDay } from './store';
import { XSearch } from './search';
export class XService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly ai: AIProvider,
    private readonly store: XPostStore,
    readonly search: XSearch,
  ) {}
  async overview(): Promise<XOverview> {
    const [posts, indexed, failedIndex, rules, runs, usage, topics, answers] = await Promise.all([
      this.db.xPost.count(),
      this.db.xPost.count({
        where: {
          indexStatus: 'COMPLETED',
          embeddingProvider: this.ai.name,
          embeddingModel: this.ai.embeddingModel,
        },
      }),
      this.db.xPost.count({ where: { indexStatus: 'FAILED' } }),
      this.db.xRule.findMany({ orderBy: { createdAt: 'asc' } }),
      this.db.xCollectionRun.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      this.db.xUsageDay.findUnique({ where: { day: utcDay() } }),
      this.db.$queryRawUnsafe<{ topic: string }[]>(
        'SELECT DISTINCT unnest(topics) AS topic FROM "XPost" ORDER BY topic LIMIT 100',
      ),
      this.db.xAnswer.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, question: true, mode: true, createdAt: true },
      }),
    ]);
    return {
      connection: {
        xReady: !!this.config.X_BEARER_TOKEN,
        aiReady: this.config.AI_PROVIDER === 'openai',
        provider: this.ai.name,
        embeddingModel: this.ai.embeddingModel,
      },
      limits: {
        readsPerDay: this.config.X_DAILY_READ_LIMIT,
        readsReservedToday: usage?.readsReserved || 0,
        autoCardsPerDay: this.config.X_AUTO_CARDS_PER_DAY,
        cardsReservedToday: usage?.cardsReserved || 0,
        embeddingsPerDay: this.config.X_EMBEDDINGS_PER_DAY,
      },
      counts: { posts, indexed, failedIndex },
      topics: topics.map((r) => r.topic),
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        query: r.query,
        topic: r.topic,
        mode: r.mode as 'recent' | 'archive',
        startTime: r.startTime?.toISOString() || null,
        endTime: r.endTime?.toISOString() || null,
        enabled: r.enabled,
        intervalMinutes: r.intervalMinutes,
        maxPosts: r.maxPosts,
        autoCards: r.autoCards,
        nextRunAt: r.nextRunAt?.toISOString() || null,
        hasNextPage: !!r.nextToken,
        archiveComplete: r.archiveComplete,
      })),
      runs: runs.map((r) => ({
        id: r.id,
        ruleId: r.ruleId,
        status: r.status,
        fetched: r.fetched,
        added: r.added,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
      })),
      answers: answers.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    };
  }
  async importPosts(body: unknown) {
    const rows = z
      .object({ posts: z.array(z.unknown()).min(1).max(100), autoCards: z.boolean().default(true) })
      .strict()
      .parse(body);
    const errors: { index: number; message: string }[] = [];
    const posts = rows.posts.flatMap((raw, index) => {
      try {
        return [normalizeV12Post(raw)];
      } catch {
        errors.push({
          index,
          message: 'Publication ignorée : identifiant X ou texte absent/invalide.',
        });
        return [];
      }
    });
    const added = await this.db.$transaction(
      async (tx) => {
        const count = await this.store.save(tx, posts);
        if (rows.autoCards)
          await this.store.selectCards(
            tx,
            posts.map((p) => p.id),
          );
        return count;
      },
      { timeout: 30000 },
    );
    return {
      received: rows.posts.length,
      added,
      duplicates: posts.length - added,
      ignored: errors.length,
      errors,
    };
  }
  async detail(id: string) {
    const post = (await this.search.hydrate([id]))[0];
    if (!post) throw new NotFoundException('Publication X introuvable');
    return post;
  }
  async createCard(id: string) {
    if (!(await this.db.xPost.findUnique({ where: { id }, select: { id: true } })))
      throw new NotFoundException('Publication X introuvable');
    const jobId = await this.db.$transaction((tx) => this.store.createCard(tx, id));
    if (!jobId)
      throw new ConflictException(
        'Texte insuffisant ou plafond quotidien de fiches atteint. Le corpus reste disponible.',
      );
    return { jobId };
  }
  async retryIndex(id: string) {
    const result = await this.db.xPost.updateMany({
      where: { id, indexStatus: 'FAILED' },
      data: {
        indexStatus: 'CREATED',
        indexAttempts: 0,
        indexError: null,
        indexLeaseUntil: null,
        indexToken: null,
      },
    });
    if (!result.count)
      throw new ConflictException('Seule une indexation échouée peut être relancée.');
    return { id, status: 'CREATED' };
  }
}
