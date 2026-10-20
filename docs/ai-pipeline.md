# Pipeline IA

`CREATED → FETCHING → EXTRACTING → ANALYZING → EMBEDDING → COMPLETED`, ou `FAILED` à chaque étape.

L’Inbox affiche code, message et tentative ; une relance remet le job en file. `retryable=false` indique qu’une modification de l’entrée ou des credentials sera normalement nécessaire, sans empêcher la relance volontaire.

Raw sauvegardé avant extraction ; texte normalisé et provenance avant analyse. La fiche n’est publiée qu’avec analyse et vecteur valides. La reprise réutilise les données persistées. Une source refusée ne crée pas de faux contenu.

## Fournisseurs

`AIProvider` expose `analyzeContent` et `createEmbedding`. La composition sélectionne le fournisseur ; aucun appel OpenAI dans les contrôleurs ni dans le métier.

### OpenAI

Configurer `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_ANALYSIS_MODEL`, `OPENAI_EMBEDDING_MODEL`. Responses avec Structured Outputs, schéma Zod strict et `store:false`. Prompt versionné dans `apps/api/src/prompts/knowledge-analysis.v1.ts`. Le texte source reste une donnée non fiable, pas une instruction.

Les scores et champs sont validés avant persistance. Le score global est la moyenne des six scores, arrondie à deux décimales. Évaluation heuristique, sans vérification factuelle externe.

L’analyse reçoit au plus 60 000 caractères. L’embedding utilise au plus 6 000 caractères du titre/résumé/idées. Le texte original reste conservé jusqu’à 100 000 caractères. Pas encore de chunking.

Vecteurs : exactement 1536 valeurs finies, non nulles. Appels avec timeout et reprise bornée. Les usages de tokens disponibles sont conservés dans les révisions. Aucun appel réel OpenAI validé sans clé.

### Local

Sans clé ni coût : extrait du texte, premières phrases, topic « à classer », scores fixes 5/10, listes d’insights/actions vides. Vecteur déterministe par hash lexical normalisé. **Ce n’est pas une analyse IA ni une recherche sémantique réelle.** L’interface le précise.

## Réanalyse

`POST /api/cards/:id/reanalyze` traite la capture conservée avec le fournisseur, prompt et pipeline courants. Une nouvelle révision n’est activée qu’après succès complet. Historique visible dans le détail.

Le seed réserve ses propres jobs et utilise le fournisseur local sans consommer les jobs utilisateur.

## Limites

Pas de fusion sémantique de sources, vérification des claims, graphe ni recommandations. Une seule dimension vectorielle en V1 ; un changement impose migration et stratégie de réembedding.
