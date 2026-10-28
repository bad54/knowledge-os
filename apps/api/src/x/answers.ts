import { createHash } from 'node:crypto';
import { NotFoundException, HttpException } from '@nestjs/common';
import { EvidenceDocument, KnowledgeReasoner, PipelineError } from '@knowledge/domain';
import { evidenceAnswerSchema, XAnswerView, XPostView } from '@knowledge/shared';
import { XAnswer } from '@prisma/client';
import { Database } from '../infrastructure/database';
import { json } from '../processing/jobs.repository';
import { XSearch } from './search';

export function validateCitations(value: unknown, count: number) {
  const answer = evidenceAnswerSchema.parse(value);
  if (
    answer.sections.some(
      (s) => (s.kind === 'evidence' && !s.citations.length) || s.citations.some((c) => c > count),
    )
  )
    throw new PipelineError(
      'ANSWER_INVALID',
      'La réponse contient une référence absente ou une affirmation sans source.',
    );
  return answer;
}
function view(row: XAnswer): XAnswerView {
  return {
    id: row.id,
    question: row.question,
    mode: row.mode,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    ...evidenceAnswerSchema.parse(row.response),
    sources: row.sources as unknown as XAnswerView['sources'],
    createdAt: row.createdAt.toISOString(),
  };
}
export class XAnswers {
  private readonly pending = new Map<string, Promise<XAnswerView>>();
  constructor(
    private readonly db: Database,
    private readonly search: XSearch,
    private readonly reasoner: KnowledgeReasoner,
    private readonly model: string,
  ) {}
  async detail(id: string) {
    const row = await this.db.xAnswer.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Réponse introuvable');
    return view(row);
  }
  async ask(question: string, mode: 'answer' | 'plan' | 'decision') {
    if (this.reasoner.name === 'local' && mode !== 'answer')
      throw new PipelineError(
        'AI_REQUIRED',
        'Connectez OpenAI pour générer un plan ou une décision.',
        false,
      );
    const latest = await this.db.xPost.findFirst({
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, capturedAt: true },
    });
    const corpusSize = await this.db.xPost.count();
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          question.trim(),
          mode,
          this.reasoner.name,
          this.model,
          latest,
          corpusSize,
          Math.floor(Date.now() / 3600000),
        ]),
      )
      .digest('hex');
    const cached = await this.db.xAnswer.findUnique({ where: { cacheKey: key } });
    if (cached && cached.model !== 'no-evidence') return view(cached);
    const active = this.pending.get(key);
    if (active) return active;
    if (this.pending.size >= 2)
      throw new HttpException(
        'Deux questions sont déjà en cours. Réessayez après leur traitement.',
        429,
      );
    const work = this.generate(question, mode, key, !!latest).finally(() =>
      this.pending.delete(key),
    );
    this.pending.set(key, work);
    return work;
  }
  private async generate(
    question: string,
    mode: 'answer' | 'plan' | 'decision',
    key: string,
    hasPosts: boolean,
  ) {
    const queries = hasPosts
      ? [...new Set(await this.reasoner.decompose(question))].slice(0, 3)
      : [];
    const candidates = new Map<string, XPostView>();
    for (const query of queries)
      for (const post of await this.search.retrieve(query, 12)) candidates.set(post.id, post);
    const documents = (posts: XPostView[]): EvidenceDocument[] =>
      posts.map((p) => ({
        postId: p.id,
        text: [p.text, p.quotedText ? 'Publication citée : ' + p.quotedText : '']
          .filter(Boolean)
          .join('\n')
          .slice(0, 6000),
        origin: p.origin,
        coverage: p.coverage,
      }));
    let selected = [...candidates.values()].slice(0, 30);
    if (selected.length && this.reasoner.name !== 'local') {
      const ranks = await this.reasoner.rerank(question, documents(selected));
      selected = ranks
        .filter((r) => r.relevance >= 40)
        .sort((a, b) => b.relevance - a.relevance)
        .flatMap((r) => (candidates.has(r.postId) ? [candidates.get(r.postId)!] : []));
    }
    const authors = new Map<string, number>();
    selected = selected
      .filter((p) => {
        const count = authors.get(p.author) || 0;
        authors.set(p.author, count + 1);
        return count < 2;
      })
      .slice(0, 8);
    const result = selected.length
      ? await this.reasoner.answer(question, mode, documents(selected))
      : {
          model: 'no-evidence',
          promptVersion: 'x-empty.v1',
          answer: {
            sections: [],
            warnings: [
              'Aucune source pertinente retrouvée. Importez des publications ou précisez votre question. Aucun appel de génération effectué.',
            ],
          },
        };
    const answer = validateCitations(result.answer, selected.length);
    const sources: XAnswerView['sources'] = selected.map((p, i) => ({
      label: i + 1,
      postId: p.id,
      url: p.url,
      text: documents([p])[0]!.text,
      origin: p.origin,
      coverage: p.coverage,
      capturedAt: p.capturedAt,
      publishedAt: p.publishedAt,
    }));
    const row = await this.db.xAnswer.upsert({
      where: { cacheKey: key },
      update: {
        response: json(answer),
        sources: json(sources),
        model: result.model,
        promptVersion: result.promptVersion,
      },
      create: {
        cacheKey: key,
        question,
        mode,
        provider: this.reasoner.name,
        model: result.model,
        promptVersion: result.promptVersion,
        response: json(answer),
        sources: json(sources),
      },
    });
    return view(row);
  }
}
