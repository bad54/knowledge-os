import { describe, expect, it } from 'vitest';
import { parseFeed, RssFeedReader } from '../../apps/api/src/watch/feed';
import { rankEntry } from '../../apps/api/src/watch/ranking';
import type { WatchSettingsInput } from '@knowledge/shared';
const settings: WatchSettingsInput = {
  topics: ['IA', 'n8n'],
  includeKeywords: [],
  excludeKeywords: ['crypto'],
  languages: ['fr'],
  dailyLimit: 5,
  scheduleEnabled: false,
};
describe('RSS / Atom discovery and explicit keyword ranking', () => {
  it('normalizes RSS, strips markup, preserves attribution and rejects unsafe item links', () => {
    const entries = parseFeed(
      `<rss version="2.0"><channel><language>fr-FR</language><item><guid>article-1</guid><title>Un guide n8n</title><link>/article?utm_source=rss</link><description><![CDATA[<p>Un résumé <b>utile</b>.</p><script>bad()</script>]]></description><author>Marie</author><pubDate>Mon, 26 Oct 2026 12:00:00 GMT</pubDate></item><item><title>Privé</title><link>http://127.0.0.1/secret</link></item></channel></rss>`,
      'https://example.com/feed',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      externalId: 'article-1',
      url: 'https://example.com/article',
      author: 'Marie',
      excerpt: 'Un résumé utile.',
      language: 'fr-fr',
      publishedAt: '2026-10-26T12:00:00.000Z',
    });
  });
  it('reads Atom namespaces, alternate links, authors and invalid dates', () => {
    const entries = parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en"><entry><id>urn:1</id><title>AI workflows</title><link rel="self" href="/entry.xml"/><link rel="alternate" href="/guide"/><author><name>Alex</name></author><summary>Plain summary</summary><published>bad date</published></entry></feed>`,
      'https://example.com/atom',
    );
    expect(entries[0]).toMatchObject({
      url: 'https://example.com/guide',
      author: 'Alex',
      language: 'en',
      publishedAt: null,
    });
  });
  it('rejects DTDs, entity declarations, malformed XML, HTML and oversized feeds', () => {
    for (const xml of [
      '<!DOCTYPE rss SYSTEM "file:///etc/passwd"><rss/>',
      '<!ENTITY x "a"><rss/>',
      '<rss>',
      '<html><body/></html>',
      'a'.repeat(2 * 1024 * 1024 + 1),
    ])
      expect(() => parseFeed(xml, 'https://example.com')).toThrow();
  });
  it('uses the injected safe fetcher and the final redirected URL as a base', async () => {
    const reader = new RssFeedReader({
      fetch: async () => ({
        url: 'https://example.com/new/feed',
        contentType: 'application/rss+xml',
        text: '<rss><channel><item><title>Guide</title><link>article</link></item></channel></rss>',
      }),
    });
    expect((await reader.read('https://example.com/old'))[0].url).toBe(
      'https://example.com/new/article',
    );
  });
  it('ranks exact words and phrases without confusing AI with ordinary substrings', () => {
    expect(
      rankEntry(
        { title: 'Available information', excerpt: '', language: 'fr' },
        { ...settings, topics: ['AI'] },
      ),
    ).toBeNull();
    const rank = rankEntry(
      { title: 'Un guide N8N pour l’IA', excerpt: '', language: 'fr-CA' },
      settings,
    );
    expect(rank?.selectionScore).toBe(100);
    expect(rank?.rankingVersion).toBe('keywords.v1');
    expect(rank?.reasons.join(' ')).toContain('fiabilité non évaluées');
  });
  it('applies exclusions first, filters declared languages and marks unknown ones', () => {
    expect(rankEntry({ title: 'n8n et crypto', excerpt: '', language: 'fr' }, settings)).toBeNull();
    expect(rankEntry({ title: 'n8n workflows', excerpt: '', language: 'en' }, settings)).toBeNull();
    expect(
      rankEntry({ title: 'n8n workflows', excerpt: '', language: 'und' }, settings)?.reasons.join(
        ' ',
      ),
    ).toContain('Langue non indiquée');
  });
  it('uses no quality score when no preference is configured', () => {
    expect(
      rankEntry(
        { title: 'Any article', excerpt: '', language: 'und' },
        { ...settings, topics: [], excludeKeywords: [] },
      )?.selectionScore,
    ).toBe(0);
  });
});
