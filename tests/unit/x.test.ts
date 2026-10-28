import { describe, expect, it, vi } from 'vitest';
import { PipelineError } from '@knowledge/domain';
import { xRuleSchema } from '@knowledge/shared';
import { normalizeV12Post, OfficialXClient, xPermalink } from '../../apps/api/src/x/client';
import { classifyXText, metricEngagement, observedMomentum } from '../../apps/api/src/x/signals';
import { validateCitations } from '../../apps/api/src/x/answers';
import { ExtractiveReasoner } from '../../apps/api/src/ai/knowledge-reasoner';
describe('X source boundaries and evidence', () => {
  it('imports only original texts, preserves attribution and excludes secret/generated fields', () => {
    const p = normalizeV12Post({
      post_id: '123',
      text: 'Tutoriel n8n',
      quoted_text: 'Le texte cité',
      author_name: 'Marie',
      url: 'https://evil.example/status/123',
      external_links: 'http://127.0.0.1/private|https://example.com/guide',
      openaiKey: 'secret',
      knowledge_card: { summary: 'Generated' },
    });
    expect(p.url).toBe('https://x.com/i/status/123');
    expect(p.links).toEqual(['https://example.com/guide']);
    expect(p.coverage).toBe('post_and_quote');
    expect(p.metrics).toBeNull();
    expect(JSON.stringify(p)).not.toMatch(/secret|Generated/);
    expect(p.authorName).toBe('Marie');
    expect(() => normalizeV12Post({ post_id: 'bad', text: 'A' })).toThrow();
    expect(() => normalizeV12Post({ post_id: '123', text: ' ' })).toThrow();
    expect(xPermalink('123', 'https://twitter.com/marie/status/123?utm_source=x')).toBe(
      'https://x.com/marie/status/123',
    );
  });
  it('requires a bounded archive period and keeps automation opt-in', () => {
    const r = { name: 'IA', query: 'AI', topic: 'IA' };
    expect(xRuleSchema.parse(r).enabled).toBe(false);
    expect(() => xRuleSchema.parse({ ...r, mode: 'archive' })).toThrow();
    expect(() => xRuleSchema.parse({ ...r, maxPosts: 200 })).toThrow();
    expect(() =>
      xRuleSchema.parse({
        ...r,
        mode: 'archive',
        startTime: '2026-01-02T00:00:00Z',
        endTime: '2026-01-01T00:00:00Z',
      }),
    ).toThrow();
  });
  it('does not invent growth from a first observation or a counter correction', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    expect(observedMomentum(null, 100, now)).toBeNull();
    expect(
      observedMomentum({ engagement: 10, capturedAt: new Date(now.getTime() - 3600000) }, 30, now),
    ).toBe(20);
    expect(
      observedMomentum({ engagement: 100, capturedAt: new Date(now.getTime() - 3600000) }, 30, now),
    ).toBeNull();
    expect(
      metricEngagement({ like_count: 10, retweet_count: 2, reply_count: 1, quote_count: 1 }),
    ).toBe(16);
    expect(classifyXText('Un guide n8n avec exemple de workflow').utilitySignal).toBeGreaterThan(0);
  });
  it('calls only the official search endpoint with no billing expansions or credential leakage', async () => {
    const fetcher = {
      fetch: vi.fn(async (url: string) => ({
        url,
        contentType: 'application/json',
        text: JSON.stringify({
          data: [
            { id: '123', text: 'Court', note_tweet: { text: 'Contenu long' }, author_id: '456' },
          ],
          meta: { next_token: 'page2', newest_id: '123' },
        }),
      })),
    };
    const client = new OfficialXClient(fetcher, 'private-key');
    const result = await client.search({
      query: 'n8n',
      mode: 'archive',
      maxPosts: 10,
      sinceId: '100',
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-02-01T00:00:00Z',
    });
    const url = new URL(fetcher.fetch.mock.calls[0]![0] as unknown as string);
    expect(url.pathname).toBe('/2/tweets/search/all');
    expect(url.searchParams.has('expansions')).toBe(false);
    expect(url.searchParams.has('since_id')).toBe(false);
    expect(result.posts[0]).toMatchObject({
      text: 'Contenu long',
      authorId: '456',
      coverage: 'post_only',
    });
    expect(JSON.stringify(result)).not.toContain('private-key');
    expect(result.nextToken).toBe('page2');
  });
  it('fails safely on official API restrictions and incomplete payloads', async () => {
    const blocked = new OfficialXClient(
      {
        fetch: async () => {
          throw new PipelineError('HTTP_403', 'secret-from-error');
        },
      },
      'key',
    );
    await expect(blocked.search({ query: 'AI', mode: 'recent', maxPosts: 10 })).rejects.toThrow(
      'X a refusé',
    );
    const invalid = new OfficialXClient(
      {
        fetch: async () => ({
          url: 'https://api.x.com',
          contentType: 'application/json',
          text: '{"errors":[{"detail":"sensitive"}]}',
        }),
      },
      'key',
    );
    await expect(invalid.search({ query: 'AI', mode: 'recent', maxPosts: 10 })).rejects.toThrow(
      'incomplète',
    );
  });
  it('rejects made-up or missing evidence citations and identifies the extractive fallback', async () => {
    const section = { heading: 'Titre', kind: 'evidence', text: 'Texte', citations: [2] };
    expect(() => validateCitations({ sections: [section], warnings: [] }, 1)).toThrow('référence');
    expect(() =>
      validateCitations({ sections: [{ ...section, citations: [] }], warnings: [] }, 1),
    ).toThrow();
    const reasoner = new ExtractiveReasoner();
    const r = await reasoner.answer('Question', 'answer', [
      { postId: '1', text: 'Texte source', origin: 'v12_import', coverage: 'post_only' },
    ]);
    expect(r.answer.sections[0]?.citations).toEqual([1]);
    expect(r.answer.warnings[0]).toContain('Aucune synthèse');
    await expect(reasoner.answer('Question', 'plan', [])).rejects.toThrow('fournisseur IA');
  });
});
