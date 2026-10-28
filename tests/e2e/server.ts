import { createApplication } from '../../apps/api/src/app';
import { loadConfig } from '../../apps/api/src/config';
import { PipelineError } from '@knowledge/domain';
import { Database } from '../../apps/api/src/infrastructure/database';
async function main() {
  const target = process.env.TEST_DATABASE_URL;
  if (!target || !new URL(target).pathname.endsWith('_test'))
    throw new Error('Isolated test database required');
  process.env.DATABASE_URL = target;
  const app = await createApplication(
    {
      ...loadConfig(),
      PORT: 3101,
      API_TOKEN: '',
      WEB_ORIGIN: 'http://127.0.0.1:5174',
      AI_PROVIDER: 'local',
    },
    {
      fetcher: {
        fetch: async (url: string) => {
          if (new URL(url).pathname === '/watch-feed')
            return {
              url,
              contentType: 'application/rss+xml',
              text: '<rss><channel><language>fr</language><item><guid>watch-reporting</guid><title>Veille n8n et reporting</title><link>https://example.com/watch-article</link><description>Une méthode de reporting automatisé avec n8n.</description></item><item><title>Une recette</title><link>https://example.com/recipe</link></item></channel></rss>',
            };
          if (new URL(url).pathname === '/watch-article')
            return {
              url,
              contentType: 'text/html',
              text: '<html><head><title>Veille n8n et reporting</title></head><body><article><p>Cette méthode issue de la veille décrit un reporting avec n8n. Le contenu intégral est téléchargé après validation. Les indicateurs conservent leurs sources et chaque étape peut être vérifiée.</p></article></body></html>',
            };
          if (new URL(url).pathname === '/forbidden')
            throw new PipelineError('HTTP_403', 'La source a répondu HTTP 403', false);
          return {
            url,
            contentType: 'text/html',
            text: '<html><head><title>Article web de test</title></head><body><article><p>Ce document présente une méthode pour automatiser un reporting universitaire. Chaque indicateur conserve sa provenance. Les données sont contrôlées avant la publication. Les workflows n8n orchestrent les appels API.</p></article></body></html>',
          };
        },
      },
    },
  );
  await app
    .get(Database)
    .$executeRawUnsafe(
      'TRUNCATE "XAnswer","XPost","XRule","XUsageDay","WatchCandidate","WatchRun","WatchSource","WatchSettings","ProcessingJob","Content","Topic","Concept" CASCADE',
    );
  await app.listen(3101, '127.0.0.1');
}
void main();
