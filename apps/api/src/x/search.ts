import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from '@knowledge/shared';
import { AIProvider } from '@knowledge/domain';
import type { XBrowseInput, XPostView } from '@knowledge/shared';
import { Database } from '../infrastructure/database';
import { validateEmbedding } from '../ai/providers';
const include = { job: { select: { id: true, status: true, cardId: true } } } as const;
type Row = Prisma.XPostGetPayload<{ include: typeof include }>;
export function xPostView(p: Row): XPostView {
  return {
    id: p.id,
    text: p.text,
    quotedText: p.quotedText,
    url: p.url,
    author:
      p.authorName ||
      p.authorHandle ||
      (p.authorId ? 'Compte X ' + p.authorId : 'Auteur non indiqué'),
    publishedAt: p.publishedAt?.toISOString() || null,
    capturedAt: p.capturedAt.toISOString(),
    origin: p.origin,
    language: p.language,
    topics: p.topics,
    links: p.links,
    coverage: p.coverage,
    utilitySignal: p.utilitySignal,
    engagement: p.engagement,
    momentum: p.momentum,
    novelty: p.novelty,
    indexStatus: p.indexStatus,
    job: p.job,
  };
}
const columns = {
  recent: 'capturedAt',
  oldest: 'publishedAt',
  engagement: 'engagement',
  momentum: 'momentum',
  useful: 'utilitySignal',
} as const;
const cursorSchema = z.object({
  id: z.string().regex(/^\d{1,25}$/),
  sort: z.enum(['recent', 'oldest', 'engagement', 'momentum', 'useful']),
  value: z.union([z.string().datetime(), z.number().finite()]),
});
export class XSearch {
  constructor(
    private readonly db: Database,
    private readonly ai: AIProvider,
  ) {}
  async hydrate(ids: string[]) {
    const rows = await this.db.xPost.findMany({ where: { id: { in: ids } }, include });
    const map = new Map(rows.map((p) => [p.id, xPostView(p)]));
    return ids.flatMap((id) => (map.has(id) ? [map.get(id)!] : []));
  }
  async browse(input: XBrowseInput) {
    if (input.q) return { items: await this.retrieve(input.q, 50, input.topic), nextCursor: null };
    const column = columns[input.sort];
    const field = Prisma.raw('"' + column + '"');
    const ascending = input.sort === 'oldest';
    const conditions = [Prisma.sql`${field} IS NOT NULL`];
    if (input.topic) conditions.push(Prisma.sql`topics @> ARRAY[${input.topic}]::text[]`);
    if (input.cursor) {
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
      } catch {
        raw = null;
      }
      const cursor = cursorSchema.parse(raw);
      if (cursor.sort !== input.sort)
        throw new BadRequestException('Le curseur ne correspond pas au tri demandé');
      if (
        (['recent', 'oldest'].includes(input.sort) && typeof cursor.value !== 'string') ||
        (!['recent', 'oldest'].includes(input.sort) && typeof cursor.value !== 'number')
      )
        throw new BadRequestException('Curseur invalide');
      const value = ['recent', 'oldest'].includes(input.sort)
        ? new Date(String(cursor.value))
        : Number(cursor.value);
      const operator = Prisma.raw(ascending ? '>' : '<');
      conditions.push(Prisma.sql`(${field},id) ${operator} (${value},${cursor.id})`);
    }
    const rows = await this.db.$queryRaw<{ id: string; value: Date | number }[]>(
      Prisma.sql`SELECT id, ${field} AS value FROM "XPost" WHERE ${Prisma.join(conditions, ' AND ')} ORDER BY ${field} ${Prisma.raw(ascending ? 'ASC' : 'DESC')},id ${Prisma.raw(ascending ? 'ASC' : 'DESC')} LIMIT 26`,
    );
    const selected = rows.slice(0, 25),
      last = selected[selected.length - 1];
    return {
      items: await this.hydrate(selected.map((r) => r.id)),
      nextCursor:
        rows.length > 25 && last
          ? Buffer.from(
              JSON.stringify({ id: last.id, value: last.value, sort: input.sort }),
            ).toString('base64url')
          : null,
    };
  }
  async retrieve(question: string, limit = 20, topic?: string) {
    const words = question.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
    const stop = new Set(
      'comment pour avec dans une des les est sont peux peut vous nous faire quoi qui que aux par sur mon mes ton tes the how with from and for this that'.split(
        ' ',
      ),
    );
    const textQuery =
      [...new Set(words.filter((w) => !stop.has(w)))].slice(0, 30).join(' OR ') || question;
    const vector = '[' + validateEmbedding(await this.ai.createEmbedding(question)).join(',') + ']';
    const filter = topic ? Prisma.sql`topics @> ARRAY[${topic}]::text[]` : Prisma.sql`TRUE`;
    const rows = await this.db.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH text_hits AS (
        SELECT id, row_number() OVER (ORDER BY ts_rank_cd(to_tsvector('simple',text || ' ' || "quotedText"),websearch_to_tsquery('simple',${textQuery})) DESC,id) AS rank
        FROM "XPost" WHERE ${filter} AND to_tsvector('simple',text || ' ' || "quotedText") @@ websearch_to_tsquery('simple',${textQuery}) LIMIT 100
      ), semantic_candidates AS (
        SELECT id, vector <=> ${vector}::vector AS distance FROM "XPost" WHERE ${filter} AND vector IS NOT NULL AND "embeddingProvider"=${this.ai.name} AND "embeddingModel"=${this.ai.embeddingModel}
        ORDER BY vector <=> ${vector}::vector LIMIT 100
      ), semantic_hits AS (
        SELECT id,row_number() OVER (ORDER BY distance,id) AS rank FROM semantic_candidates WHERE distance<0.95
      ), scores AS (
        SELECT id,1.0/(60+rank) AS score FROM text_hits UNION ALL SELECT id,1.0/(60+rank) AS score FROM semantic_hits
      ) SELECT id FROM scores GROUP BY id ORDER BY SUM(score) DESC,id LIMIT ${limit}`);
    return this.hydrate(rows.map((r) => r.id));
  }
}
