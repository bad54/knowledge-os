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
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  watchDecisionSchema,
  watchSettingsSchema,
  watchSourceSchema,
  watchSourceUpdateSchema,
} from '@knowledge/shared';
import { WatchService } from './service';
@ApiTags('Veille')
@ApiBearerAuth()
@Controller('watch')
export class WatchController {
  constructor(@Inject(WatchService) private readonly watch: WatchService) {}
  @Get()
  @ApiOperation({
    summary: 'Réglages, flux, collectes, propositions classées par mots-clés et décisions récentes',
  })
  overview() {
    return this.watch.overview();
  }
  @Put('settings')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'topics',
        'includeKeywords',
        'excludeKeywords',
        'languages',
        'dailyLimit',
        'scheduleEnabled',
      ],
      properties: {
        topics: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        includeKeywords: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        excludeKeywords: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        languages: { type: 'array', items: { type: 'string', pattern: '^[a-z]{2}$' } },
        dailyLimit: { type: 'integer', minimum: 1, maximum: 20 },
        scheduleEnabled: { type: 'boolean' },
      },
    },
  })
  settings(@Body() body: unknown) {
    return this.watch.saveSettings(watchSettingsSchema.parse(body));
  }
  @Post('sources')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'url'],
      properties: {
        name: { type: 'string', maxLength: 150 },
        url: { type: 'string', format: 'uri' },
      },
    },
  })
  source(@Body() body: unknown) {
    return this.watch.addSource(watchSourceSchema.parse(body));
  }
  @Patch('sources/:id')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled'],
      properties: { enabled: { type: 'boolean' } },
    },
  })
  toggle(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.watch.setSource(id, watchSourceUpdateSchema.parse(body).enabled);
  }
  @Post('runs')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Lancer ou retrouver la collecte active ; maximum dix entrées par flux et dix flux actifs',
  })
  collect() {
    return this.watch.collect();
  }
  @Post('candidates/:id/decision')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decision'],
      properties: { decision: { type: 'string', enum: ['KEEP', 'KNOWN', 'OFF_TOPIC', 'SKIP'] } },
    },
  })
  @ApiOperation({
    summary:
      'Garder crée un traitement Inbox idempotent ; les autres choix enregistrent un retour sans publication',
  })
  decide(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.watch.decide(id, watchDecisionSchema.parse(body).decision);
  }
}
