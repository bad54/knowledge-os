import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AIProvider, PipelineError, RawContent } from '@knowledge/domain';
import { analysisSchema, ingestSchema } from '@knowledge/shared';
import { AdapterRegistry } from '../ingestion/adapters';
import { validateEmbedding } from '../ai/providers';
import { logger } from '../infrastructure/logger';
import { JobsRepository, json } from './jobs.repository';
import { ContentRepository, normalized } from './content.repository';

export class Pipeline implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running?: Promise<boolean>;
  private stopping = false;
  constructor(
    private readonly jobs: JobsRepository,
    private readonly contents: ContentRepository,
    private readonly registry: AdapterRegistry,
    private readonly ai: AIProvider,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      if (!this.running && !this.stopping) {
        this.running = this.runOnce()
          .catch(() => false)
          .finally(() => {
            this.running = undefined;
          });
      }
    }, 700);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }
  async runOnce(): Promise<boolean> {
    const job = await this.jobs.claim();
    if (!job) return false;
    const start = Date.now();
    const heartbeat = setInterval(() => {
      void this.jobs.heartbeat(job).catch(() => {});
    }, 30000);
    heartbeat.unref();
    logger.info({ jobId: job.id, attempt: job.attempts, event: 'pipeline.started' });
    try {
      let content = job.contentId
        ? await this.jobs.db.content.findUnique({ where: { id: job.contentId } })
        : null;
      if (!content) {
        const input = ingestSchema.parse(job.input);
        const adapter = this.registry.resolve(input);
        const raw: RawContent = job.raw
          ? { payload: job.raw as RawContent['payload'] }
          : await adapter.fetch(input);
        await this.jobs.update(job, { raw: json(raw.payload), status: 'EXTRACTING' });
        const n = await adapter.normalize(raw, input);
        if (n.text.length < 20 || n.text.length > 100000)
          throw new PipelineError('INVALID_CONTENT', 'Contenu hors limites', false);
        content = await this.contents.capture(job, n, raw);
      }
      const existing = await this.jobs.db.knowledgeCard.findUnique({
        where: { contentId: content.id },
      });
      if (existing && !job.reanalyze) {
        await this.jobs.update(job, {
          status: 'COMPLETED',
          cardId: existing.id,
          token: null,
          leaseUntil: null,
        });
      } else {
        await this.jobs.step(job, 'ANALYZING');
        const aiStart = Date.now();
        const result = await this.ai.analyzeContent(normalized(content));
        result.analysis = analysisSchema.parse(result.analysis);
        logger.info({
          jobId: job.id,
          event: 'analysis.completed',
          durationMs: Date.now() - aiStart,
          provider: this.ai.name,
          model: result.model,
        });
        await this.jobs.step(job, 'EMBEDDING');
        const vector = validateEmbedding(
          await this.ai.createEmbedding(
            result.analysis.title +
              '\n' +
              result.analysis.summary +
              '\n' +
              result.analysis.keyIdeas.join('\n'),
          ),
        );
        await this.contents.publish(job, content, result, vector, this.ai);
      }
      logger.info({ jobId: job.id, event: 'pipeline.completed', durationMs: Date.now() - start });
    } catch (error) {
      const code = error instanceof PipelineError ? error.code : 'PROCESSING_ERROR';
      const message =
        error instanceof PipelineError
          ? error.message
          : 'Le traitement a échoué. La source est conservée ; réessayez après vérification de la configuration.';
      await this.jobs
        .update(job, {
          status: 'FAILED',
          errorCode: code,
          errorMessage: message,
          retryable: error instanceof PipelineError ? error.retryable : true,
          token: null,
          leaseUntil: null,
        })
        .catch(() => {});
      logger.error({
        jobId: job.id,
        event: 'pipeline.failed',
        code,
        durationMs: Date.now() - start,
      });
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
}
