import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { z } from 'zod';
import { IngestInput } from '@knowledge/shared';
import {
  ContentFetcher,
  NormalizedContent,
  PipelineError,
  RawContent,
  SourceAdapter,
  SourceType,
} from '@knowledge/domain';
import { AppConfig } from '../config';
import { canonicalUrl, validatePublicUrl } from './safe-fetcher';

function base(input: IngestInput, sourceType: SourceType): NormalizedContent {
  return {
    sourceType,
    originalUrl: input.url || null,
    externalId: null,
    title: input.title || 'Ressource sans titre',
    author: input.author || null,
    publishedAt: input.publishedAt || null,
    capturedAt: new Date().toISOString(),
    text: '',
    language: 'und',
    metadata: {},
  };
}
export class ManualTextAdapter implements SourceAdapter {
  readonly type = 'manual' as const;
  canHandle(input: IngestInput) {
    return !!input.text;
  }
  async fetch(input: IngestInput): Promise<RawContent> {
    return { payload: { text: input.text || '' } };
  }
  async normalize(raw: RawContent, input: IngestInput) {
    const text = z
      .object({ text: z.string().min(20).max(100000) })
      .parse(raw.payload)
      .text.trim();
    if (input.url) validatePublicUrl(input.url);
    return {
      ...base(input, input.sourceType || 'manual'),
      title: input.title || text.slice(0, 90),
      text,
    };
  }
}
export class WebPageAdapter implements SourceAdapter {
  readonly type = 'web' as const;
  constructor(private readonly fetcher: ContentFetcher) {}
  canHandle(input: IngestInput) {
    return !!input.url;
  }
  async fetch(input: IngestInput): Promise<RawContent> {
    const r = await this.fetcher.fetch(input.url!);
    if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(r.contentType))
      throw new PipelineError(
        'UNSUPPORTED_FORMAT',
        'Cette ressource doit être une page HTML ou un texte public',
        false,
      );
    return { payload: r };
  }
  async normalize(raw: RawContent, input: IngestInput) {
    const r = z
      .object({ text: z.string(), url: z.string(), contentType: z.string() })
      .parse(raw.payload);
    let text = r.text;
    let title = input.title;
    let author = input.author;
    if (!r.contentType.includes('text/plain')) {
      const dom = new JSDOM(r.text, { url: r.url });
      try {
        const article = new Readability(dom.window.document).parse();
        text = article?.textContent || '';
        title = title || article?.title || dom.window.document.title;
        author = author || article?.byline || undefined;
      } finally {
        dom.window.close();
      }
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length < 20)
      throw new PipelineError(
        'EMPTY_CONTENT',
        'Texte insuffisant ; utilisez un import manuel pour les pages dynamiques ou protégées',
        false,
      );
    return {
      ...base(input, 'web'),
      title: (title || 'Page web').slice(0, 300),
      author: author?.slice(0, 300) || null,
      text: text.slice(0, 100000),
      metadata: { resolvedUrl: r.url, canonicalUrl: canonicalUrl(input.url!) },
    };
  }
}
export function youtubeId(input: string): string | null {
  const u = validatePublicUrl(input);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  if (host === 'youtube.com' || host === 'm.youtube.com')
    id =
      u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] || null;
  return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
}
export class YouTubeAdapter implements SourceAdapter {
  readonly type = 'youtube' as const;
  constructor(
    private readonly fetcher: ContentFetcher,
    private readonly config: AppConfig,
  ) {}
  canHandle(input: IngestInput) {
    return !!input.url && /(^|\.)youtube\.com$|^youtu\.be$/.test(new URL(input.url).hostname);
  }
  async fetch(input: IngestInput): Promise<RawContent> {
    const id = youtubeId(input.url!);
    if (!id) throw new PipelineError('INVALID_VIDEO', 'Identifiant YouTube invalide', false);
    let title = input.title || 'Vidéo YouTube';
    let author = input.author || '';
    let publishedAt = input.publishedAt || '';
    if (this.config.YOUTUBE_API_KEY) {
      const u = new URL('https://www.googleapis.com/youtube/v3/videos');
      u.search = new URLSearchParams({
        part: 'snippet',
        id,
        key: this.config.YOUTUBE_API_KEY,
      }).toString();
      const r = await this.fetcher.fetch(u.toString());
      const meta = z
        .object({
          items: z.array(
            z.object({
              snippet: z.object({
                title: z.string(),
                channelTitle: z.string(),
                publishedAt: z.string(),
              }),
            }),
          ),
        })
        .parse(JSON.parse(r.text)).items[0]?.snippet;
      if (!meta) throw new PipelineError('VIDEO_UNAVAILABLE', 'Vidéo inaccessible', false);
      title = input.title || meta.title;
      author = input.author || meta.channelTitle;
      publishedAt = input.publishedAt || meta.publishedAt;
    }
    let transcript = input.transcript;
    if (!transcript && this.config.YOUTUBE_ACCESS_TOKEN) {
      const headers = { authorization: 'Bearer ' + this.config.YOUTUBE_ACCESS_TOKEN };
      const r = await this.fetcher.fetch(
        'https://www.googleapis.com/youtube/v3/captions?part=id&videoId=' + id,
        headers,
      );
      const track = z
        .object({ items: z.array(z.object({ id: z.string() })) })
        .parse(JSON.parse(r.text)).items[0];
      if (track)
        transcript = (
          await this.fetcher.fetch(
            'https://www.googleapis.com/youtube/v3/captions/' +
              encodeURIComponent(track.id) +
              '?tfmt=vtt',
            headers,
          )
        ).text;
    }
    if (!transcript)
      throw new PipelineError(
        'TRANSCRIPT_REQUIRED',
        'Ajoutez une transcription autorisée ou configurez OAuth YouTube avec accès aux sous-titres. Aucun scraping de transcription.',
        false,
      );
    return { payload: { id, title, author, publishedAt, transcript } };
  }
  async normalize(raw: RawContent, input: IngestInput) {
    const p = z
      .object({
        id: z.string(),
        title: z.string(),
        author: z.string(),
        publishedAt: z.string(),
        transcript: z.string().min(20).max(100000),
      })
      .parse(raw.payload);
    return {
      ...base(input, 'youtube'),
      title: p.title.slice(0, 300),
      author: p.author || null,
      publishedAt: p.publishedAt || null,
      externalId: p.id,
      text: p.transcript,
      metadata: {
        transcriptFormat: p.transcript.startsWith('WEBVTT') ? 'vtt' : 'text',
        timestampsPreserved: true,
      },
    };
  }
}
export class RestrictedPlatformAdapter implements SourceAdapter {
  constructor(readonly type: 'reddit' | 'x') {}
  canHandle(input: IngestInput) {
    if (!input.url) return false;
    const host = new URL(input.url).hostname.replace(/^www\./, '');
    return this.type === 'reddit'
      ? /(^|\.)reddit\.com$|^redd\.it$/.test(host)
      : ['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host);
  }
  async fetch(): Promise<RawContent> {
    throw new PipelineError(
      'CREDENTIALS_REQUIRED',
      'API officielle non connectée. Importez le texte manuellement en conservant son URL et sa plateforme.',
      false,
    );
  }
  async normalize(): Promise<NormalizedContent> {
    throw new PipelineError(
      'CREDENTIALS_REQUIRED',
      'Normalisation par API officielle à implémenter',
      false,
    );
  }
}
export class AdapterRegistry {
  constructor(private readonly adapters: SourceAdapter[]) {}
  resolve(input: IngestInput): SourceAdapter {
    if (input.url) validatePublicUrl(input.url);
    const adapter = this.adapters.find((a) => a.canHandle(input));
    if (!adapter) throw new PipelineError('UNSUPPORTED_SOURCE', 'Source non supportée', false);
    return adapter;
  }
}
