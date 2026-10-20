import type { Analysis } from './index';
export interface Label {
  id: string;
  name: string;
}
export interface Provenance {
  sourceId: string;
  originalUrl: string | null;
  author: string | null;
  publishedAt: string | null;
  capturedAt: string;
}
export interface CardView {
  id: string;
  title: string;
  summary: string;
  language: string;
  globalScore: number;
  processingVersion: string;
  modelUsed: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
  content: Provenance;
  topics: Label[];
  concepts: Label[];
  similarity?: number;
  textRank?: number;
  rank?: number;
}
export interface CardDetail extends CardView {
  processingStatus: string;
  activeRevisionId: string;
  analysis: Analysis;
  content: Provenance & {
    text: string;
    metadata: Record<string, unknown>;
    references: { id: string; originalUrl: string | null; capturedAt: string }[];
  };
  revisions: {
    id: string;
    createdAt: string;
    provider: string;
    model: string;
    promptVersion: string;
    processingVersion: string;
    globalScore: number;
    analysis: Analysis;
  }[];
}
export interface JobView {
  id: string;
  status: string;
  contentId: string | null;
  cardId: string | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface DashboardView {
  total: number;
  newResources: number;
  processing: number;
  failed: number;
  bySource: { sourceId: string; _count: number }[];
  best: CardView[];
  latest: CardView[];
  provider: string;
  embeddingModel: string;
}
