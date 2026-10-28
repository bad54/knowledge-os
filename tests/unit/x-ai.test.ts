import { beforeEach, describe, expect, it, vi } from 'vitest';
const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    responses = { parse };
  },
}));
import { OpenAIKnowledgeReasoner } from '../../apps/api/src/ai/knowledge-reasoner';
import { loadConfig } from '../../apps/api/src/config';
const documents = [
  { postId: '123', text: 'Guide n8n sourcé', origin: 'v12_import', coverage: 'post_only' },
];
beforeEach(() => parse.mockReset());
describe('OpenAI reasoning structured boundary', () => {
  it('uses Responses structured outputs with server credentials and response storage disabled', async () => {
    parse
      .mockResolvedValueOnce({ output_parsed: { queries: ['n8n reporting'] } })
      .mockResolvedValueOnce({
        output_parsed: { ranks: [{ postId: '123', relevance: 95, reason: 'Méthode pertinente' }] },
      })
      .mockResolvedValueOnce({
        model: 'test-model',
        output_parsed: {
          sections: [
            {
              heading: 'Méthode',
              kind: 'evidence',
              text: 'Le guide décrit une méthode.',
              citations: [1],
            },
          ],
          warnings: [],
        },
      });
    const provider = new OpenAIKnowledgeReasoner({ ...loadConfig(), OPENAI_API_KEY: 'test-only' });
    expect(await provider.decompose('Automatiser le reporting')).toEqual([
      'Automatiser le reporting',
      'n8n reporting',
    ]);
    expect((await provider.rerank('Question', documents))[0]?.postId).toBe('123');
    expect((await provider.answer('Question', 'plan', documents)).model).toBe('test-model');
    for (const [request] of parse.mock.calls) {
      expect(request.store).toBe(false);
      expect(request.text.format.type).toBe('json_schema');
      expect(JSON.stringify(request)).not.toContain('test-only');
    }
  });
  it('rejects invented IDs and refused or malformed answers before persistence', async () => {
    const provider = new OpenAIKnowledgeReasoner({ ...loadConfig(), OPENAI_API_KEY: 'test-only' });
    parse.mockResolvedValueOnce({
      output_parsed: { ranks: [{ postId: '999', relevance: 99, reason: 'Inventé' }] },
    });
    await expect(provider.rerank('Question', documents)).rejects.toThrow('sources non fournies');
    parse.mockResolvedValueOnce({ output_parsed: null });
    await expect(provider.answer('Question', 'answer', documents)).rejects.toThrow('absente');
    parse.mockResolvedValueOnce({
      output_parsed: {
        sections: [{ heading: 'X', kind: 'evidence', text: 'X', citations: ['invented'] }],
        warnings: [],
      },
    });
    await expect(provider.answer('Question', 'answer', documents)).rejects.toThrow();
  });
});
