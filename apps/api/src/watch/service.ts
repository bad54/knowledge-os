import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  watchSettingsSchema,
  type WatchOverview,
  type WatchSettingsInput,
  type WatchSourceView,
  type WatchCandidateView,
  type WatchRunView,
} from '@knowledge/shared';
import { canonicalUrl } from '../ingestion/safe-fetcher';
import { json } from '../processing/jobs.repository';
import { rankEntry } from './ranking';
import { settingsInput, watchLock, WatchRepository } from './repository';

const include = {
  source: true,
  job: { select: { id: true, status: true, cardId: true } },
} as const;
type Candidate = Prisma.WatchCandidateGetPayload<{ include: typeof include }>;
type Source = Candidate['source'];
const sourceView = (s: Source): WatchSourceView => ({
  id: s.id,
  name: s.name,
  url: s.url,
  enabled: s.enabled,
  lastSuccessAt: s.lastSuccessAt?.toISOString() || null,
  errorMessage: s.errorMessage,
});
function view(
  c: Candidate,
  ranking = {
    selectionScore: c.selectionScore,
    reasons: c.reasons,
    rankingVersion: c.rankingVersion,
  },
): WatchCandidateView {
  return {
    id: c.id,
    title: c.title,
    url: c.url,
    excerpt: c.excerpt,
    author: c.author,
    publishedAt: c.publishedAt?.toISOString() || null,
    discoveredAt: c.discoveredAt.toISOString(),
    language: c.language,
    ...ranking,
    status: c.status,
    decision: c.decision,
    source: sourceView(c.source),
    job: c.job,
  };
}
function utcDay() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
export class WatchService {
  constructor(private readonly repository: WatchRepository) {}
  async overview(): Promise<WatchOverview> {
    const { db } = this.repository;
    const settings = await this.repository.settings();
    const input = settingsInput(settings);
    const [sources, runs, pending, decisions, selectedToday] = await Promise.all([
      db.watchSource.findMany({ orderBy: { createdAt: 'asc' } }),
      db.watchRun.findMany({ orderBy: { createdAt: 'desc' }, take: 15 }),
      db.watchCandidate.findMany({
        where: { status: 'PENDING', source: { enabled: true } },
        include,
        orderBy: { discoveredAt: 'desc' },
        take: 1000,
      }),
      db.watchCandidate.findMany({
        where: { status: { not: 'PENDING' } },
        include,
        orderBy: { decidedAt: 'desc' },
        take: 20,
      }),
      db.watchCandidate.count({ where: { status: 'ACCEPTED', decidedAt: { gte: utcDay() } } }),
    ]);
    const candidates = pending
      .flatMap((c) => {
        const rank = rankEntry(c, input);
        return rank ? [view(c, rank)] : [];
      })
      .sort(
        (a, b) =>
          b.selectionScore - a.selectionScore || b.discoveredAt.localeCompare(a.discoveredAt),
      )
      .slice(0, 100);
    return {
      settings: { ...input, nextRunAt: settings.nextRunAt?.toISOString() || null },
      sources: sources.map(sourceView),
      runs: runs.map((r): WatchRunView => ({
        id: r.id,
        status: r.status,
        trigger: r.trigger,
        scanned: r.scanned,
        added: r.added,
        filtered: r.filtered,
        issues: r.issues as unknown as WatchRunView['issues'],
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() || null,
      })),
      candidates,
      recentDecisions: decisions.map((c) => view(c)),
      selectedToday,
      rankingMode: 'keywords',
    };
  }
  async saveSettings(input: WatchSettingsInput) {
    await this.repository.settings();
    return this.repository.db.$transaction(async (tx) => {
      await watchLock(tx, 'decision');
      const previous = await tx.watchSettings.findUniqueOrThrow({ where: { id: 'personal' } });
      return tx.watchSettings.update({
        where: { id: 'personal' },
        data: {
          ...input,
          nextRunAt: input.scheduleEnabled
            ? previous.scheduleEnabled
              ? previous.nextRunAt
              : new Date()
            : null,
        },
      });
    });
  }
  async addSource(input: { name: string; url: string }) {
    const url = canonicalUrl(input.url);
    return this.repository.db.$transaction(async (tx) => {
      await watchLock(tx, 'sources');
      const existing = await tx.watchSource.findUnique({ where: { url } });
      if (!existing?.enabled && (await tx.watchSource.count({ where: { enabled: true } })) >= 10)
        throw new ConflictException(
          'Dix flux actifs maximum. Désactivez un flux pour en ajouter un autre.',
        );
      if (!existing && (await tx.watchSource.count()) >= 50)
        throw new ConflictException('Limite de cinquante sources enregistrées atteinte.');
      return tx.watchSource.upsert({
        where: { url },
        create: { ...input, url },
        update: { name: input.name, enabled: true },
      });
    });
  }
  async setSource(id: string, enabled: boolean) {
    return this.repository.db.$transaction(async (tx) => {
      await watchLock(tx, 'sources');
      const source = await tx.watchSource.findUnique({ where: { id } });
      if (!source) throw new NotFoundException('Flux introuvable');
      if (
        enabled &&
        !source.enabled &&
        (await tx.watchSource.count({ where: { enabled: true } })) >= 10
      )
        throw new ConflictException('Dix flux actifs maximum.');
      return tx.watchSource.update({ where: { id }, data: { enabled } });
    });
  }
  collect() {
    return this.repository.enqueue();
  }
  async decide(id: string, decision: 'KEEP' | 'KNOWN' | 'OFF_TOPIC' | 'SKIP') {
    await this.repository.settings();
    return this.repository.db.$transaction(async (tx) => {
      await watchLock(tx, 'decision');
      const candidate = await tx.watchCandidate.findUnique({ where: { id }, include });
      if (!candidate) throw new NotFoundException('Proposition introuvable');
      if (candidate.status === 'ACCEPTED' && decision === 'KEEP') return view(candidate);
      if (candidate.status !== 'PENDING')
        throw new ConflictException('Cette proposition a déjà été traitée.');
      if (decision !== 'KEEP')
        return view(
          await tx.watchCandidate.update({
            where: { id },
            data: { status: 'DISMISSED', decision, decidedAt: new Date() },
            include,
          }),
        );
      const settings = await tx.watchSettings.findUniqueOrThrow({ where: { id: 'personal' } });
      if (
        !candidate.source.enabled ||
        !rankEntry(candidate, watchSettingsSchema.parse(settingsInput(settings)))
      )
        throw new ConflictException('Cette proposition ne correspond plus aux réglages actuels.');
      const selected = await tx.watchCandidate.count({
        where: { status: 'ACCEPTED', decidedAt: { gte: utcDay() } },
      });
      if (selected >= settings.dailyLimit)
        throw new ConflictException(
          'Plafond quotidien atteint. Modifiez vos réglages ou revenez demain (jour UTC).',
        );
      const job = await tx.processingJob.create({
        data: {
          input: json({
            url: candidate.url,
            title: candidate.title,
            ...(candidate.author ? { author: candidate.author } : {}),
            ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt.toISOString() } : {}),
          }),
          discovery: json({
            kind: 'rss',
            candidateId: candidate.id,
            discoveredAt: candidate.discoveredAt.toISOString(),
            feed: candidate.feedSnapshot,
          }),
        },
      });
      return view(
        await tx.watchCandidate.update({
          where: { id },
          data: { status: 'ACCEPTED', decision, decidedAt: new Date(), jobId: job.id },
          include,
        }),
      );
    });
  }
}
