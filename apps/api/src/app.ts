import 'reflect-metadata';
import { timingSafeEqual } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response, json as expressJson } from 'express';
import helmet from 'helmet';
import { AIProvider, ContentFetcher } from '@knowledge/domain';
import { AppConfig } from './config';
import { Database } from './infrastructure/database';
import { logger } from './infrastructure/logger';
import { LocalProvider, OpenAIProvider } from './ai/providers';
import {
  AdapterRegistry,
  ManualTextAdapter,
  RestrictedPlatformAdapter,
  WebPageAdapter,
  YouTubeAdapter,
} from './ingestion/adapters';
import { SafeFetcher } from './ingestion/safe-fetcher';
import { JobsRepository } from './processing/jobs.repository';
import { ContentRepository } from './processing/content.repository';
import { Pipeline } from './processing/pipeline';
import { KnowledgeService } from './knowledge/knowledge.service';
import { JobsController, KnowledgeController } from './api/controllers';
import { ApiErrors } from './api/errors';
import { RssFeedReader } from './watch/feed';
import { WatchRepository } from './watch/repository';
import { WatchService } from './watch/service';
import { WatchCollector, WatchWorker } from './watch/collector';
import { WatchController } from './watch/controller';
export interface AppOptions {
  ai?: AIProvider;
  fetcher?: ContentFetcher;
  worker?: boolean;
}
export async function createApplication(config: AppConfig, options: AppOptions = {}) {
  const ai =
    options.ai ||
    (config.AI_PROVIDER === 'openai' ? new OpenAIProvider(config) : new LocalProvider());
  const fetcher = options.fetcher || new SafeFetcher();
  const registry = new AdapterRegistry([
    new ManualTextAdapter(),
    new YouTubeAdapter(fetcher, config),
    new RestrictedPlatformAdapter('reddit'),
    new RestrictedPlatformAdapter('x'),
    new WebPageAdapter(fetcher),
  ]);
  @Module({
    controllers: [JobsController, KnowledgeController, WatchController],
    providers: [
      Database,
      {
        provide: WatchRepository,
        useFactory: (db: Database) => new WatchRepository(db),
        inject: [Database],
      },
      {
        provide: WatchService,
        useFactory: (repository: WatchRepository) => new WatchService(repository),
        inject: [WatchRepository],
      },
      {
        provide: WatchCollector,
        useFactory: (repository: WatchRepository) =>
          new WatchCollector(repository, new RssFeedReader(fetcher)),
        inject: [WatchRepository],
      },
      {
        provide: JobsRepository,
        useFactory: (db: Database) => new JobsRepository(db),
        inject: [Database],
      },
      {
        provide: ContentRepository,
        useFactory: (db: Database) => new ContentRepository(db),
        inject: [Database],
      },
      {
        provide: KnowledgeService,
        useFactory: (db: Database) => new KnowledgeService(db, ai),
        inject: [Database],
      },
      ...(options.worker === false
        ? []
        : [
            {
              provide: WatchWorker,
              useFactory: (repository: WatchRepository, collector: WatchCollector) =>
                new WatchWorker(repository, collector),
              inject: [WatchRepository, WatchCollector],
            },
            {
              provide: Pipeline,
              useFactory: (jobs: JobsRepository, contents: ContentRepository) =>
                new Pipeline(jobs, contents, registry, ai),
              inject: [JobsRepository, ContentRepository],
            },
          ]),
    ],
  })
  class AppModule {}
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  app.enableCors({ origin: config.WEB_ORIGIN, allowedHeaders: ['Content-Type', 'Authorization'] });
  app.use(helmet());
  app.use(expressJson({ limit: '512kb' }));
  const limits = new Map<string, { count: number; until: number }>();
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.path === '/health') return next();
    if (config.API_TOKEN) {
      const actual = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from('Bearer ' + config.API_TOKEN);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        return res.status(401).json({ message: 'Jeton API requis' });
    }
    const key = req.ip || 'unknown';
    const now = Date.now();
    let bucket = limits.get(key);
    if (!bucket || bucket.until < now) {
      bucket = { count: 0, until: now + 60000 };
      limits.set(key, bucket);
    }
    if (++bucket.count > 120)
      return res.status(429).json({ message: 'Trop de requêtes ; réessayez dans une minute' });
    if (limits.size > 10000) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    const start = Date.now();
    res.on('finish', () =>
      logger.info({
        event: 'api.request',
        method: req.method,
        status: res.statusCode,
        durationMs: Date.now() - start,
      }),
    );
    next();
  });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiErrors());
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Knowledge OS')
      .setVersion('1.0.0')
      .setDescription('Capture, provenance, analyses versionnées et recherche. Mono-utilisateur.')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/openapi.json' });
  app.enableShutdownHooks();
  return app;
}
