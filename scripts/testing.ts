import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../apps/api/src/config';
async function main() {
  const config = loadConfig();
  const target = new URL(process.env.TEST_DATABASE_URL || config.DATABASE_URL);
  if (!process.env.TEST_DATABASE_URL) target.pathname = target.pathname + '_test';
  const name = target.pathname.slice(1);
  if (!/^[a-zA-Z0-9_]+_test$/.test(name)) throw new Error('Test database name must end in _test');
  const admin = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
  try {
    const existing = await admin.$queryRawUnsafe<{ datname: string }[]>(
      'SELECT datname FROM pg_database WHERE datname=$1',
      name,
    );
    if (!existing.length) await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
  } finally {
    await admin.$disconnect();
  }
  const env = {
    ...process.env,
    DATABASE_URL: target.toString(),
    TEST_DATABASE_URL: target.toString(),
    LOG_LEVEL: 'silent',
  };
  const migration = spawnSync(
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'],
    { env, stdio: 'inherit' },
  );
  if (migration.status !== 0) process.exit(migration.status || 1);
  const type = process.argv[2];
  if (type === 'prepare') return;
  const args =
    type === 'e2e'
      ? ['playwright', 'test']
      : ['vitest', 'run', '--config', 'vitest.integration.config.mts'];
  const result = spawnSync('npx', args, { env, stdio: 'inherit' });
  process.exitCode = result.status || 0;
}
void main().catch(() => {
  process.stderr.write(
    'Test setup failed. Check DATABASE_URL, test database permissions and migrations.\n',
  );
  process.exitCode = 1;
});
