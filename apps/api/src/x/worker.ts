import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { XCollection } from './collection';
import { XIndexer } from './indexer';
import { logger } from '../infrastructure/logger';
export class XWorker implements OnModuleInit, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];
  private pending: (Promise<unknown> | undefined)[] = [];
  private stopping = false;
  private scheduleAt = 0;
  constructor(
    private readonly collection: XCollection,
    private readonly indexer: XIndexer,
  ) {}
  onModuleInit() {
    const tasks = [
      async () => {
        if (Date.now() >= this.scheduleAt) {
          this.scheduleAt = Date.now() + 30000;
          await this.collection.schedule();
        }
        await this.collection.runOnce();
      },
      () => this.indexer.runOnce(),
    ];
    tasks.forEach((task, index) => {
      const timer = setInterval(() => {
        if (this.stopping || this.pending[index]) return;
        this.pending[index] = task()
          .catch(() => logger.error({ event: 'x.worker_failed', worker: index }))
          .finally(() => {
            this.pending[index] = undefined;
          });
      }, 1000);
      timer.unref();
      this.timers.push(timer);
    });
  }
  async onModuleDestroy() {
    this.stopping = true;
    this.timers.forEach(clearInterval);
    await Promise.all(this.pending);
  }
}
