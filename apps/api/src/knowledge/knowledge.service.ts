import { Prisma } from '@prisma/client';
import { Filters, SearchInput } from '@knowledge/shared';
import { AIProvider } from '@knowledge/domain';
import { Database } from '../infrastructure/database';
import { validateEmbedding } from '../ai/providers';
const listInclude = {
  content: {
    select: {
      sourceId: true,
      originalUrl: true,
      author: true,
      publishedAt: true,
      capturedAt: true,
    },
  },
  topics: true,
  concepts: true,
} as const;
export class KnowledgeService {
  constructor(
    private readonly db: Database,
    private readonly ai: AIProvider,
  ) {}
  list(filters: Filters) {
    const where: Prisma.KnowledgeCardWhereInput = {
      content: {
        sourceId: filters.source,
        capturedAt: {
          gte: filters.from ? new Date(filters.from) : undefined,
          lte: filters.to ? new Date(filters.to) : undefined,
        },
      },
      topics: filters.topic
        ? { some: { name: { equals: filters.topic, mode: 'insensitive' } } }
        : undefined,
      globalScore: { gte: filters.minScore },
    };
    return this.db.knowledgeCard.findMany({
      where,
      include: listInclude,
      orderBy: { createdAt: 'desc' },
      take: 24,
      skip: (filters.page - 1) * 24,
    });
  }
  async detail(id: string) {
    const card = await this.db.knowledgeCard.findUnique({
      where: { id },
      include: {
        content: { include: { references: { orderBy: { capturedAt: 'desc' } } } },
        topics: true,
        concepts: true,
        revisions: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            analysis: true,
            provider: true,
            model: true,
            promptVersion: true,
            processingVersion: true,
            createdAt: true,
            globalScore: true,
          },
        },
      },
    });
    if (!card) return null;
    const latestJob = await this.db.processingJob.findFirst({
      where: { contentId: card.contentId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, errorCode: true, errorMessage: true },
    });
    return {
      ...card,
      processingStatus: latestJob?.status || 'COMPLETED',
      analysis: card.revisions.find((r) => r.id === card.activeRevisionId)?.analysis || null,
    };
  }
  topics() {
    return this.db.topic.findMany({ orderBy: { name: 'asc' } });
  }
  async dashboard() {
    const [total, newResources, processing, failed, bySource, best, latest] = await Promise.all([
      this.db.content.count(),
      this.db.content.count({
        where: { capturedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      }),
      this.db.processingJob.count({ where: { status: { notIn: ['COMPLETED', 'FAILED'] } } }),
      this.db.processingJob.count({ where: { status: 'FAILED' } }),
      this.db.content.groupBy({ by: ['sourceId'], _count: true }),
      this.db.knowledgeCard.findMany({
        orderBy: { globalScore: 'desc' },
        take: 5,
        include: listInclude,
      }),
      this.db.knowledgeCard.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: listInclude,
      }),
    ]);
    return {
      total,
      newResources,
      processing,
      failed,
      bySource,
      best,
      latest,
      provider: this.ai.name,
      embeddingModel: this.ai.embeddingModel,
    };
  }
  async search(input: SearchInput) {
    const vector =
      input.mode === 'text' ? null : validateEmbedding(await this.ai.createEmbedding(input.q));
    // All user data is bound as parameters, including vectors and filters.
    const params: unknown[] = [
      JSON.stringify(vector),
      input.q,
      this.ai.name,
      this.ai.embeddingModel,
      input.source || null,
      input.topic?.toLowerCase() || null,
      input.from || null,
      input.to || null,
      input.minScore ?? null,
    ];
    const score =
      input.mode === 'text'
        ? 'text_rank'
        : input.mode === 'semantic'
          ? 'semantic_score'
          : '(1.0/(60+text_position)+1.0/(60+semantic_position))';
    const sql = [
      'WITH candidates AS (SELECT k.id,',
      "ts_rank_cd(to_tsvector('simple',k.title || ' ' || k.summary),plainto_tsquery('simple',$2))::float8 AS text_rank,",
      "CASE WHEN $1='null' OR e.id IS NULL THEN 0 ELSE 1-(e.vector <=> $1::vector) END::float8 AS semantic_score",
      'FROM "KnowledgeCard" k JOIN "Content" c ON c.id=k."contentId"',
      'LEFT JOIN "Embedding" e ON e."revisionId"=k."activeRevisionId" AND e.provider=$3 AND e.model=$4',
      'WHERE ($5::text IS NULL OR c."sourceId"=$5) AND ($6::text IS NULL OR EXISTS(SELECT 1 FROM "_KnowledgeCardToTopic" kt JOIN "Topic" t ON t.id=kt."B" WHERE kt."A"=k.id AND t.name=$6))',
      'AND ($7::timestamptz IS NULL OR c."capturedAt">=$7::timestamptz) AND ($8::timestamptz IS NULL OR c."capturedAt"<=$8::timestamptz)',
      'AND ($9::float8 IS NULL OR k."globalScore">=$9::float8)',
      input.mode === 'text'
        ? "AND to_tsvector('simple',k.title || ' ' || k.summary) @@ plainto_tsquery('simple',$2)"
        : 'AND e.id IS NOT NULL',
      '), ranked AS (SELECT *,rank() OVER(ORDER BY text_rank DESC) AS text_position,rank() OVER(ORDER BY semantic_score DESC) AS semantic_position FROM candidates)',
      'SELECT id, semantic_score AS similarity, text_rank AS "textRank", ' +
        score +
        ' AS rank FROM ranked ORDER BY rank DESC,id LIMIT 30',
    ].join(' ');
    const hits = await this.db.$queryRawUnsafe<
      { id: string; similarity: number; textRank: number; rank: number }[]
    >(sql, ...params);
    const cards = await this.db.knowledgeCard.findMany({
      where: { id: { in: hits.map((h) => h.id) } },
      include: listInclude,
    });
    return hits.map((h) => ({
      ...cards.find((c) => c.id === h.id)!,
      similarity: h.similarity,
      textRank: h.textRank,
      rank: h.rank,
    }));
  }
}
