import { createApplication } from './app';
import { loadConfig } from './config';
import { logger } from './infrastructure/logger';
async function main() {
  const config = loadConfig();
  const app = await createApplication(config);
  await app.listen(config.PORT, '::');
  logger.info({ event: 'api.started', port: config.PORT, provider: config.AI_PROVIDER });
}
void main().catch(() => {
  logger.fatal({
    event: 'api.start_failed',
    message: 'Vérifiez la configuration et les migrations',
  });
  process.exitCode = 1;
});
