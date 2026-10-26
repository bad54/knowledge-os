import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PipelineError } from '@knowledge/domain';
import { watchSettingsSchema } from '@knowledge/shared';
import { json } from '../processing/jobs.repository';
import { logger } from '../infrastructure/logger';
import { FeedReader } from './feed';
import { rankEntry } from './ranking';
import { settingsInput, WatchRepository } from './repository';

export class WatchCollector {
  constructor(
    private readonly repository: WatchRepository,
    private readonly reader: FeedReader,
  ) {}
  async runOnce() {
    const run = await this.repository.claim();
    if (!run) return false;
    const start = Date.now();
    const { db } = this.repository;
    const heartbeat = setInterval(() => {
      void this.repository.heartbeat(run).catch(() => {});
    }, 30000);
    heartbeat.unref();
    logger.info({ event: 'watch.started', runId: run.id, attempt: run.attempts });
    try {
      const settings = run.settingsSnapshot
        ? watchSettingsSchema.parse(run.settingsSnapshot)
        : settingsInput(await this.repository.settings());
      await db.$transaction(async (tx) => {
        await this.repository.fence(tx, run);
        await tx.watchRun.update({
          where: { id: run.id },
          data: { settingsSnapshot: json(settings) },
        });
      });
      const sources = await db.watchSource.findMany({
        where: { enabled: true },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      const issues: { sourceId: string; message: string }[] = [];
      let successes = 0;
      for (const source of sources) {
        try {
          const entries = (await this.reader.read(source.url)).slice(0, 10);
          await db.$transaction(
            async (tx) => {
              await this.repository.fence(tx, run);
              // A source disabled during a download must not publish new proposals.
              const current = await tx.watchSource.findUnique({ where: { id: source.id } });
              if (!current?.enabled) return;
              const candidates = [];
              for (const entry of entries) {
                const ranking = rankEntry(entry, settings);
                if (!ranking) continue;
                const known = await tx.content.findFirst({
                  where: { canonicalKey: entry.url, card: { isNot: null } },
                  select: { id: true },
                });
                if (known) continue;
                candidates.push({
                  ...entry,
                  ...ranking,
                  sourceId: source.id,
                  publishedAt: entry.publishedAt ? new Date(entry.publishedAt) : null,
                  feedSnapshot: json({ ...entry, feedUrl: source.url, sourceName: source.name }),
                });
              }
              const added = await tx.watchCandidate.createMany({
                data: candidates,
                skipDuplicates: true,
              });
              await tx.watchRun.update({
                where: { id: run.id },
                data: {
                  scanned: { increment: entries.length },
                  added: { increment: added.count },
                  filtered: { increment: entries.length - added.count },
                },
              });
              await tx.watchSource.update({
                where: { id: source.id },
                data: { lastSuccessAt: new Date(), errorMessage: null },
              });
            },
            { timeout: 15000 },
          );
          successes++;
        } catch (error) {
          const message =
            error instanceof PipelineError
              ? error.message
              : 'La collecte de ce flux a échoué. Réessayez ou vérifiez son URL.';
          issues.push({ sourceId: source.id, message });
          await db.$transaction(async (tx) => {
            await this.repository.fence(tx, run);
            await tx.watchSource.update({
              where: { id: source.id },
              data: { errorMessage: message },
            });
          });
          logger.warn({
            event: 'watch.source_failed',
            runId: run.id,
            sourceId: source.id,
            code: error instanceof PipelineError ? error.code : 'COLLECTION_ERROR',
          });
        }
      }
      await db.$transaction(async (tx) => {
        await this.repository.fence(tx, run);
        await tx.watchRun.update({
          where: { id: run.id },
          data: {
            status: !successes ? 'FAILED' : issues.length ? 'PARTIAL' : 'COMPLETED',
            issues: json(issues),
            finishedAt: new Date(),
            token: null,
            leaseUntil: null,
            errorMessage: !successes
              ? 'Aucun flux n’a pu être collecté. Vérifiez les sources et relancez.'
              : null,
          },
        });
      });
      logger.info({
        event: 'watch.completed',
        runId: run.id,
        sourceErrors: issues.length,
        durationMs: Date.now() - start,
      });
    } catch {
      await db.watchRun.updateMany({
        where: { id: run.id, token: run.token },
        data: {
          status: 'FAILED',
          errorMessage: 'Collecte interrompue. Les propositions déjà enregistrées sont conservées.',
          finishedAt: new Date(),
          token: null,
          leaseUntil: null,
        },
      });
      logger.error({ event: 'watch.failed', runId: run.id, durationMs: Date.now() - start });
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
}
export class WatchWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;
  private stopping = false;
  private nextScheduleCheck = 0;
  constructor(
    private readonly repository: WatchRepository,
    private readonly collector: WatchCollector,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      if (this.running || this.stopping) return;
      this.running = this.tick()
        .catch(() => logger.error({ event: 'watch.worker_failed' }))
        .finally(() => {
          this.running = undefined;
        });
    }, 1000);
    this.timer.unref();
  }
  private async tick() {
    if (Date.now() >= this.nextScheduleCheck) {
      this.nextScheduleCheck = Date.now() + 30000;
      await this.repository.enqueue(true);
    }
    await this.collector.runOnce();
  }
  async onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }
}
