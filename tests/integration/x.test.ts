import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApplication } from '../../apps/api/src/app';
import { loadConfig } from '../../apps/api/src/config';
import { Database } from '../../apps/api/src/infrastructure/database';
import { XService } from '../../apps/api/src/x/service';
import { XCollection } from '../../apps/api/src/x/collection';
import { XIndexer } from '../../apps/api/src/x/indexer';
import { XAnswers } from '../../apps/api/src/x/answers';
import { XCorpusAdapter } from '../../apps/api/src/x/adapter';
import { normalizeV12Post, XSearchRequest } from '../../apps/api/src/x/client';
import { LocalProvider } from '../../apps/api/src/ai/providers';
import { JobsRepository } from '../../apps/api/src/processing/jobs.repository';
import { ContentRepository } from '../../apps/api/src/processing/content.repository';
import { Pipeline } from '../../apps/api/src/processing/pipeline';
import { AdapterRegistry } from '../../apps/api/src/ingestion/adapters';
import { xRuleSchema } from '@knowledge/shared';
const target = process.env.TEST_DATABASE_URL;
if (!target || !new URL(target).pathname.endsWith('_test'))
  throw new Error('Isolated test database required');
process.env.DATABASE_URL = target;
const config = {
  ...loadConfig(),
  API_TOKEN: 'test-x-key',
  AI_PROVIDER: 'local' as const,
  X_BEARER_TOKEN: 'test-only',
  X_AUTO_CARDS_PER_DAY: 2,
  X_DAILY_READ_LIMIT: 20,
};
const raw = (id = '100') => ({
  post_id: id,
  text: 'Guide et exemple n8n pour automatiser le reporting universitaire. Conserver les sources et vérifier chaque indicateur.',
  author_name: 'Marie ' + id,
  datetime: '2025-01-01T12:00:00Z',
  url: 'https://x.com/marie/status/' + id,
});
const calls: XSearchRequest[] = [];
let fail = false;
const client = {
  search: async (request: XSearchRequest) => {
    calls.push(request);
    if (fail) throw new Error('private-key-in-error');
    return {
      posts: [normalizeV12Post(raw(request.nextToken ? '102' : '101'))],
      nextToken: request.nextToken ? null : 'next-page',
      newestId: request.nextToken ? '102' : '101',
    };
  },
};
let app: INestApplication,
  db: Database,
  service: XService,
  collection: XCollection,
  indexer: XIndexer,
  base: string;
