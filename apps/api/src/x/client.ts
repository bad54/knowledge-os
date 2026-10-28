import { z } from '@knowledge/shared';
import { ContentFetcher, PipelineError } from '@knowledge/domain';
import { xIdSchema, xImportPostSchema } from '@knowledge/shared';
import { validatePublicUrl } from '../ingestion/safe-fetcher';

const metricSchema = z.object({
  like_count: z.number().int().nonnegative(),
  retweet_count: z.number().int().nonnegative(),
  reply_count: z.number().int().nonnegative(),
  quote_count: z.number().int().nonnegative(),
});
export interface CapturedXPost {
  id: string;
  text: string;
  quotedText: string;
  quoteUrl: string | null;
  url: string;
  authorId: string | null;
  authorHandle: string | null;
  authorName: string | null;
  conversationId: string | null;
  language: string;
  publishedAt: string | null;
  links: string[];
  topics: string[];
  origin: 'x_api' | 'v12_import';
  coverage: string;
  metrics: z.infer<typeof metricSchema> | null;
  payload: Record<string, unknown>;
}
export interface XSearchRequest {
  query: string;
  mode: 'recent' | 'archive';
  maxPosts: number;
  nextToken?: string | null;
  sinceId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}
export interface XPage {
  posts: CapturedXPost[];
  nextToken: string | null;
  newestId: string | null;
}
export interface XDiscoveryClient {
  search(request: XSearchRequest): Promise<XPage>;
}
function safeLinks(values: string[]) {
  return [
    ...new Set(
      values.filter((value) => {
        try {
          validatePublicUrl(value);
          return true;
        } catch {
          return false;
        }
      }),
    ),
  ].slice(0, 30);
}
export function xPermalink(id: string, original?: string) {
  xIdSchema.parse(id);
  if (original) {
    try {
      const url = validatePublicUrl(original);
      if (
        ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) &&
        new RegExp('/status/' + id + '/?$').test(url.pathname)
      )
        return 'https://x.com' + url.pathname.replace(/\/$/, '');
    } catch {
      /* Use the stable ID permalink below. */
    }
  }
  return 'https://x.com/i/status/' + id;
}
export function normalizeV12Post(raw: unknown): CapturedXPost {
  const p = xImportPostSchema.parse(raw);
  const date = p.datetime ? new Date(p.datetime) : null;
  const links =
    typeof p.external_links === 'string'
      ? p.external_links.split('|').map((v) => v.trim())
      : p.external_links || [];
  let quoteUrl: string | null = null;
  if (p.quoted_url) {
    try {
      quoteUrl = validatePublicUrl(p.quoted_url).toString();
    } catch {
      /* Missing/unsafe quote URL remains unknown. */
    }
  }
  return {
    id: p.post_id,
    text: p.text.trim(),
    quotedText: p.quoted_text.trim(),
    quoteUrl,
    url: xPermalink(p.post_id, p.url),
    authorId: null,
    authorHandle: p.author_handle || null,
    authorName: p.author_name || null,
    conversationId: null,
    language: 'und',
    publishedAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
    links: safeLinks(links),
    topics: [
      ...new Set([p.manual_category, ...(p.manual_tags || [])].filter((v): v is string => !!v)),
    ],
    origin: 'v12_import',
    coverage: p.quoted_text ? 'post_and_quote' : 'post_only',
    metrics: null,
    payload: { ...p, importVersion: 'v12.v1' },
  };
}
const tweetSchema = z.object({
  id: xIdSchema,
  text: z.string().max(50000),
  author_id: xIdSchema.optional(),
  conversation_id: xIdSchema.optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
  lang: z.string().max(40).optional(),
  note_tweet: z.object({ text: z.string().max(50000) }).optional(),
  entities: z
    .object({
      urls: z
        .array(z.object({ expanded_url: z.string().max(2048).optional() }))
        .max(100)
        .optional(),
    })
    .optional(),
  referenced_tweets: z
    .array(z.object({ type: z.string().max(30), id: xIdSchema }))
    .max(20)
    .optional(),
  public_metrics: metricSchema.optional(),
});
const responseSchema = z.object({
  data: z.array(tweetSchema).max(100).optional(),
  meta: z
    .object({ next_token: z.string().max(2048).optional(), newest_id: xIdSchema.optional() })
    .optional(),
  errors: z.array(z.unknown()).optional(),
});
export class OfficialXClient implements XDiscoveryClient {
  constructor(
    private readonly fetcher: ContentFetcher,
    private readonly token: string,
  ) {}
  async search(request: XSearchRequest): Promise<XPage> {
    if (!this.token)
      throw new PipelineError(
        'X_CREDENTIALS_REQUIRED',
        'Configurez X_BEARER_TOKEN côté serveur pour connecter l’API officielle X.',
        false,
      );
    const url = new URL(
      'https://api.x.com/2/tweets/search/' + (request.mode === 'archive' ? 'all' : 'recent'),
    );
    url.searchParams.set('query', request.query);
    url.searchParams.set('max_results', String(request.maxPosts));
    url.searchParams.set('sort_order', 'recency');
    url.searchParams.set(
      'tweet.fields',
      'created_at,author_id,conversation_id,public_metrics,entities,referenced_tweets,lang,note_tweet',
    );
    if (request.nextToken) url.searchParams.set('next_token', request.nextToken);
    if (request.startTime) url.searchParams.set('start_time', request.startTime);
    else if (request.sinceId) url.searchParams.set('since_id', request.sinceId);
    if (request.endTime) url.searchParams.set('end_time', request.endTime);
    let payload: unknown;
    try {
      const result = await this.fetcher.fetch(url.toString(), {
        authorization: 'Bearer ' + this.token,
        accept: 'application/json',
      });
      payload = JSON.parse(result.text);
    } catch (error) {
      if (error instanceof PipelineError && error.code === 'HTTP_402')
        throw new PipelineError(
          'HTTP_402',
          'X demande un accès payant ou des crédits disponibles (HTTP 402). Vérifiez la facturation et les crédits de votre compte développeur X.',
          false,
        );
      if (
        error instanceof PipelineError &&
        ['HTTP_401', 'HTTP_403', 'HTTP_429', 'HTTP_400'].includes(error.code)
      )
        throw new PipelineError(
          error.code,
          `X a refusé la requête (${error.code.replace('_', ' ')}) : vérifiez le jeton, les droits de recherche, la requête et les limites du compte.`,
          error.code === 'HTTP_429',
        );
      if (error instanceof PipelineError && /^HTTP_\d{3}$/.test(error.code))
        throw new PipelineError(
          error.code,
          `La recherche X a répondu ${error.code.replace('_', ' ')}. Réessayez après vérification du service X.`,
          error.retryable,
        );
      const fetchErrors = [
        'FETCH_TIMEOUT',
        'DNS_TIMEOUT',
        'UNSAFE_URL',
        'TOO_LARGE',
        'REDIRECT_LIMIT',
      ];
      if (error instanceof PipelineError && fetchErrors.includes(error.code))
        throw new PipelineError(
          error.code,
          `Connexion à X impossible (${error.code}). Vérifiez la disponibilité réseau du serveur.`,
          error.retryable,
        );
      const networkCodes = [
        'ENOTFOUND',
        'EAI_AGAIN',
        'ECONNRESET',
        'ECONNREFUSED',
        'ENETUNREACH',
        'ETIMEDOUT',
      ];
      const networkCode = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (typeof networkCode === 'string' && networkCodes.includes(networkCode))
        throw new PipelineError(
          'X_NETWORK_ERROR',
          `Connexion réseau à X impossible (${networkCode}). Vérifiez la connectivité du serveur.`,
          true,
        );
      throw new PipelineError(
        'X_UNAVAILABLE',
        'La recherche X est indisponible. Aucun résultat n’a été inventé.',
      );
    }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.errors?.length)
      throw new PipelineError(
        'X_INVALID_RESPONSE',
        'Réponse X incomplète ou invalide. La collecte reste relançable.',
      );
    return {
      posts: (parsed.data.data || [])
        .filter((p) => (p.note_tweet?.text || p.text).trim())
        .map((p) => ({
          id: p.id,
          text: p.note_tweet?.text || p.text,
          quotedText: '',
          quoteUrl: null,
          url: xPermalink(p.id),
          authorId: p.author_id || null,
          authorHandle: null,
          authorName: null,
          conversationId: p.conversation_id || null,
          language: p.lang || 'und',
          publishedAt: p.created_at || null,
          links: safeLinks(p.entities?.urls?.map((u) => u.expanded_url || '') || []),
          topics: [],
          origin: 'x_api' as const,
          coverage: 'post_only',
          metrics: p.public_metrics || null,
          payload: p,
        })),
      nextToken: parsed.data.meta?.next_token || null,
      newestId: parsed.data.meta?.newest_id || null,
    };
  }
}
