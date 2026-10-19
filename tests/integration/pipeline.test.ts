import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { LocalProvider } from '../../apps/api/src/ai/providers';
import { createApplication } from '../../apps/api/src/app';
import { loadConfig } from '../../apps/api/src/config';
import { Database } from '../../apps/api/src/infrastructure/database';
import {
  AdapterRegistry,
  ManualTextAdapter,
  WebPageAdapter,
} from '../../apps/api/src/ingestion/adapters';
import { KnowledgeService } from '../../apps/api/src/knowledge/knowledge.service';
import { ContentRepository } from '../../apps/api/src/processing/content.repository';
import { JobsRepository } from '../../apps/api/src/processing/jobs.repository';
import { Pipeline } from '../../apps/api/src/processing/pipeline';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error(
    'TEST_DATABASE_URL must target an isolated database ending in _test; tests truncate it.',
  );
process.env.DATABASE_URL = url;
const text =
  'Automatiser le reporting universitaire avec n8n et des données fiables. Conserver la source de chaque indicateur.';
const fetcher = {
  fetch: async (url: string) => ({
    url,
    text:
      '<html><head><title>Reporting web</title></head><body><article><p>' +
      text.repeat(8) +
      '</p></article></body></html>',
    contentType: 'text/html',
  }),
};
let app: INestApplication;
let db: Database;
let jobs: JobsRepository;
let pipeline: Pipeline;
let base: string;
const ai = new LocalProvider();
beforeAll(async () => {
  app = await createApplication(
    { ...loadConfig(), API_TOKEN: 'integration-test-token', AI_PROVIDER: 'local' },
    { ai, fetcher, worker: false },
  );
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  db = app.get(Database);
  jobs = app.get(JobsRepository);
  pipeline = new Pipeline(
    jobs,
    new ContentRepository(db),
    new AdapterRegistry([new ManualTextAdapter(), new WebPageAdapter(fetcher)]),
    ai,
  );
});
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProcessingJob","Content","Topic","Concept" CASCADE');
});
afterAll(async () => {
  await app?.close();
});
const api = (path: string, init: RequestInit = {}) =>
  fetch(base + '/api' + path, {
    ...init,
    headers: {
      authorization: 'Bearer integration-test-token',
      'content-type': 'application/json',
      ...init.headers,
    },
  });
