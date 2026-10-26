import type { WatchSettingsInput } from '@knowledge/shared';
import type { FeedEntry } from './feed';
export const WATCH_RANKING_VERSION = 'keywords.v1';
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function matches(text: string, term: string) {
  const escaped = fold(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^\\p{L}\\p{N}])' + escaped + '($|[^\\p{L}\\p{N}])', 'u').test(text);
}
export function rankEntry(
  entry: Pick<FeedEntry, 'title' | 'excerpt' | 'language'>,
  settings: WatchSettingsInput,
) {
  const text = fold(entry.title + '\n' + entry.excerpt);
  if (settings.excludeKeywords.some((term) => matches(text, term))) return null;
  const language = entry.language.split(/[-_]/)[0];
  if (language !== 'und' && settings.languages.length && !settings.languages.includes(language))
    return null;
  const terms = [...new Set([...settings.topics, ...settings.includeKeywords].map(fold))];
  const found = terms.filter((term) => matches(text, term));
  if (terms.length && !found.length) return null;
  return {
    selectionScore: terms.length ? Math.round((found.length / terms.length) * 100) : 0,
    reasons: [
      found.length
        ? 'Correspond à : ' + found.join(', ')
        : 'Aucun sujet défini : proposition sans classement personnalisé.',
      'Pré-tri sur le titre et l’extrait du flux ; qualité et fiabilité non évaluées.',
      ...(language === 'und' && settings.languages.length
        ? ['Langue non indiquée : à confirmer.']
        : []),
    ],
    rankingVersion: WATCH_RANKING_VERSION,
  };
}
