import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { analysisSchema } from '@knowledge/shared';
import {
  AIProvider,
  AnalysisResult,
  EMBEDDING_DIMENSIONS,
  NormalizedContent,
  PipelineError,
} from '@knowledge/domain';
import { AppConfig } from '../config';
import { KNOWLEDGE_ANALYSIS_PROMPT, PROMPT_VERSION } from '../prompts/knowledge-analysis.v1';

export function validateEmbedding(vector: number[]): number[] {
  if (
    vector.length !== EMBEDDING_DIMENSIONS ||
    vector.some((x) => !Number.isFinite(x)) ||
    vector.every((x) => x === 0)
  )
    throw new PipelineError('INVALID_EMBEDDING', 'Embedding invalide');
  return vector;
}
export class LocalProvider implements AIProvider {
  readonly name = 'local';
  readonly embeddingModel = 'lexical-hash-1536.v1';
  async analyzeContent(content: NormalizedContent): Promise<AnalysisResult> {
    const sentences = content.text
      .match(/[^.!?\n]+[.!?]?/g)
      ?.map((s) => s.trim())
      .filter(Boolean) || [content.text];
    return {
      analysis: analysisSchema.parse({
        title: content.title,
        language: content.language === 'und' ? 'fr' : content.language,
        summary: content.text.slice(0, 2000),
        keyIdeas: sentences.slice(0, 5).map((s) => s.slice(0, 2000)),
        insights: [],
        actionableIdeas: [],
        topics: ['À classer'],
        concepts: [],
        entities: [],
        questions: [],
        claimsToVerify: [],
        relevanceScore: 5,
        qualityScore: 5,
        originalityScore: 5,
        actionabilityScore: 5,
        credibilityScore: 5,
        longTermValueScore: 5,
      }),
      model: 'local-extractive.v1',
      promptVersion: 'local-extractive.v1',
      usage: {},
    };
  }
  async createEmbedding(text: string) {
    const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    for (const word of text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .match(/[\p{L}\p{N}]{2,}/gu) || ['empty']) {
      const digest = createHash('sha256').update(word).digest();
      vector[digest.readUInt32LE(0) % EMBEDDING_DIMENSIONS] += digest[4] % 2 ? 1 : -1;
    }
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    if (!norm) vector[0] = 1;
    return validateEmbedding(vector.map((v) => v / (norm || 1)));
  }
}
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  readonly embeddingModel: string;
  private readonly client: OpenAI;
  constructor(private readonly config: AppConfig) {
    this.embeddingModel = config.OPENAI_EMBEDDING_MODEL;
    this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: 90000, maxRetries: 1 });
  }
  async analyzeContent(content: NormalizedContent): Promise<AnalysisResult> {
    const response = await this.client.responses.parse({
      model: this.config.OPENAI_ANALYSIS_MODEL,
      store: false,
      input: [
        { role: 'system', content: KNOWLEDGE_ANALYSIS_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            title: content.title,
            sourceType: content.sourceType,
            author: content.author,
            text: content.text.slice(0, 60000),
          }),
        },
      ],
      text: { format: zodTextFormat(analysisSchema, 'knowledge_analysis') },
      max_output_tokens: 6000,
    });
    if (!response.output_parsed)
      throw new PipelineError('ANALYSIS_INVALID', 'Analyse absente, refusée ou incomplète');
    return {
      analysis: analysisSchema.parse(response.output_parsed),
      model: response.model,
      promptVersion: PROMPT_VERSION,
      usage: {
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
      },
    };
  }
  async createEmbedding(text: string) {
    const response = await this.client.embeddings.create({
      model: this.embeddingModel,
      input: text.slice(0, 6000),
      dimensions: EMBEDDING_DIMENSIONS,
    });
    return validateEmbedding(response.data[0]?.embedding || []);
  }
}