describe('Real PostgreSQL, pgvector, durable pipeline and API', () => {
  it('persists manual input, its raw provenance, a card, a revision and a vector', async () => {
    const response = await api('/jobs', {
      method: 'POST',
      body: JSON.stringify({ title: 'Reporting', text }),
    });
    expect(response.status).toBe(202);
    const job = (await response.json()) as { id: string };
    await pipeline.runOnce();
    const stored = await jobs.get(job.id);
    expect(stored?.status).toBe('COMPLETED');
    const detail = await new KnowledgeService(db, ai).detail(stored!.cardId!);
    expect(detail?.content.text).toBe(text);
    expect(detail?.revisions).toHaveLength(1);
    expect(detail?.topics[0].name).toBe('à classer');
    expect(await db.embedding.count()).toBe(1);
  });
  it('ingests a mocked external URL through real extraction and persistence', async () => {
    await jobs.create({ url: 'https://example.com/report?utm_source=test' });
    await pipeline.runOnce();
    const card = await db.knowledgeCard.findFirst({ include: { content: true } });
    expect(card?.content.text).toContain('universitaire');
    expect(card?.content.originalUrl).toBe('https://example.com/report?utm_source=test');
  });
  it('deduplicates repeated content and preserves each capture reference', async () => {
    await jobs.create({ text, title: 'First' });
    await pipeline.runOnce();
    await jobs.create({ text, title: 'Second', url: 'https://example.com/alias' });
    await pipeline.runOnce();
    expect(await db.knowledgeCard.count()).toBe(1);
    expect(await db.content.count()).toBe(1);
    expect(await db.sourceReference.count()).toBe(2);
  });
  it('deduplicates canonical URL even when its returned content has changed', async () => {
    await jobs.create({ url: 'https://example.com/a?utm_source=one' });
    await pipeline.runOnce();
    await jobs.create({ url: 'https://example.com/a?utm_source=two' });
    await pipeline.runOnce();
    expect(await db.knowledgeCard.count()).toBe(1);
    expect(await db.sourceReference.count()).toBe(2);
  });
  it('claims a job once under concurrent workers', async () => {
    await jobs.create({ text });
    const [a, b] = await Promise.all([jobs.claim(), jobs.claim()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
  it('ranks matching vectors, text and filters in PostgreSQL', async () => {
    await jobs.create({ text, title: 'Reporting universitaire' });
    await pipeline.runOnce();
    await jobs.create({
      text: 'Recette de cuisine : mélanger farine sucre beurre et chocolat. Faire cuire le gâteau pendant vingt minutes.',
      title: 'Cuisine chocolat',
    });
    await pipeline.runOnce();
    const knowledge = new KnowledgeService(db, ai);
    const semantic = await knowledge.search({ q: 'reporting universitaire', mode: 'semantic' });
    expect(semantic[0].title).toBe('Reporting universitaire');
    expect(semantic[0].similarity).toBeGreaterThan(semantic[1].similarity);
    expect((await knowledge.search({ q: 'chocolat', mode: 'text' }))[0].title).toBe(
      'Cuisine chocolat',
    );
    expect(await knowledge.search({ q: 'reporting', mode: 'hybrid', minScore: 9 })).toEqual([]);
    expect(
      (
        await knowledge.search({
          q: 'reporting',
          mode: 'hybrid',
          source: 'manual',
          topic: 'à classer',
        })
      ).length,
    ).toBe(2);
  });
  it('isolates vectors from different providers and models', async () => {
    await jobs.create({ text });
    await pipeline.runOnce();
    const mismatch = Object.assign(new LocalProvider(), { embeddingModel: 'other-space' });
    expect(
      await new KnowledgeService(db, mismatch).search({ q: 'reporting', mode: 'semantic' }),
    ).toEqual([]);
  });
  it('preserves source content after AI failure and supports retry', async () => {
    const bad = Object.assign(new LocalProvider(), {
      analyzeContent: async () => {
        throw new Error('secret should never be logged');
      },
    });
    const failing = new Pipeline(
      jobs,
      new ContentRepository(db),
      new AdapterRegistry([new ManualTextAdapter()]),
      bad,
    );
    const job = await jobs.create({ text });
    await failing.runOnce();
    expect((await jobs.get(job.id))?.status).toBe('FAILED');
    expect(await db.content.count()).toBe(1);
    expect(await db.knowledgeCard.count()).toBe(0);
    expect(await jobs.retry(job.id)).toBe(true);
    await pipeline.runOnce();
    expect((await jobs.get(job.id))?.status).toBe('COMPLETED');
  });
  it('keeps the active revision after failed reanalysis then versions a successful retry', async () => {
    await jobs.create({ text });
    await pipeline.runOnce();
    const card = (await db.knowledgeCard.findFirst())!;
    const job = (await jobs.reanalyze(card.id))!;
    const bad = Object.assign(new LocalProvider(), { createEmbedding: async () => [NaN] });
    const failing = new Pipeline(
      jobs,
      new ContentRepository(db),
      new AdapterRegistry([new ManualTextAdapter()]),
      bad,
    );
    await failing.runOnce();
    expect((await db.knowledgeCard.findUnique({ where: { id: card.id } }))?.activeRevisionId).toBe(
      card.activeRevisionId,
    );
    expect(await db.cardAnalysis.count()).toBe(1);
    await jobs.retry(job.id);
    await pipeline.runOnce();
    expect(await db.cardAnalysis.count()).toBe(2);
  });
  it('rejects invalid input, unsafe URLs, UUIDs, scores and unauthorized requests', async () => {
    expect((await fetch(base + '/api/cards')).status).toBe(401);
    for (const body of [
      {},
      { text: 'short' },
      { url: 'http://127.0.0.1' },
      { text, unexpected: true },
    ]) {
      expect((await api('/jobs', { method: 'POST', body: JSON.stringify(body) })).status).toBe(400);
    }
    expect((await api('/cards/not-a-uuid')).status).toBe(400);
    expect((await api('/search?q=test&minScore=11')).status).toBe(400);
    expect((await api('/health')).status).toBe(200);
    expect((await api('/openapi.json')).status).toBe(200);
  });
});
