export function classifyXText(text: string) {
  const lower = text.toLowerCase();
  const themes: [string, RegExp][] = [
    ['IA', /\b(ai|ia|llm|gpt|openai|claude|anthropic|ollama)\b/],
    ['Agents IA', /\b(agents?|mcp)\b/],
    ['Automatisation', /\b(n8n|automation|automatisation|workflow|zapier)\b/],
    ['Développement', /\b(github|api|code|python|typescript|javascript|vue|react|repository)\b/],
    ['Data', /\b(data|reporting|sql|dashboard|power bi)\b/],
    ['Business', /\b(business|saas|startup|sales|pricing|client)\b/],
    ['Formation', /\b(tutorial|tutoriel|course|guide|formation)\b/],
  ];
  const topics = themes.filter(([, regex]) => regex.test(lower)).map(([topic]) => topic);
  const signals = [
    /\b(guide|tutorial|tutoriel|how to|méthode|method)\b/,
    /\b(github|script|workflow|template|code|outil|tool)\b/,
    /\b(example|exemple|benchmark|résultat|result|étape|step)\b/,
  ];
  return { topics, utilitySignal: signals.filter((regex) => regex.test(lower)).length };
}
export function metricEngagement(metrics: {
  like_count: number;
  retweet_count: number;
  quote_count: number;
  reply_count: number;
}) {
  return metrics.like_count + 2 * metrics.retweet_count + metrics.quote_count + metrics.reply_count;
}
export function observedMomentum(
  previous: { engagement: number; capturedAt: Date } | null,
  current: number,
  at: Date,
) {
  if (
    !previous ||
    at.getTime() - previous.capturedAt.getTime() < 15 * 60000 ||
    current < previous.engagement
  )
    return null;
  return (
    (current - previous.engagement) / ((at.getTime() - previous.capturedAt.getTime()) / 3600000)
  );
}
