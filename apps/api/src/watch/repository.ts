import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma, WatchRun, WatchSettings } from '@prisma/client';
import type { WatchSettingsInput } from '@knowledge/shared';
import { Database } from '../infrastructure/database';

export function settingsInput(s: WatchSettings): WatchSettingsInput {
  return {
    topics: s.topics,
    includeKeywords: s.includeKeywords,
    excludeKeywords: s.excludeKeywords,
    languages: s.languages,
    dailyLimit: s.dailyLimit,
    scheduleEnabled: s.scheduleEnabled,
  };
}
export async function watchLock(tx: Prisma.TransactionClient, key: string) {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
    'watch:' + key,
  );
}
export class WatchRepository {
  constructor(readonly db: Database) {}
  settings() {
    return this.db.watchSettings.upsert({ where: { id: 'personal' }, create: {}, update: {} });
  }
  async enqueue(scheduled = false) {
    await this.settings();
    return this.db.$transaction(async (tx) => {
      await watchLock(tx, 'queue');
      const settings = await tx.watchSettings.findUniqueOrThrow({ where: { id: 'personal' } });
      if (
        scheduled &&
        (!settings.scheduleEnabled || !settings.nextRunAt || settings.nextRunAt > new Date())
      )
        return null;
      if (!(await tx.watchSource.count({ where: { enabled: true } }))) {
        if (scheduled) return null;
        throw new ConflictException('Ajoutez au moins un flux actif avant de lancer la veille.');
      }
      const active = await tx.watchRun.findFirst({
        where: { status: { in: ['CREATED', 'FETCHING'] } },
      });
      if (scheduled)
        await tx.watchSettings.update({
          where: { id: 'personal' },
          data: { nextRunAt: new Date(Date.now() + 86400000) },
        });
      return (
        active || tx.watchRun.create({ data: { trigger: scheduled ? 'scheduled' : 'manual' } })
      );
    });
  }
  async claim() {
    await this.db.watchRun.updateMany({
      where: { status: 'FETCHING', leaseUntil: { lt: new Date() }, attempts: { gte: 3 } },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        token: null,
        leaseUntil: null,
        errorMessage: 'Collecte interrompue plusieurs fois. Relance manuelle disponible.',
      },
    });
    const rows = await this.db.$queryRawUnsafe<WatchRun[]>(
      `UPDATE "WatchRun" r SET status='FETCHING', attempts=attempts+1, token=$1::uuid, "leaseUntil"=now()+interval '3 minutes'
       WHERE r.id=(SELECT id FROM "WatchRun" WHERE status='CREATED' OR (status='FETCHING' AND "leaseUntil"<now() AND attempts<3)
       ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING r.*`,
      randomUUID(),
    );
    return rows[0] || null;
  }
  async fence(tx: Prisma.TransactionClient, run: WatchRun) {
    const result = await tx.watchRun.updateMany({
      where: { id: run.id, token: run.token, status: 'FETCHING' },
      data: { leaseUntil: new Date(Date.now() + 180000) },
    });
    if (result.count !== 1) throw new Error('Watch lease lost');
  }
  async heartbeat(run: WatchRun) {
    return this.db.$transaction((tx) => this.fence(tx, run));
  }
}
