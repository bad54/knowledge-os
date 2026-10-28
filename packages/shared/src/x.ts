import { z } from 'zod';
export const xIdSchema = z.string().regex(/^\d{1,25}$/);
export const xRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    query: z.string().trim().min(2).max(512),
    topic: z.string().trim().min(1).max(100),
    mode: z.enum(['recent', 'archive']).default('recent'),
    startTime: z.string().datetime({ offset: true }).optional(),
    endTime: z.string().datetime({ offset: true }).optional(),
    enabled: z.boolean().default(false),
    intervalMinutes: z.number().int().min(30).max(10080).default(120),
    maxPosts: z.number().int().min(10).max(100).default(20),
    autoCards: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.mode === 'archive' && (!v.startTime || !v.endTime || v.startTime >= v.endTime))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Les archives nécessitent une période de début et de fin valide',
      });
    if (v.mode === 'recent' && (v.startTime || v.endTime))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La recherche récente utilise son curseur, sans période fixe',
      });
  });
export type XRuleInput = z.infer<typeof xRuleSchema>;
export const xImportPostSchema = z
  .object({
    post_id: xIdSchema,
    text: z.string().max(50000).default(''),
    quoted_text: z.string().max(50000).default(''),
    quoted_url: z.string().max(2048).optional(),
    author_name: z.string().max(300).optional(),
    author_handle: z.string().max(100).optional(),
    datetime: z.string().max(100).optional(),
    captured_at: z.string().max(100).optional(),
    url: z.string().max(2048).optional(),
    external_links: z
      .union([z.string().max(16000), z.array(z.string().max(2048)).max(30)])
      .optional(),
    manual_category: z.string().max(100).optional(),
    manual_tags: z.array(z.string().max(100)).max(20).optional(),
  })
  .refine((v) => !!(v.text.trim() || v.quoted_text.trim()), 'Publication sans texte exploitable');
export const xBrowseSchema = z
  .object({
    q: z.string().trim().max(1000).default(''),
    topic: z.string().max(100).optional(),
    sort: z.enum(['recent', 'oldest', 'engagement', 'momentum', 'useful']).default('recent'),
    cursor: z.string().max(1024).optional(),
  })
  .strict();
export type XBrowseInput = z.infer<typeof xBrowseSchema>;
export const answerModeSchema = z.enum(['answer', 'plan', 'decision']);
export const xAskSchema = z
  .object({
    question: z.string().trim().min(5).max(1000),
    mode: answerModeSchema.default('answer'),
  })
  .strict();
export const evidenceAnswerSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            heading: z.string().min(1).max(200),
            kind: z.enum(['evidence', 'recommendation']),
            text: z.string().min(1).max(6000),
            citations: z.array(z.number().int().min(1)).max(20),
          })
          .strict(),
      )
      .max(12),
    warnings: z.array(z.string().max(1000)).max(12),
  })
  .strict();
export type EvidenceAnswer = z.infer<typeof evidenceAnswerSchema>;
export interface XPostView {
  id: string;
  text: string;
  quotedText: string;
  url: string;
  author: string;
  publishedAt: string | null;
  capturedAt: string;
  origin: string;
  language: string;
  topics: string[];
  links: string[];
  coverage: string;
  utilitySignal: number;
  engagement: number | null;
  momentum: number | null;
  novelty: number | null;
  indexStatus: string;
  job: { id: string; status: string; cardId: string | null } | null;
}
export interface XRuleView extends Omit<XRuleInput, 'startTime' | 'endTime'> {
  id: string;
  startTime: string | null;
  endTime: string | null;
  nextRunAt: string | null;
  hasNextPage: boolean;
  archiveComplete: boolean;
}
export interface XOverview {
  connection: { xReady: boolean; aiReady: boolean; provider: string; embeddingModel: string };
  limits: {
    readsPerDay: number;
    readsReservedToday: number;
    autoCardsPerDay: number;
    cardsReservedToday: number;
    embeddingsPerDay: number;
  };
  counts: { posts: number; indexed: number; failedIndex: number };
  topics: string[];
  rules: XRuleView[];
  runs: {
    id: string;
    ruleId: string;
    status: string;
    fetched: number;
    added: number;
    errorMessage: string | null;
    createdAt: string;
  }[];
  answers: { id: string; question: string; mode: string; createdAt: string }[];
}
export interface XAnswerView extends EvidenceAnswer {
  id: string;
  question: string;
  mode: string;
  provider: string;
  model: string;
  promptVersion: string;
  sources: {
    label: number;
    postId: string;
    url: string;
    text: string;
    origin: string;
    coverage: string;
    capturedAt: string;
    publishedAt: string | null;
  }[];
  createdAt: string;
}
