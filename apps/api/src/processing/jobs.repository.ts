import { randomUUID } from 'node:crypto';
import { Prisma, ProcessingJob, ProcessingStatus } from '@prisma/client';
import { IngestInput } from '@knowledge/shared';
import { Database } from '../infrastructure/database';
export function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export class JobsRepository {
  constructor(readonly db: Database) {}
  create(input: IngestInput) {
    return this.db.processingJob.create({ data: { input: json(input) } });
  }
  createClaimed(input: IngestInput) {
    return this.db.processingJob.create({
      data: {
        input: json(input),
        status: 'FETCHING',
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 180000),
        attempts: 1,
      },
    });
  }
  list() {
    return this.db.processingJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        status: true,
        contentId: true,
        cardId: true,
        attempts: true,
        errorCode: true,
        errorMessage: true,
        retryable: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
  get(id: string) {
    return this.db.processingJob.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        contentId: true,
        cardId: true,
        attempts: true,
        errorCode: true,
        errorMessage: true,
        retryable: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
  async claim(): Promise<ProcessingJob | null> {
    await this.db.processingJob.updateMany({
      where: {
        status: { notIn: ['COMPLETED', 'FAILED', 'CREATED'] },
        leaseUntil: { lt: new Date() },
        attempts: { gte: 5 },
      },
      data: {
        status: 'FAILED',
        errorCode: 'LEASE_EXHAUSTED',
        errorMessage: 'Trop de reprises après interruption. Relance manuelle disponible.',
        token: null,
        leaseUntil: null,
      },
    });
    const jobs = await this.db.$queryRawUnsafe<ProcessingJob[]>(
      'UPDATE "ProcessingJob" j SET status = \'FETCHING\', attempts = attempts+1, token=$1::uuid, "leaseUntil"=now()+interval \'3 minutes\', "updatedAt"=now() WHERE j.id=(SELECT id FROM "ProcessingJob" WHERE (status=\'CREATED\' OR (status NOT IN (\'COMPLETED\',\'FAILED\') AND "leaseUntil"<now() AND attempts<5)) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING j.*',
      randomUUID(),
    );
    return jobs[0] || null;
  }
  async update(job: ProcessingJob, data: Prisma.ProcessingJobUncheckedUpdateManyInput) {
    const result = await this.db.processingJob.updateMany({
      where: { id: job.id, token: job.token },
      data,
    });
    if (result.count !== 1) throw new Error('Processing lease lost');
  }
  heartbeat(job: ProcessingJob) {
    return this.update(job, { leaseUntil: new Date(Date.now() + 180000) });
  }
  step(job: ProcessingJob, status: ProcessingStatus) {
    return this.update(job, { status });
  }
  async retry(id: string) {
    const result = await this.db.processingJob.updateMany({
      where: { id, status: 'FAILED' },
      data: {
        status: 'CREATED',
        token: null,
        leaseUntil: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    return result.count === 1;
  }
  async reanalyze(cardId: string) {
    const card = await this.db.knowledgeCard.findUnique({ where: { id: cardId } });
    if (!card) return null;
    return this.db.processingJob.create({
      data: { contentId: card.contentId, cardId, reanalyze: true, input: {} },
    });
  }
}
