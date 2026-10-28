import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { XCollectionRun } from '@prisma/client';
import { PipelineError } from '@knowledge/domain';
import { AppConfig } from '../config';
import { Database } from '../infrastructure/database';
import { logger } from '../infrastructure/logger';
import { json } from '../processing/jobs.repository';
import type { XRuleInput } from '@knowledge/shared';
import type { XDiscoveryClient, XPage, XSearchRequest } from './client';
import { usageDay, XPostStore, xLock } from './store';
type Snapshot = XSearchRequest & { version: number; topic: string; autoCards: boolean };
export class XCollection {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly client: XDiscoveryClient,
    private readonly store: XPostStore,
  ) {}
  async addRule(input: XRuleInput) {
    return this.db.$transaction(async (tx) => {
      await xLock(tx, 'rules');
      if ((await tx.xRule.count()) >= 50)
        throw new ConflictException('Cinquante règles maximum pour cette version.');
      return tx.xRule.create({
        data: {
          ...input,
          startTime: input.startTime ? new Date(input.startTime) : null,
          endTime: input.endTime ? new Date(input.endTime) : null,
          nextRunAt: input.enabled ? new Date() : null,
        },
      });
    });
  }
  async toggleRule(id: string, enabled: boolean) {
    const result = await this.db.xRule.updateMany({
      where: { id },
      data: { enabled, nextRunAt: enabled ? new Date() : null },
    });
    if (!result.count) throw new NotFoundException('Règle X introuvable');
    return { id, enabled };
  }
  async enqueue(id: string, scheduled = false) {
    if (!this.config.X_BEARER_TOKEN) {
      if (scheduled) return null;
      throw new ServiceUnavailableException(
        'X_BEARER_TOKEN n’est pas configuré. Utilisez l’import V12 ou connectez un accès développeur X.',
      );
    }
    return this.db.$transaction(async (tx) => {
      await xLock(tx, 'rule:' + id);
      const rule = await tx.xRule.findUnique({ where: { id } });
      if (!rule) throw new NotFoundException('Règle X introuvable');
      if (rule.archiveComplete) {
        if (scheduled) return null;
        throw new ConflictException(
          'Cette période d’archives a déjà été parcourue. Créez une règle pour une autre période.',
        );
      }
      if (scheduled && (!rule.enabled || (rule.nextRunAt && rule.nextRunAt > new Date())))
        return null;
      const active = await tx.xCollectionRun.findFirst({
        where: { ruleId: id, status: { in: ['CREATED', 'FETCHING'] } },
      });
      if (active) return active;
      const snapshot: Snapshot = {
        query: rule.query,
        mode: rule.mode as Snapshot['mode'],
        maxPosts: rule.maxPosts,
        nextToken: rule.nextToken,
        sinceId: rule.sinceId,
        startTime: rule.startTime?.toISOString(),
        endTime: rule.endTime?.toISOString(),
        version: rule.version,
        topic: rule.topic,
        autoCards: rule.autoCards,
      };
      await tx.xRule.update({
        where: { id },
        data: {
          nextRunAt: rule.enabled ? new Date(Date.now() + rule.intervalMinutes * 60000) : null,
        },
      });
      return tx.xCollectionRun.create({ data: { ruleId: id, snapshot: json(snapshot) } });
    });
  }
  async schedule() {
    if (!this.config.X_BEARER_TOKEN) return;
    const due = await this.db.xRule.findMany({
      where: {
        enabled: true,
        archiveComplete: false,
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }],
      },
      take: 10,
    });
    for (const rule of due) await this.enqueue(rule.id, true);
  }
  async claim() {
    await this.db.xCollectionRun.updateMany({
      where: { status: 'FETCHING', attempts: { gte: 3 }, leaseUntil: { lt: new Date() } },
      data: {
        status: 'FAILED',
        token: null,
        leaseUntil: null,
        finishedAt: new Date(),
        errorMessage: 'Collecte interrompue trois fois. Relancez la règle.',
      },
    });
    const rows = await this.db.$queryRawUnsafe<XCollectionRun[]>(
      `UPDATE "XCollectionRun" r SET status='FETCHING', attempts=attempts+1, token=$1::uuid, "leaseUntil"=now()+interval '3 minutes'
      WHERE r.id=(SELECT id FROM "XCollectionRun" WHERE status='CREATED' OR (status='FETCHING' AND "leaseUntil"<now() AND attempts<3) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING r.*`,
      randomUUID(),
    );
    return rows[0] || null;
  }
  private async fence(run: XCollectionRun) {
    const result = await this.db.xCollectionRun.updateMany({
      where: { id: run.id, token: run.token, status: 'FETCHING' },
      data: { leaseUntil: new Date(Date.now() + 180000) },
    });
    if (result.count !== 1) throw new Error('X collection lease lost');
  }
  async runOnce() {
    const run = await this.claim();
    if (!run) return false;
    const start = Date.now();
    const heartbeat = setInterval(() => {
      void this.fence(run).catch(() => {});
    }, 30000);
    heartbeat.unref();
    try {
      const request = run.snapshot as unknown as Snapshot;
      let page = run.page as unknown as XPage | null;
      if (!page) {
        const reserved = await this.db.$transaction(async (tx) => {
          await xLock(tx, 'reads');
          const usage = await usageDay(tx);
          const count = Math.min(
            request.maxPosts,
            this.config.X_DAILY_READ_LIMIT - usage.readsReserved,
          );
          if (count < 10)
            throw new PipelineError(
              'X_READ_LIMIT',
              'Plafond quotidien de lectures X atteint (UTC). Aucun appel supplémentaire n’a été effectué.',
              false,
            );
          await tx.xUsageDay.update({
            where: { day: usage.day },
            data: { readsReserved: { increment: count } },
          });
          return count;
        });
        page = await this.client.search({ ...request, maxPosts: reserved });
        if (page.posts.length > reserved)
          throw new PipelineError(
            'X_INVALID_RESPONSE',
            'X a retourné plus de ressources que demandé.',
            false,
          );
        await this.fence(run);
        await this.db.xCollectionRun.updateMany({
          where: { id: run.id, token: run.token },
          data: { page: json(page) },
        });
      }
      const savedPage = page;
      await this.db.$transaction(
        async (tx) => {
          const fenced = await tx.xCollectionRun.updateMany({
            where: { id: run.id, token: run.token, status: 'FETCHING' },
            data: { leaseUntil: new Date(Date.now() + 180000) },
          });
          if (!fenced.count) throw new Error('X collection lease lost');
          const added = await this.store.save(tx, savedPage.posts, request.topic);
          if (request.autoCards)
            await this.store.selectCards(
              tx,
              savedPage.posts.map((p) => p.id),
            );
          const rule = await tx.xRule.findUniqueOrThrow({ where: { id: run.ruleId } });
          if (rule.version === request.version) {
            const ids = [rule.windowNewestId, savedPage.newestId, rule.sinceId].filter(
              (v): v is string => !!v,
            );
            const newest =
              ids.sort((a, b) => (BigInt(a) > BigInt(b) ? -1 : BigInt(a) < BigInt(b) ? 1 : 0))[0] ||
              null;
            await tx.xRule.update({
              where: { id: rule.id },
              data: {
                nextToken: savedPage.nextToken,
                windowNewestId: savedPage.nextToken ? newest : null,
                sinceId: savedPage.nextToken ? rule.sinceId : newest,
                ...(rule.mode === 'archive' && !savedPage.nextToken
                  ? { archiveComplete: true, enabled: false, nextRunAt: null }
                  : {}),
              },
            });
          }
          await tx.xCollectionRun.update({
            where: { id: run.id },
            data: {
              status: 'COMPLETED',
              fetched: savedPage.posts.length,
              added,
              token: null,
              leaseUntil: null,
              finishedAt: new Date(),
            },
          });
        },
        { timeout: 30000 },
      );
      logger.info({
        event: 'x.collection_completed',
        runId: run.id,
        count: page.posts.length,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      await this.db.xCollectionRun.updateMany({
        where: { id: run.id, token: run.token },
        data: {
          status: 'FAILED',
          errorMessage:
            error instanceof PipelineError
              ? error.message
              : 'La collecte a échoué. Les pages téléchargées et les publications déjà enregistrées sont conservées.',
          finishedAt: new Date(),
          token: null,
          leaseUntil: null,
        },
      });
      logger.error({
        event: 'x.collection_failed',
        runId: run.id,
        code: error instanceof PipelineError ? error.code : 'COLLECTION_ERROR',
      });
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
}
