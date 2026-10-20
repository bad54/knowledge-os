import { z } from 'zod';
export { ZodError } from 'zod';
export type { CardView, CardDetail, JobView, DashboardView, Label } from './views';

export const sourceTypes = ['manual', 'web', 'youtube', 'reddit', 'x'] as const;
export const statuses = [
  'CREATED',
  'FETCHING',
  'EXTRACTING',
  'ANALYZING',
  'EMBEDDING',
  'COMPLETED',
  'FAILED',
] as const;
export const sourceSchema = z.enum(sourceTypes);
const date = z.string().datetime({ offset: true });
const url = z.string().url().max(2048);
export const ingestSchema = z
  .object({
    url: url.optional(),
    text: z.string().trim().min(20).max(100000).optional(),
    title: z.string().trim().min(1).max(300).optional(),
    author: z.string().max(300).optional(),
    publishedAt: date.optional(),
    sourceType: sourceSchema.optional(),
    transcript: z.string().min(20).max(100000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.url && !v.text)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL ou texte requis' });
  });
export type IngestInput = z.infer<typeof ingestSchema>;
const items = z.array(z.string().min(1).max(2000)).max(30);
const labels = z.array(z.string().trim().min(1).max(100)).max(20);
const score = z.number().min(0).max(10);
export const analysisSchema = z
  .object({
    title: z.string().min(1).max(300),
    language: z.string().min(2).max(40),
    summary: z.string().min(1).max(8000),
    keyIdeas: items,
    insights: items,
    actionableIdeas: items,
    topics: labels,
    concepts: labels,
    entities: labels,
    questions: items,
    claimsToVerify: items,
    relevanceScore: score,
    qualityScore: score,
    originalityScore: score,
    actionabilityScore: score,
    credibilityScore: score,
    longTermValueScore: score,
  })
  .strict();
export type Analysis = z.infer<typeof analysisSchema>;
export function globalScore(a: Analysis): number {
  return (
    Math.round(
      ((a.relevanceScore +
        a.qualityScore +
        a.originalityScore +
        a.actionabilityScore +
        a.credibilityScore +
        a.longTermValueScore) /
        6) *
        100,
    ) / 100
  );
}
const numberFilter = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : Number(v)),
  z.number().min(0).max(10).optional(),
);
export const filterSchema = z
  .object({
    source: sourceSchema.optional(),
    topic: z.string().max(100).optional(),
    from: date.optional(),
    to: date.optional(),
    minScore: numberFilter,
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Dates inversées');
export const searchSchema = z
  .object({
    q: z.string().trim().min(2).max(1000),
    mode: z.enum(['hybrid', 'semantic', 'text']).default('hybrid'),
    source: sourceSchema.optional(),
    topic: z.string().max(100).optional(),
    from: date.optional(),
    to: date.optional(),
    minScore: numberFilter,
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Dates inversées');
export type Filters = z.infer<typeof filterSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
