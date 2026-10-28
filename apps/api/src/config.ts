import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import { z } from 'zod';

dotenv({
  path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
  quiet: true,
});
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  API_TOKEN: z.string().default(''),
  REQUIRE_API_TOKEN: z.enum(['true', 'false']).default('false'),
  AI_PROVIDER: z.enum(['local', 'openai']).default('local'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_ANALYSIS_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  YOUTUBE_API_KEY: z.string().default(''),
  YOUTUBE_ACCESS_TOKEN: z.string().default(''),
  X_BEARER_TOKEN: z.string().default(''),
  X_DAILY_READ_LIMIT: z.coerce.number().int().min(10).max(100000).default(100),
  X_AUTO_CARDS_PER_DAY: z.coerce.number().int().min(0).max(100).default(5),
  X_EMBEDDINGS_PER_DAY: z.coerce.number().int().min(1).max(10000).default(500),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});
export type AppConfig = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      'Configuration invalide : ' + parsed.error.issues.map((i) => i.path.join('.')).join(', '),
    );
  if (parsed.data.AI_PROVIDER === 'openai' && !parsed.data.OPENAI_API_KEY)
    throw new Error('OPENAI_API_KEY requis');
  if (parsed.data.REQUIRE_API_TOKEN === 'true' && parsed.data.API_TOKEN.length < 32)
    throw new Error('API_TOKEN doit contenir au moins 32 caractères pour une API exposée');
  return parsed.data;
}
