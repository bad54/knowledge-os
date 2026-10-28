import type { SourceAdapter, RawContent, NormalizedContent } from '@knowledge/domain';
import type { IngestInput } from '@knowledge/shared';
import { PipelineError } from '@knowledge/domain';
import { Database } from '../infrastructure/database';
// This adapter consumes already captured posts; it never makes an unbudgeted X request.
export class XCorpusAdapter implements SourceAdapter {
  readonly type = 'x' as const;
  constructor(private readonly db: Database) {}
  canHandle(input: IngestInput) {
    if (!input.url) return false;
    return ['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com', 'mobile.twitter.com'].includes(
      new URL(input.url).hostname,
    );
  }
  async fetch(input: IngestInput): Promise<RawContent> {
    const id = input.url?.match(/\/status\/(\d{1,25})(?:[/?#]|$)/)?.[1];
    const post = id ? await this.db.xPost.findUnique({ where: { id } }) : null;
    if (!post)
      throw new PipelineError(
        'X_POST_NOT_CAPTURED',
        'Publication absente du corpus X. Importez-la ou collectez-la avec une recherche officielle.',
        false,
      );
    return {
      payload: {
        id: post.id,
        text: post.text,
        quotedText: post.quotedText,
        quoteUrl: post.quoteUrl,
        url: post.url,
        author: post.authorName || post.authorHandle || post.authorId,
        publishedAt: post.publishedAt?.toISOString() || null,
        capturedAt: post.capturedAt.toISOString(),
        language: post.language,
        origin: post.origin,
        coverage: post.coverage,
      },
    };
  }
  async normalize(raw: RawContent): Promise<NormalizedContent> {
    const p = raw.payload as {
      id: string;
      text: string;
      quotedText: string;
      quoteUrl: string | null;
      url: string;
      author: string | null;
      publishedAt: string | null;
      capturedAt: string;
      language: string;
      origin: string;
      coverage: string;
    };
    return {
      sourceType: 'x',
      externalId: p.id,
      originalUrl: p.url,
      title: p.text.slice(0, 140) || p.quotedText.slice(0, 140),
      author: p.author,
      publishedAt: p.publishedAt,
      capturedAt: p.capturedAt,
      language: p.language,
      text: [p.text, p.quotedText ? 'Publication citée :\n' + p.quotedText : '']
        .filter(Boolean)
        .join('\n\n'),
      metadata: { origin: p.origin, coverage: p.coverage, quoteUrl: p.quoteUrl },
    };
  }
}
