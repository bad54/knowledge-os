import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../apps/api/src/config';
const database = { DATABASE_URL: 'postgresql://test:test@localhost/test' };
describe('Hosted API authentication configuration', () => {
  it.each(['', 'short'])('refuses hosted startup with insufficient token %j', (token) => {
    expect(() => loadConfig({ ...database, REQUIRE_API_TOKEN: 'true', API_TOKEN: token })).toThrow(
      'API_TOKEN',
    );
  });
  it('accepts a sufficiently long token without enabling paid AI', () => {
    const config = loadConfig({
      ...database,
      REQUIRE_API_TOKEN: 'true',
      API_TOKEN: 'test-only-token-'.repeat(4),
    });
    expect(config.AI_PROVIDER).toBe('local');
  });
  it('keeps unauthenticated loopback development available explicitly', () => {
    expect(loadConfig(database).REQUIRE_API_TOKEN).toBe('false');
  });
});
