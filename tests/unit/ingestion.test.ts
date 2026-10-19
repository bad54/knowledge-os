import { describe, expect, it } from 'vitest';
import { ingestSchema, analysisSchema, globalScore } from '@knowledge/shared';
import {
  ManualTextAdapter,
  WebPageAdapter,
  YouTubeAdapter,
  RestrictedPlatformAdapter,
  AdapterRegistry,
  youtubeId,
} from '../../apps/api/src/ingestion/adapters';
import {
  validatePublicUrl,
  isPublicIp,
  canonicalUrl,
} from '../../apps/api/src/ingestion/safe-fetcher';
import { LocalProvider, validateEmbedding } from '../../apps/api/src/ai/providers';
import { AppConfig } from '../../apps/api/src/config';

const input = {
  title: 'Automatiser le reporting',
  text: 'Automatiser le reporting avec des données fiables. Conserver la provenance de chaque indicateur.',
};
const config = { YOUTUBE_API_KEY: '', YOUTUBE_ACCESS_TOKEN: '' } as AppConfig;
describe('Input, adapters and provenance', () => {
  it('rejects empty, oversized and unexpected API fields', () => {
    for (const v of [
      {},
      { text: 'court' },
      { text: 'x'.repeat(100001) },
      { ...input, secret: 'bad' },
    ])
      expect(ingestSchema.safeParse(v).success).toBe(false);
  });
  it('normalizes manual text and preserves original attribution', async () => {
    const adapter = new ManualTextAdapter();
    const i = {
      ...input,
      url: 'https://example.com/article',
      author: 'Auteur',
      sourceType: 'reddit' as const,
    };
    const normalized = await adapter.normalize(await adapter.fetch(i), i);
    expect(normalized).toMatchObject({
      ...input,
      author: i.author,
      sourceType: i.sourceType,
      originalUrl: i.url,
    });
  });
  it('extracts web text without executing scripts or fetching subresources', async () => {
    const adapter = new WebPageAdapter({
      fetch: async () => ({
        url: 'https://example.com/a',
        contentType: 'text/html',
        text:
          '<html><head><title>Article</title></head><body><article><h1>Article</h1><p>' +
          input.text.repeat(8) +
          '</p><script>throw new Error("must not run")</script></article></body></html>',
      }),
    });
    const i = { url: 'https://example.com/a' };
    const normalized = await adapter.normalize(await adapter.fetch(i), i);
    expect(normalized.text).toContain('Conserver la provenance');
    expect(normalized.text).not.toContain('must not run');
    expect(normalized.originalUrl).toBe(i.url);
  });
  it('supports YouTube with a manually authorized timestamped transcript', async () => {
    const adapter = new YouTubeAdapter(
      {
        fetch: async () => {
          throw new Error('network must not run');
        },
      },
      config,
    );
    const i = {
      url: 'https://youtu.be/dQw4w9WgXcQ',
      transcript: '00:01 Conserver les sources. 00:12 Automatiser les rapports.',
    };
    const normalized = await adapter.normalize(await adapter.fetch(i), i);
    expect(normalized.externalId).toBe('dQw4w9WgXcQ');
    expect(normalized.text).toContain('00:12');
    expect(youtubeId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
  it('fails clearly without accessible YouTube captions', async () => {
    const adapter = new YouTubeAdapter(
      {
        fetch: async () => {
          throw new Error('network must not run');
        },
      },
      config,
    );
    await expect(adapter.fetch({ url: 'https://youtu.be/dQw4w9WgXcQ' })).rejects.toMatchObject({
      code: 'TRANSCRIPT_REQUIRED',
    });
  });
  it('routes manual platform imports without scraping restricted platforms', async () => {
    const restricted = new RestrictedPlatformAdapter('x');
    const registry = new AdapterRegistry([new ManualTextAdapter(), restricted]);
    expect(registry.resolve({ ...input, url: 'https://x.com/test/status/123' }).type).toBe(
      'manual',
    );
    await expect(restricted.fetch()).rejects.toMatchObject({ code: 'CREDENTIALS_REQUIRED' });
  });
});
describe('URL security and identity', () => {
  it.each([
    'http://127.0.0.1',
    'http://2130706433',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://169.254.169.254',
    'http://10.1.1.1',
    'http://localhost',
    'https://a.internal',
    'file:///etc/passwd',
    'https://a:b@example.com',
    'https://example.com:444',
  ])('rejects unsafe URL %s', (url) => expect(() => validatePublicUrl(url)).toThrow());
  it('accepts public addresses and removes only known tracking parameters', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('192.168.1.1')).toBe(false);
    expect(canonicalUrl('https://example.com/a?b=2&utm_source=test&a=1#frag')).toBe(
      'https://example.com/a?a=1&b=2',
    );
  });
});
describe('Structured analysis and embeddings', () => {
  it('validates all scores, keeps the local fallback explicit, and produces a finite vector', async () => {
    const adapter = new ManualTextAdapter();
    const content = await adapter.normalize(await adapter.fetch(input), input);
    const provider = new LocalProvider();
    const result = await provider.analyzeContent(content);
    expect(analysisSchema.parse(result.analysis).insights).toEqual([]);
    expect(globalScore(result.analysis)).toBe(5);
    expect(analysisSchema.safeParse({ ...result.analysis, qualityScore: 11 }).success).toBe(false);
    const vector = await provider.createEmbedding(content.text);
    expect(vector).toHaveLength(1536);
    expect(Math.sqrt(vector.reduce((s, v) => s + v * v, 0))).toBeCloseTo(1);
    expect(() => validateEmbedding([NaN])).toThrow();
  });
});
