import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { CapturedXPost } from './client';
import { AppConfig } from '../config';
import { json } from '../processing/jobs.repository';
import { classifyXText, metricEngagement, observedMomentum } from './signals';
export function utcDay() {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  return day;
}
export async function xLock(tx: Prisma.TransactionClient, key: string) {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
    'x:' + key,
  );
}
export async function usageDay(tx: Prisma.TransactionClient) {
  return tx.xUsageDay.upsert({ where: { day: utcDay() }, create: { day: utcDay() }, update: {} });
}
export class XPostStore {
  constructor(private readonly config: AppConfig) {}
  async save(tx: Prisma.TransactionClient, posts: CapturedXPost[], topic?: string) {
    let added = 0;
    for (const post of [...posts].sort((a, b) => a.id.localeCompare(b.id))) {
      await xLock(tx, 'post:' + post.id);
      const signal = classifyXText(post.text + '\n' + post.quotedText);
      const topics = [
        ...new Set([...post.topics, ...signal.topics, ...(topic ? [topic] : [])]),
      ].slice(0, 30);
      const created = await tx.xPost.createMany({
        data: [
          {
            id: post.id,
            text: post.text,
            quotedText: post.quotedText,
            quoteUrl: post.quoteUrl,
            url: post.url,
            authorId: post.authorId,
            authorHandle: post.authorHandle,
            authorName: post.authorName,
            conversationId: post.conversationId,
            language: post.language,
            publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
            origin: post.origin,
            coverage: post.coverage,
            links: post.links,
            topics,
            utilitySignal: signal.utilitySignal,
          },
        ],
        skipDuplicates: true,
      });
      added += created.count;
      const hash = createHash('sha256').update(JSON.stringify(post.payload)).digest('hex');
      await tx.xCapture.createMany({
        data: [
          { postId: post.id, contentHash: hash, origin: post.origin, payload: json(post.payload) },
        ],
        skipDuplicates: true,
      });
      if (post.metrics) {
        const at = new Date();
        const previous = await tx.xObservation.findFirst({
          where: { postId: post.id },
          orderBy: { capturedAt: 'desc' },
        });
        const engagement = metricEngagement(post.metrics);
        const momentum = observedMomentum(previous, engagement, at);
        if (!previous || at.getTime() - previous.capturedAt.getTime() >= 15 * 60000) {
          await tx.xObservation.create({
            data: { postId: post.id, metrics: json(post.metrics), engagement, capturedAt: at },
          });
          await tx.xPost.update({ where: { id: post.id }, data: { engagement, momentum } });
        }
      }
    }
    return added;
  }
  async createCard(tx: Prisma.TransactionClient, postId: string) {
    await xLock(tx, 'post:' + postId);
    await xLock(tx, 'cards');
    const post = await tx.xPost.findUniqueOrThrow({ where: { id: postId } });
    if (post.jobId) return post.jobId;
    if ((post.text + post.quotedText).trim().length < 20) return null;
    const usage = await usageDay(tx);
    if (usage.cardsReserved >= this.config.X_AUTO_CARDS_PER_DAY) return null;
    const job = await tx.processingJob.create({
      data: {
        input: json({ url: post.url, sourceType: 'x' }),
        discovery: json({
          kind: 'x_corpus',
          postId: post.id,
          origin: post.origin,
          coverage: post.coverage,
        }),
      },
    });
    await tx.xPost.update({ where: { id: post.id }, data: { jobId: job.id } });
    await tx.xUsageDay.update({
      where: { day: usage.day },
      data: { cardsReserved: { increment: 1 } },
    });
    return job.id;
  }
  async selectCards(tx: Prisma.TransactionClient, ids: string[]) {
    const posts = await tx.xPost.findMany({
      where: { id: { in: ids }, jobId: null, utilitySignal: { gte: 1 } },
      orderBy: [{ utilitySignal: 'desc' }, { capturedAt: 'desc' }],
      take: this.config.X_AUTO_CARDS_PER_DAY,
    });
    for (const post of posts) await this.createCard(tx, post.id);
  }
}
