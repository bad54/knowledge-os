import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { EvidenceDocument, KnowledgeReasoner, PipelineError } from '@knowledge/domain';
import { evidenceAnswerSchema } from '@knowledge/shared';
import { AppConfig } from '../config';
import {
  X_ANSWER_PROMPT,
  X_DECOMPOSE_PROMPT,
  X_REASONING_VERSION,
  X_RERANK_PROMPT,
} from '../prompts/x-reasoning.v1';
const queriesSchema = z.object({ queries: z.array(z.string().min(2).max(500)).max(3) }).strict();
const ranksSchema = z
  .object({
    ranks: z
      .array(
        z
          .object({
            postId: z.string().min(1).max(100),
            relevance: z.number().min(0).max(100),
            reason: z.string().max(1000),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export class ExtractiveReasoner implements KnowledgeReasoner {
  readonly name = 'local';
  async decompose(question: string) {
    return [question];
  }
  async rerank(_question: string, documents: EvidenceDocument[]) {
    return documents.map((d) => ({
      postId: d.postId,
      relevance: 0,
      reason: 'Recherche lexicale, sans reclassement IA.',
    }));
  }
  async answer(
    _question: string,
    mode: 'answer' | 'plan' | 'decision',
    documents: EvidenceDocument[],
  ) {
    if (mode !== 'answer')
      throw new PipelineError(
        'AI_REQUIRED',
        'Connectez un fournisseur IA pour générer un plan ou une décision. Les extraits restent consultables.',
        false,
      );
    return {
      model: 'local-extractive.v1',
      promptVersion: 'x-extracts.v1',
      answer: evidenceAnswerSchema.parse({
        sections: documents.map((d, i) => ({
          heading: 'Extrait B' + (i + 1),
          kind: 'evidence',
          text: d.text.slice(0, 1200),
          citations: [i + 1],
        })),
        warnings: [
          'Extraits des sources retrouvées. Aucune synthèse, validation des faits ou recommandation IA n’a été exécutée.',
          ...(documents.length
            ? []
            : ['Aucune source suffisamment pertinente retrouvée dans le corpus.']),
        ],
      }),
    };
  }
}
export class OpenAIKnowledgeReasoner implements KnowledgeReasoner {
  readonly name = 'openai';
  private readonly client: OpenAI;
  constructor(private readonly config: AppConfig) {
    this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: 25000, maxRetries: 0 });
  }
  async decompose(question: string) {
    const r = await this.client.responses.parse({
      model: this.config.OPENAI_ANALYSIS_MODEL,
      store: false,
      input: [
        { role: 'system', content: X_DECOMPOSE_PROMPT },
        { role: 'user', content: question },
      ],
      text: { format: zodTextFormat(queriesSchema, 'queries') },
      max_output_tokens: 500,
    });
    return [question, ...(r.output_parsed?.queries || [])].slice(0, 3);
  }
  async rerank(question: string, documents: EvidenceDocument[]) {
    const r = await this.client.responses.parse({
      model: this.config.OPENAI_ANALYSIS_MODEL,
      store: false,
      input: [
        { role: 'system', content: X_RERANK_PROMPT },
        { role: 'user', content: JSON.stringify({ question, documents }) },
      ],
      text: { format: zodTextFormat(ranksSchema, 'ranks') },
      max_output_tokens: 2200,
    });
    if (!r.output_parsed)
      throw new PipelineError('RERANK_INVALID', 'Reclassement IA absent ou incomplet.');
    const ids = new Set(documents.map((d) => d.postId));
    if (
      r.output_parsed.ranks.some((rank) => !ids.has(rank.postId)) ||
      new Set(r.output_parsed.ranks.map((r) => r.postId)).size !== r.output_parsed.ranks.length
    )
      throw new PipelineError(
        'RERANK_INVALID',
        'Le reclassement référence des sources non fournies.',
      );
    return r.output_parsed.ranks;
  }
  async answer(
    question: string,
    mode: 'answer' | 'plan' | 'decision',
    documents: EvidenceDocument[],
  ) {
    const r = await this.client.responses.parse({
      model: this.config.OPENAI_ANALYSIS_MODEL,
      store: false,
      input: [
        { role: 'system', content: X_ANSWER_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            question,
            mode,
            documents: documents.map((d, i) => ({ label: i + 1, ...d })),
          }),
        },
      ],
      text: { format: zodTextFormat(evidenceAnswerSchema, 'knowledge_answer') },
      max_output_tokens: 4000,
    });
    if (!r.output_parsed)
      throw new PipelineError('ANSWER_INVALID', 'Réponse IA absente ou incomplète.');
    return {
      answer: evidenceAnswerSchema.parse(r.output_parsed),
      model: r.model,
      promptVersion: X_REASONING_VERSION,
    };
  }
}
