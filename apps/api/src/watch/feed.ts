import { JSDOM } from 'jsdom';
import { ContentFetcher, PipelineError } from '@knowledge/domain';
import { canonicalUrl } from '../ingestion/safe-fetcher';

export interface FeedEntry {
  url: string;
  externalId: string | null;
  title: string;
  excerpt: string;
  author: string | null;
  publishedAt: string | null;
  language: string;
}
export interface FeedReader {
  read(url: string): Promise<FeedEntry[]>;
}
function plain(value: string, max: number) {
  const dom = new JSDOM(value);
  try {
    dom.window.document.querySelectorAll('script,style,iframe,object').forEach((n) => n.remove());
    return (dom.window.document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max);
  } finally {
    dom.window.close();
  }
}
function child(node: Element, ...names: string[]) {
  return Array.from(node.children).find((e) => names.includes(e.localName));
}
function value(node: Element, ...names: string[]) {
  return child(node, ...names)?.textContent?.trim() || '';
}
export function parseFeed(xml: string, baseUrl: string): FeedEntry[] {
  if (Buffer.byteLength(xml, 'utf8') > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new PipelineError(
      'INVALID_FEED',
      'Flux XML trop volumineux ou déclaration externe refusée',
      false,
    );
  let dom: JSDOM;
  try {
    dom = new JSDOM(xml, { contentType: 'text/xml' });
  } catch {
    throw new PipelineError('INVALID_FEED', 'Le document n’est pas un flux XML valide', false);
  }
  try {
    const root = dom.window.document.documentElement;
    if (!['rss', 'feed', 'RDF'].includes(root.localName))
      throw new PipelineError('INVALID_FEED', 'Seuls les flux RSS et Atom sont acceptés', false);
    const atom = root.localName === 'feed';
    const channel = child(root, 'channel') || root;
    const language = (value(channel, 'language') || root.getAttribute('xml:lang') || 'und')
      .toLowerCase()
      .slice(0, 40);
    const nodes = Array.from(root.getElementsByTagNameNS('*', atom ? 'entry' : 'item')).slice(
      0,
      100,
    );
    const entries: FeedEntry[] = [];
    for (const node of nodes) {
      const title = plain(value(node, 'title'), 300);
      const link = atom
        ? Array.from(node.children)
            .find(
              (e) =>
                e.localName === 'link' &&
                (!e.getAttribute('rel') || e.getAttribute('rel') === 'alternate'),
            )
            ?.getAttribute('href')
        : value(node, 'link');
      if (!link || !title) continue;
      let url: string;
      try {
        url = canonicalUrl(new URL(link, baseUrl).toString());
      } catch {
        continue;
      }
      if (url.length > 2048) continue;
      const rawDate = value(node, 'pubDate', 'published', 'date', 'updated');
      const date = new Date(rawDate);
      entries.push({
        url,
        title,
        externalId: value(node, 'guid', 'id').slice(0, 2048) || null,
        excerpt: plain(value(node, 'encoded', 'content', 'description', 'summary'), 4000),
        author:
          plain(
            value(node, 'creator') ||
              (child(node, 'author')
                ? value(child(node, 'author')!, 'name') || value(node, 'author')
                : ''),
            300,
          ) || null,
        publishedAt: rawDate && Number.isFinite(date.getTime()) ? date.toISOString() : null,
        language: (node.getAttribute('xml:lang') || language).toLowerCase().slice(0, 40),
      });
    }
    return entries;
  } finally {
    dom.window.close();
  }
}
export class RssFeedReader implements FeedReader {
  constructor(private readonly fetcher: ContentFetcher) {}
  async read(url: string) {
    const result = await this.fetcher.fetch(url, {
      accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml',
    });
    return parseFeed(result.text, result.url);
  }
}
