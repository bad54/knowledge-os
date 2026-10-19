import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  ConflictException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { filterSchema, ingestSchema, searchSchema } from '@knowledge/shared';
import { JobsRepository } from '../processing/jobs.repository';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { Database } from '../infrastructure/database';
import { validatePublicUrl } from '../ingestion/safe-fetcher';
@ApiTags('Inbox')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(@Inject(JobsRepository) private readonly jobs: JobsRepository) {}
  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Capturer une URL ou un texte ; retourne un traitement à suivre' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', format: 'uri' },
        text: { type: 'string', minLength: 20, maxLength: 100000 },
        title: { type: 'string', maxLength: 300 },
        author: { type: 'string' },
        publishedAt: { type: 'string', format: 'date-time' },
        sourceType: { type: 'string', enum: ['manual', 'web', 'youtube', 'reddit', 'x'] },
        transcript: { type: 'string', maxLength: 100000 },
      },
    },
  })
  async create(@Body() body: unknown) {
    const input = ingestSchema.parse(body);
    if (input.url) validatePublicUrl(input.url);
    const job = await this.jobs.create(input);
    return { id: job.id, status: job.status };
  }
  @Get() list() {
    return this.jobs.list();
  }
  @Get(':id') async get(@Param('id', new ParseUUIDPipe()) id: string) {
    const job = await this.jobs.get(id);
    if (!job) throw new NotFoundException('Traitement introuvable');
    return job;
  }
  @Post(':id/retry')
  @HttpCode(202)
  async retry(@Param('id', new ParseUUIDPipe()) id: string) {
    if (!(await this.jobs.retry(id)))
      throw new ConflictException('Seul un traitement échoué peut être relancé');
    return { id, status: 'CREATED' };
  }
}
@ApiTags('Knowledge')
@ApiBearerAuth()
@Controller()
export class KnowledgeController {
  constructor(
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(JobsRepository) private readonly jobs: JobsRepository,
    @Inject(Database) private readonly db: Database,
  ) {}
  @Get('health') async health() {
    await this.db.$queryRawUnsafe('SELECT 1');
    return { status: 'ok' };
  }
  @Get('dashboard') dashboard() {
    return this.knowledge.dashboard();
  }
  @Get('topics') topics() {
    return this.knowledge.topics();
  }
  @Get('cards') list(@Query() query: unknown) {
    return this.knowledge.list(filterSchema.parse(query));
  }
  @Get('cards/:id') async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    const card = await this.knowledge.detail(id);
    if (!card) throw new NotFoundException('Fiche introuvable');
    return card;
  }
  @Post('cards/:id/reanalyze')
  @HttpCode(202)
  async reanalyze(@Param('id', new ParseUUIDPipe()) id: string) {
    const job = await this.jobs.reanalyze(id);
    if (!job) throw new NotFoundException('Fiche introuvable');
    return { id: job.id, status: job.status };
  }
  @Get('search')
  @ApiOperation({
    summary:
      'Recherche hybride (RRF), texte ou sémantique ; filtres source, topic, from, to, minScore',
  })
  search(@Query() query: unknown) {
    return this.knowledge.search(searchSchema.parse(query));
  }
}