const request = (path: string, data?: unknown, method = 'POST') =>
  fetch(base + '/api/x' + path, {
    method,
    headers: { authorization: 'Bearer test-x-key', 'content-type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
beforeAll(async () => {
  app = await createApplication(config, { worker: false, xClient: client });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  db = app.get(Database);
  service = app.get(XService);
  collection = app.get(XCollection);
  indexer = app.get(XIndexer);
});
beforeEach(async () => {
  calls.length = 0;
  fail = false;
  await db.$executeRawUnsafe(
    'TRUNCATE "XAnswer","XRule","XPost","XUsageDay","ProcessingJob","Content","Topic","Concept" CASCADE',
  );
});
afterAll(async () => {
  await app?.close();
});
describe('Private persistent X corpus', () => {
  it('guards API access, validates all import/rule/query boundaries and leaves collection inactive without a token', async () => {
    expect((await fetch(base + '/api/x')).status).toBe(401);
    expect((await request('/import', { posts: [] })).status).toBe(400);
    expect(
      (await request('/rules', { name: 'x', query: 'AI', topic: 'IA', maxPosts: 999 })).status,
    ).toBe(400);
    expect((await request('/posts?cursor=invalid', undefined, 'GET')).status).toBe(400);
    expect((await request('/posts/bad/card')).status).toBe(400);
    const noKey = new XCollection(
      db,
      { ...config, X_BEARER_TOKEN: '' },
      client,
      new (await import('../../apps/api/src/x/store')).XPostStore(config),
    );
    await expect(noKey.enqueue('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      'X_BEARER_TOKEN',
    );
    expect(calls).toHaveLength(0);
  });
  it('deduplicates concurrent imports, strips secrets and preserves immutable source captures', async () => {
    const results = await Promise.all([
      service.importPosts({
        posts: [{ ...raw(), openaiKey: 'DO-NOT-STORE', knowledge_card: { summary: 'generated' } }],
        autoCards: false,
      }),
      service.importPosts({ posts: [raw()], autoCards: false }),
    ]);
    expect(results.reduce((n, r) => n + r.added, 0)).toBe(1);
    expect(await db.xPost.count()).toBe(1);
    expect(await db.xCapture.count()).toBe(1);
    await service.importPosts({
      posts: [{ ...raw(), text: 'Une nouvelle capture avec texte différent' }],
      autoCards: false,
    });
    expect(await db.xCapture.count()).toBe(2);
    expect((await db.xPost.findUniqueOrThrow({ where: { id: '100' } })).text).toBe(raw().text);
    expect(JSON.stringify(await db.xCapture.findMany())).not.toMatch(/DO-NOT-STORE|generated/);
    const mixed = await service.importPosts({ posts: [{}, raw('200')], autoCards: false });
    expect(mixed).toMatchObject({ added: 1, ignored: 1 });
  });
  it('automatically creates bounded idempotent jobs and publishes cards from captured posts without refetching X', async () => {
    await service.importPosts({ posts: [raw('100'), raw('101'), raw('102')] });
    expect(await db.processingJob.count()).toBe(2);
    const first = await db.xPost.findFirstOrThrow({ where: { jobId: { not: null } } });
    expect((await service.createCard(first.id)).jobId).toBe(first.jobId);
    const pipeline = new Pipeline(
      new JobsRepository(db),
      new ContentRepository(db),
      new AdapterRegistry([new XCorpusAdapter(db)]),
      new LocalProvider(),
    );
    while (await pipeline.runOnce()) {
      /* Drain only bounded test jobs. */
    }
    const cards = await db.knowledgeCard.findMany({ include: { content: true } });
    expect(cards).toHaveLength(1);
    expect(await db.processingJob.count({ where: { status: 'COMPLETED' } })).toBe(2);
    expect(cards[0]?.content.text).toContain('reporting universitaire');
    expect(cards[0]?.content.metadata).toMatchObject({
      origin: 'v12_import',
      coverage: 'post_only',
      discovery: { kind: 'x_corpus' },
    });
    expect(calls).toHaveLength(0);
  });
  it('indexes with pgvector, searches by topic and retrieves persisted evidence snapshots', async () => {
    await service.importPosts({
      posts: [
        raw('100'),
        { ...raw('101'), text: 'Une recette pour cuire les pommes et préparer un dessert.' },
      ],
      autoCards: false,
    });
    expect(await indexer.runOnce()).toBe(true);
    expect(await indexer.runOnce()).toBe(true);
    expect(await indexer.runOnce()).toBe(false);
    expect((await service.overview()).counts.indexed).toBe(2);
    const result = await service.search.browse({
      q: 'n8n reporting universitaire',
      topic: 'Automatisation',
      sort: 'recent',
    });
    expect(result.items.map((p) => p.id)).toContain('100');
    const answer = await app
      .get(XAnswers)
      .ask('Comment automatiser le reporting universitaire avec n8n ?', 'answer');
    expect(answer.sections.length).toBeGreaterThan(0);
    expect(answer.provider).toBe('local');
    expect(answer.sources[0]?.url).toContain('/status/100');
    expect(answer.sections[0]?.citations).toEqual([1]);
    expect((await app.get(XAnswers).detail(answer.id)).sources).toEqual(answer.sources);
    expect((await app.get(XAnswers).ask(answer.question, 'answer')).id).toBe(answer.id);
    expect(
      (await request('/ask', { question: 'Préparer un plan reporting', mode: 'plan' })).status,
    ).toBe(400);
  });
  it('returns an honest empty answer without inventing data', async () => {
    const answer = await app.get(XAnswers).ask('Comment automatiser le reporting ?', 'answer');
    expect(answer.sources).toEqual([]);
    expect(answer.model).toBe('no-evidence');
  });
  it('retains posts after indexing errors and isolates vectors when the provider model changes', async () => {
    await service.importPosts({ posts: [raw()], autoCards: false });
    const ai = new LocalProvider();
    const broken = {
      ...ai,
      name: ai.name,
      embeddingModel: ai.embeddingModel,
      analyzeContent: ai.analyzeContent.bind(ai),
      createEmbedding: async () => {
        throw new Error('secret-error');
      },
    };
    await new XIndexer(db, broken, config).runOnce();
    const failed = await db.xPost.findUniqueOrThrow({ where: { id: '100' } });
    expect(failed.indexStatus).toBe('FAILED');
    expect(failed.text).toBe(raw().text);
    expect(failed.indexError).not.toContain('secret');
    await service.retryIndex('100');
    await indexer.runOnce();
    const changed = {
      name: 'local',
      embeddingModel: 'changed-test-model',
      analyzeContent: ai.analyzeContent.bind(ai),
      createEmbedding: ai.createEmbedding.bind(ai),
    };
    await new XIndexer(db, changed, config).runOnce();
    expect((await db.xPost.findUniqueOrThrow({ where: { id: '100' } })).embeddingModel).toBe(
      'changed-test-model',
    );
    expect((await service.overview()).counts.indexed).toBe(0);
    await indexer.runOnce();
    expect((await service.overview()).counts.indexed).toBe(1);
  });
  it('does not persist an AI answer that cites a source not selected as evidence', async () => {
    await service.importPosts({ posts: [raw()], autoCards: false });
    const reasoner = {
      name: 'openai',
      decompose: async () => ['n8n'],
      rerank: async () => [{ postId: '100', relevance: 99, reason: 'Test' }],
      answer: async () => ({
        model: 'test',
        promptVersion: 'test.v1',
        answer: {
          sections: [
            { heading: 'Méthode', kind: 'evidence' as const, text: 'Texte', citations: [2] },
          ],
          warnings: [],
        },
      }),
    };
    const answers = new XAnswers(db, service.search, reasoner, 'test');
    await expect(answers.ask('Comment utiliser n8n pour le reporting ?', 'answer')).rejects.toThrow(
      'référence',
    );
    expect(await db.xAnswer.count()).toBe(0);
  });
  it('paginates with stable cursors and excludes unknown metrics', async () => {
    await service.importPosts({
      posts: Array.from({ length: 30 }, (_, i) => raw(String(100 + i))),
      autoCards: false,
    });
    const first = await service.search.browse({ q: '', sort: 'recent' });
    expect(first.items).toHaveLength(25);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.search.browse({
      q: '',
      sort: 'recent',
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(5);
    expect(new Set([...first.items, ...second.items].map((p) => p.id)).size).toBe(30);
    expect((await service.search.browse({ q: '', sort: 'engagement' })).items).toEqual([]);
  });
  it('coalesces launches, consumes a conservative daily budget and advances official cursors', async () => {
    const rule = await collection.addRule(
      xRuleSchema.parse({ name: 'n8n', query: 'n8n', topic: 'Automatisation', maxPosts: 10 }),
    );
    const runs = await Promise.all([collection.enqueue(rule.id), collection.enqueue(rule.id)]);
    expect(runs[0]!.id).toBe(runs[1]!.id);
    expect((await Promise.all([collection.runOnce(), collection.runOnce()])).sort()).toEqual([
      false,
      true,
    ]);
    expect((await db.xRule.findUniqueOrThrow({ where: { id: rule.id } })).nextToken).toBe(
      'next-page',
    );
    await collection.enqueue(rule.id);
    await collection.runOnce();
    expect(calls[1]?.nextToken).toBe('next-page');
    const saved = await db.xRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(saved.nextToken).toBeNull();
    expect(saved.sinceId).toBe('102');
    await collection.enqueue(rule.id);
    await collection.runOnce();
    expect(calls).toHaveLength(2);
    expect((await service.overview()).limits.readsReservedToday).toBe(20);
    expect((await service.overview()).runs.some((r) => r.errorMessage?.includes('Plafond'))).toBe(
      true,
    );
  });
  it('records safe failures and recovers already downloaded pages without a second paid call', async () => {
    const rule = await collection.addRule(
      xRuleSchema.parse({ name: 'n8n', query: 'n8n', topic: 'Automatisation', maxPosts: 10 }),
    );
    fail = true;
    const failed = await collection.enqueue(rule.id);
    await collection.runOnce();
    expect((await db.xCollectionRun.findUniqueOrThrow({ where: { id: failed!.id } })).status).toBe(
      'FAILED',
    );
    expect(JSON.stringify(await service.overview())).not.toContain('private-key');
    fail = false;
    await collection.enqueue(rule.id);
    const claimed = await collection.claim();
    await db.xCollectionRun.update({
      where: { id: claimed!.id },
      data: {
        page: JSON.parse(
          JSON.stringify({
            posts: [normalizeV12Post(raw('400'))],
            nextToken: null,
            newestId: '400',
          }),
        ),
        leaseUntil: new Date(0),
      },
    });
    expect(await collection.runOnce()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(await db.xPost.findUnique({ where: { id: '400' } })).not.toBeNull();
  });
});
