import { createApplication } from '../../apps/api/src/app';
import { loadConfig } from '../../apps/api/src/config';
import { PipelineError } from '@knowledge/domain';
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
  await app.listen(3101, '127.0.0.1');
}
void main();
