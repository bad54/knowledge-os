import { z } from 'zod';

const terms = z.array(z.string().trim().min(2).max(100)).max(20);
export const watchSettingsSchema = z
  .object({
    topics: terms,
    includeKeywords: terms,
    excludeKeywords: terms,
    languages: z.array(z.string().regex(/^[a-z]{2}$/)).max(10),
    dailyLimit: z.number().int().min(1).max(20),
    scheduleEnabled: z.boolean(),
  })
  .strict();
export type WatchSettingsInput = z.infer<typeof watchSettingsSchema>;
export const watchSourceSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    url: z.string().url().max(2048),
  })
  .strict();
export const watchSourceUpdateSchema = z.object({ enabled: z.boolean() }).strict();
export const watchDecisionSchema = z
  .object({
    decision: z.enum(['KEEP', 'KNOWN', 'OFF_TOPIC', 'SKIP']),
  })
  .strict();
export interface WatchSourceView {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastSuccessAt: string | null;
  errorMessage: string | null;
}
export interface WatchCandidateView {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  author: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  language: string;
  selectionScore: number;
  reasons: string[];
  rankingVersion: string;
  status: 'PENDING' | 'ACCEPTED' | 'DISMISSED';
  decision: string | null;
  source: WatchSourceView;
  job: { id: string; status: string; cardId: string | null } | null;
}
export interface WatchRunView {
  id: string;
  status: 'CREATED' | 'FETCHING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  trigger: string;
  scanned: number;
  added: number;
  filtered: number;
  issues: { sourceId: string; message: string }[];
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}
export interface WatchOverview {
  settings: WatchSettingsInput & { nextRunAt: string | null };
  sources: WatchSourceView[];
  runs: WatchRunView[];
  candidates: WatchCandidateView[];
  recentDecisions: WatchCandidateView[];
  selectedToday: number;
  rankingMode: 'keywords';
}
