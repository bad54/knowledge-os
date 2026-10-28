import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from '@knowledge/shared';
import { xAskSchema, xBrowseSchema, xIdSchema, xRuleSchema } from '@knowledge/shared';
import { XService } from './service';
import { XCollection } from './collection';
import { XAnswers } from './answers';
@ApiTags('Corpus X')
@ApiBearerAuth()
@Controller('x')
export class XController {
  constructor(
    @Inject(XService) private readonly x: XService,
    @Inject(XCollection) private readonly collection: XCollection,
    @Inject(XAnswers) private readonly answers: XAnswers,
  ) {}
  @Get() overview() {
    return this.x.overview();
  }
  @Get('posts') posts(@Query() query: unknown) {
    return this.x.search.browse(xBrowseSchema.parse(query));
  }
  @Post('status')
  @ApiOperation({
    summary: 'Actualiser au maximum cent publications visibles sans relancer une recherche IA',
  })
  status(@Body() body: unknown) {
    const { ids } = z
      .object({ ids: z.array(xIdSchema).max(100) })
      .strict()
      .parse(body);
    return this.x.search.hydrate(ids);
  }
  @Post('import')
  @ApiOperation({
    summary: 'Importer 1 à 100 captures V12 ; les champs inconnus et secrets ne sont pas conservés',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['posts'],
      properties: {
        posts: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object' } },
        autoCards: { type: 'boolean', default: true },
      },
    },
  })
  import(@Body() body: unknown) {
    return this.x.importPosts(body);
  }
  @Post('rules')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'query', 'topic'],
      properties: {
        name: { type: 'string' },
        query: { type: 'string' },
        topic: { type: 'string' },
        mode: { type: 'string', enum: ['recent', 'archive'] },
        startTime: { type: 'string', format: 'date-time' },
        endTime: { type: 'string', format: 'date-time' },
        enabled: { type: 'boolean', default: false },
        intervalMinutes: { type: 'integer', minimum: 30 },
        maxPosts: { type: 'integer', minimum: 10, maximum: 100 },
        autoCards: { type: 'boolean' },
      },
    },
  })
  rule(@Body() body: unknown) {
    return this.collection.addRule(xRuleSchema.parse(body));
  }
  @Patch('rules/:id') toggle(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.collection.toggleRule(
      id,
      z.object({ enabled: z.boolean() }).strict().parse(body).enabled,
    );
  }
  @Post('rules/:id/run') @HttpCode(202) run(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.collection.enqueue(id);
  }
  @Get('posts/:id') detail(@Param('id') id: string) {
    return this.x.detail(xIdSchema.parse(id));
  }
  @Post('posts/:id/card') card(@Param('id') id: string) {
    return this.x.createCard(xIdSchema.parse(id));
  }
  @Post('posts/:id/reindex') retry(@Param('id') id: string) {
    return this.x.retryIndex(xIdSchema.parse(id));
  }
  @Post('ask')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['question'],
      properties: {
        question: { type: 'string', minLength: 5, maxLength: 1000 },
        mode: { type: 'string', enum: ['answer', 'plan', 'decision'] },
      },
    },
  })
  ask(@Body() body: unknown) {
    const input = xAskSchema.parse(body);
    return this.answers.ask(input.question, input.mode);
  }
  @Get('answers/:id') answer(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.answers.detail(id);
  }
}
