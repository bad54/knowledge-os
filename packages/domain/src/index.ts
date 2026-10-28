import type { Analysis, IngestInput } from '@knowledge/shared';
import type { EvidenceAnswer } from '@knowledge/shared';
export type SourceType = 'manual' | 'web' | 'youtube' | 'reddit' | 'x';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface NormalizedContent {
  sourceType: SourceType;
  originalUrl: string | null;
  externalId: string | null;
  title: string;
  author: string | null;
  publishedAt: string | null;
  capturedAt: string;
  text: string;
  language: string;
  metadata: Record<string, Json>;
}
export interface RawContent {
  payload: Json;
}
export interface SourceAdapter {
  readonly type: SourceType;
  canHandle(input: IngestInput): boolean;
  fetch(input: IngestInput): Promise<RawContent>;
  normalize(raw: RawContent, input: IngestInput): Promise<NormalizedContent>;
}
export interface AnalysisResult {
  analysis: Analysis;
  model: string;
  promptVersion: string;
  usage: Record<string, Json>;
}
export interface AIProvider {
  readonly name: string;
  readonly embeddingModel: string;
  analyzeContent(content: NormalizedContent): Promise<AnalysisResult>;
  createEmbedding(text: string): Promise<number[]>;
}
export interface EvidenceDocument {
  postId: string;
  text: string;
  origin: string;
  coverage: string;
}
export interface KnowledgeReasoner {
  readonly name: string;
  decompose(question: string): Promise<string[]>;
  rerank(
    question: string,
    documents: EvidenceDocument[],
  ): Promise<{ postId: string; relevance: number; reason: string }[]>;
  answer(
    question: string,
    mode: 'answer' | 'plan' | 'decision',
    documents: EvidenceDocument[],
  ): Promise<{ answer: EvidenceAnswer; model: string; promptVersion: string }>;
}
export interface ContentFetcher {
  fetch(
    url: string,
    headers?: Record<string, string>,
  ): Promise<{ text: string; url: string; contentType: string }>;
}
export class PipelineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}
export const PIPELINE_VERSION = '1.0.0';
export const EMBEDDING_DIMENSIONS = 1536;
export type KnowledgeRelationType =
  'supports' | 'contradicts' | 'extends' | 'related_to' | 'example_of' | 'prerequisite_of';
