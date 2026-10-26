import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { PipelineError } from '@knowledge/domain';
import type { WatchOverview, WatchSettingsInput } from '@knowledge/shared';
import { createApplication } from '../../apps/api/src/app';
import { loadConfig } from '../../apps/api/src/config';
import { Database } from '../../apps/api/src/infrastructure/database';
import { WatchRepository } from '../../apps/api/src/watch/repository';
import { WatchCollector } from '../../apps/api/src/watch/collector';
import { WatchService } from '../../apps/api/src/watch/service';
import { Pipeline } from '../../apps/api/src/processing/pipeline';
import { JobsRepository } from '../../apps/api/src/processing/jobs.repository';
import { ContentRepository } from '../../apps/api/src/processing/content.repository';
import { AdapterRegistry, WebPageAdapter } from '../../apps/api/src/ingestion/adapters';
import { LocalProvider } from '../../apps/api/src/ai/providers';
const target = process.env.TEST_DATABASE_URL;
if (!target || !new URL(target).pathname.endsWith('_test'))
  throw new Error('Isolated test database required');
process.env.DATABASE_URL = target;
const settings: WatchSettingsInput = {
  topics: ['n8n'],
  includeKeywords: [],
  excludeKeywords: ['crypto'],
  languages: ['fr'],
  dailyLimit: 5,
  scheduleEnabled: false,
};
const rss = `<rss><channel><language>fr</language>${[
  ['n8n et reporting', 'one', 'Une méthode de reporting vérifiable.'],
  ['n8n et données', 'two', 'Conserver des sources fiables.'],
  ['n8n et crypto', 'excluded', 'Une promotion à exclure.'],
  ['Cuisine', 'offtopic', 'Une recette sans rapport.'],
]
  .map(
    ([title, id, body]) =>
      `<item><guid>${id}</guid><title>${title}</title><link>https://example.com/${id}</link><description>${body}</description><author>Alex</author></item>`,
  )
  .join('')}</channel></rss>`;
let failFeed = false;
const fetcher = {
  fetch: async (url: string) => {
    if (url.includes('/bad-feed'))
      throw new PipelineError('HTTP_403', 'La source a répondu HTTP 403', false);
    if (url.includes('/feed')) {
      if (failFeed) throw new Error('untrusted-secret-in-external-error');
      return { url, contentType: 'application/rss+xml', text: rss };
    }
    return {
      url,
      contentType: 'text/html',
      text: `<html><head><title>Article complet</title></head><body><article><p>Le texte intégral explique une méthode n8n pour conserver la provenance et automatiser le reporting universitaire. Chaque indicateur est vérifié avant publication. ${url}</p></article></body></html>`,
    };
  },
};
let app: INestApplication,
  db: Database,
  repo: WatchRepository,
  collector: WatchCollector,
  service: WatchService,
  base: string;
const api = (path: string, init: RequestInit = {}) =>
  fetch(base + '/api/watch' + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-watch-key',
      ...init.headers,
    },
  });
const post = (path: string, data?: unknown) =>
  api(path, { method: 'POST', ...(data ? { body: JSON.stringify(data) } : {}) });
beforeAll(async () => {
  app = await createApplication(
    { ...loadConfig(), API_TOKEN: 'test-watch-key', AI_PROVIDER: 'local' },
    { fetcher, worker: false },
  );
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  db = app.get(Database);
  repo = app.get(WatchRepository);
  collector = app.get(WatchCollector);
  service = app.get(WatchService);
});
beforeEach(async () => {
  failFeed = false;
  await db.$executeRawUnsafe(
    'TRUNCATE "WatchCandidate","WatchRun","WatchSource","WatchSettings","ProcessingJob","Content","Topic","Concept" CASCADE',
  );
});
afterAll(async () => {
  await app?.close();
});
async function setup() {
  await service.saveSettings(settings);
  return service.addSource({ name: 'Flux exemple', url: 'https://example.com/feed' });
}
async function collect() {
  const run = await service.collect();
  await collector.runOnce();
  return db.watchRun.findUniqueOrThrow({ where: { id: run!.id } });
}
describe('Persistent RSS watch and private API', () => {
  it('protects watch routes, validates settings/URLs and starts with automation disabled', async () => {
    expect((await fetch(base + '/api/watch')).status).toBe(401);
    expect((await fetch(base + '/api/watch/runs', { method: 'POST' })).status).toBe(401);
    expect((await post('/sources', { name: 'Bad', url: 'http://127.0.0.1/feed' })).status).toBe(
      400,
    );
    expect(
      (
        await api('/settings', {
          method: 'PUT',
          body: JSON.stringify({ ...settings, dailyLimit: 0 }),
        })
      ).status,
    ).toBe(400);
    expect((await post('/candidates/not-a-uuid/decision', { decision: 'KEEP' })).status).toBe(400);
    const response = await api('');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(((await response.json()) as WatchOverview).settings.scheduleEnabled).toBe(false);
    expect((await post('/runs')).status).toBe(409);
  });
  it('collects filtered proposals, preserves the feed snapshot and never publishes before approval', async () => {
    await setup();
    const run = await collect();
    expect(run).toMatchObject({ status: 'COMPLETED', scanned: 4, added: 2, filtered: 2 });
    const result = await service.overview();
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].selectionScore).toBe(100);
    expect(await db.processingJob.count()).toBe(0);
    expect(await db.knowledgeCard.count()).toBe(0);
    expect((await db.watchCandidate.findFirst())?.feedSnapshot).toMatchObject({
      feedUrl: 'https://example.com/feed',
      author: 'Alex',
    });
    expect((await collect()).added).toBe(0);
    expect(await db.watchCandidate.count()).toBe(2);
  });
  it('coalesces concurrent launches and claims a run once', async () => {
    await setup();
    const runs = await Promise.all([service.collect(), service.collect(), service.collect()]);
    expect(new Set(runs.map((r) => r!.id)).size).toBe(1);
    expect((await Promise.all([collector.runOnce(), collector.runOnce()])).sort()).toEqual([
      false,
      true,
    ]);
    expect(await db.watchRun.count()).toBe(1);
  });
  it('keeps valid results on a partial failure and supports a fresh idempotent collection', async () => {
    await setup();
    const bad = await service.addSource({
      name: 'Flux inaccessible',
      url: 'https://example.com/bad-feed',
    });
    const run = await collect();
    expect(run.status).toBe('PARTIAL');
    expect(run.issues).toEqual([{ sourceId: bad.id, message: 'La source a répondu HTTP 403' }]);
    expect(await db.watchCandidate.count()).toBe(2);
    await service.setSource(bad.id, false);
    expect((await collect()).status).toBe('COMPLETED');
    expect(await db.watchCandidate.count()).toBe(2);
  });
  it('creates one approval job, fetches full content and persists RSS discovery provenance', async () => {
    await setup();
    await collect();
    const candidate = (await service.overview()).candidates[0];
    const results = await Promise.all([
      service.decide(candidate.id, 'KEEP'),
      service.decide(candidate.id, 'KEEP'),
    ]);
    expect(results[0].job?.id).toBe(results[1].job?.id);
    expect(await db.processingJob.count()).toBe(1);
    const job = await db.processingJob.findFirstOrThrow();
    expect(job.input).not.toHaveProperty('text');
    const ai = new LocalProvider();
    const pipeline = new Pipeline(
      new JobsRepository(db),
      new ContentRepository(db),
      new AdapterRegistry([new WebPageAdapter(fetcher)]),
      ai,
    );
    await pipeline.runOnce();
    const card = await db.knowledgeCard.findFirstOrThrow({ include: { content: true } });
    expect(card.content.text).toContain('texte intégral');
    expect(card.content.metadata).toMatchObject({
      discovery: {
        kind: 'rss',
        candidateId: candidate.id,
        feed: { feedUrl: 'https://example.com/feed' },
      },
    });
    expect((await service.overview()).recentDecisions[0].job?.cardId).toBe(card.id);
    expect((await collect()).added).toBe(0);
  });
  it('enforces the daily cap atomically across different simultaneous approvals', async () => {
    await setup();
    await service.saveSettings({ ...settings, dailyLimit: 1 });
    await collect();
    const candidates = (await service.overview()).candidates;
    const results = await Promise.allSettled(candidates.map((c) => service.decide(c.id, 'KEEP')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.processingJob.count()).toBe(1);
    expect((await service.overview()).selectedToday).toBe(1);
  });
  it('records dismissals without jobs, re-evaluates changed criteria and respects disabled sources', async () => {
    const source = await setup();
    await collect();
    const c = (await service.overview()).candidates[0];
    await service.decide(c.id, 'KNOWN');
    expect(await db.processingJob.count()).toBe(0);
    await service.saveSettings({ ...settings, excludeKeywords: ['n8n'] });
    expect((await service.overview()).candidates).toHaveLength(0);
    const pending = await db.watchCandidate.findFirstOrThrow({ where: { status: 'PENDING' } });
    await expect(service.decide(pending.id, 'KEEP')).rejects.toThrow('réglages');
    await service.saveSettings(settings);
    await service.setSource(source.id, false);
    expect((await service.overview()).candidates).toHaveLength(0);
    await expect(service.decide(pending.id, 'KEEP')).rejects.toThrow();
    await service.addSource({ name: 'Réactivé', url: source.url + '?utm_source=test' });
    expect(await db.watchSource.count()).toBe(1);
    expect((await service.overview()).candidates).toHaveLength(1);
  });
  it('schedules only after opt-in, advances the deadline and creates no approval jobs', async () => {
    await setup();
    expect(await repo.enqueue(true)).toBeNull();
    await service.saveSettings({ ...settings, scheduleEnabled: true });
    const run = await repo.enqueue(true);
    expect(run?.trigger).toBe('scheduled');
    expect(await repo.enqueue(true)).toBeNull();
    await collector.runOnce();
    expect(await db.processingJob.count()).toBe(0);
    expect((await repo.settings()).nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    await service.saveSettings(settings);
    expect((await repo.settings()).nextRunAt).toBeNull();
  });
  it('recovers an expired lease and rejects writes by its old owner', async () => {
    await setup();
    await service.collect();
    const old = await repo.claim();
    await db.watchRun.update({ where: { id: old!.id }, data: { leaseUntil: new Date(0) } });
    expect(await collector.runOnce()).toBe(true);
    await expect(db.$transaction((tx) => repo.fence(tx, old!))).rejects.toThrow('lease');
    expect((await db.watchRun.findUniqueOrThrow({ where: { id: old!.id } })).attempts).toBe(2);
  });
  it('keeps failed runs retryable through a new launch and sanitizes external errors', async () => {
    await setup();
    failFeed = true;
    const run = await collect();
    expect(run.status).toBe('FAILED');
    expect(JSON.stringify(run)).not.toContain('untrusted-secret');
    failFeed = false;
    expect((await collect()).status).toBe('COMPLETED');
  });
  it('limits active sources even when additions race', async () => {
    await setup();
    await db.watchSource.createMany({
      data: Array.from({ length: 8 }, (_, i) => ({
        name: 'Flux ' + i,
        url: 'https://example.com/feed-' + i,
      })),
    });
    const results = await Promise.allSettled([
      service.addSource({ name: 'A', url: 'https://example.com/feed-a' }),
      service.addSource({ name: 'B', url: 'https://example.com/feed-b' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.watchSource.count({ where: { enabled: true } })).toBe(10);
  });
  it('marks repeatedly abandoned runs as failed and allows a new run', async () => {
    await setup();
    const run = await service.collect();
    await db.watchRun.update({
      where: { id: run!.id },
      data: { status: 'FETCHING', attempts: 3, leaseUntil: new Date(0) },
    });
    expect(await collector.runOnce()).toBe(false);
    expect((await db.watchRun.findUniqueOrThrow({ where: { id: run!.id } })).status).toBe('FAILED');
    expect((await collect()).status).toBe('COMPLETED');
  });
});
