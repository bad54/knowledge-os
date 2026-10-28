# Corpus X : collecte, import et réponses sourcées

Ce module constitue le premier jalon social : **X, puis Reddit, puis YouTube**. Il conserve les publications comme un corpus distinct des fiches analysées. La veille RSS reste complémentaire et conserve son fonctionnement existant.

## Commencer sans compte développeur X

1. Ouvrir `/x` après déverrouillage de Knowledge OS.
2. Télécharger le bouton d’export V12. Suivre le fichier d’installation : remplacer uniquement `popup.html` et `popup.js` dans le dossier de **l’extension existante**, puis la recharger dans `chrome://extensions`. Ne pas désinstaller l’extension ni changer son identité : les captures appartiennent à son stockage Chrome.
3. Exporter les publications, puis importer le JSON dans Corpus X. L’archive V12 fournie contient le code de l’extension ; elle ne contient pas les publications stockées dans le navigateur.
4. Attendre l’indexation en arrière-plan. Actualiser pour voir les fiches et statuts. Poser une question pour retrouver les extraits et leurs références `[B1]`.

Le bouton lit exclusivement `xHistoryPosts`, sélectionne une liste explicite de champs sources et télécharge un fichier local. Il n’exporte aucune clé OpenAI, réponse IA, projet ou configuration de l’extension. Le JSON reste un fichier privé contenant les publications : conserver une sauvegarde adaptée. L’API ignore les champs inconnus de chaque publication ; ne jamais exporter l’ensemble de `chrome.storage.local`.

Formats : tableau de publications ou `{ "posts": [...] }`, jusqu’à 10 Mo dans l’interface. Celle-ci envoie des lots d’au plus 100 publications / 350 Ko ; l’API conserve sa limite globale de 512 Ko. Chaque publication nécessite un `post_id` numérique et `text` ou `quoted_text`. Les enregistrements invalides sont signalés par leur position et ignorés ; les lots déjà importés restent enregistrés après une interruption. Réimporter le même fichier est sans doublons par identifiant X.

## Brancher l’API officielle

Variables **du service API**, jamais du frontend :

| Variable               | Valeur par défaut | Rôle                                                            |
| ---------------------- | ----------------- | --------------------------------------------------------------- |
| `X_BEARER_TOKEN`       | vide              | Jeton développeur X autorisé pour les recherches souhaitées     |
| `X_DAILY_READ_LIMIT`   | `100`             | Réservation maximale quotidienne UTC de publications demandées  |
| `X_AUTO_CARDS_PER_DAY` | `5`               | Fiches demandées depuis le corpus par jour UTC, imports compris |
| `X_EMBEDDINGS_PER_DAY` | `500`             | Indexations de publications réservées par jour UTC avec OpenAI  |

L’utilisateur doit obtenir son accès développeur et vérifier les droits et tarifs actuels sur son compte X. Aucun abonnement ou achat automatique. La recherche récente utilise `GET /2/tweets/search/recent`, les archives `GET /2/tweets/search/all`. Les autorisations de recherche, fenêtres disponibles et éventuels coûts dépendent du compte X. Pas de contournement ni de scraping.

Créer une règle de recherche avec sujet, requête X, fréquence et nombre de publications par page (10–100). Les règles sont **en pause par défaut**. Une collecte manuelle ou une activation explicite est nécessaire pour effectuer des appels. Une règle d’archives exige une période fixe et se désactive quand toutes ses pages ont été parcourues. Chaque exécution traite une page ; le curseur reprend la suivante. La recherche récente avance son `since_id` seulement après la dernière page de la fenêtre. Les collectes identiques simultanées sont regroupées.

Le budget réserve le maximum demandé **avant** l’appel ; une requête vide, échouée ou interrompue peut donc consommer sa réservation. Ce plafond applicatif prudent n’est **pas une garantie de montant facturé**. Les expansions de profils et les téléchargements de threads ne sont pas demandés. Les réponses déjà téléchargées sont persistées pour reprendre un traitement interrompu sans nouvel appel. Si le processus s’arrête avant cette persistance, une nouvelle requête peut être nécessaire et réservera un nouveau budget. Les erreurs sont visibles et une nouvelle collecte peut être lancée ; aucun résultat n’est inventé.

## Sélection et questions

Toutes les publications valides alimentent le corpus. Le texte initial est immuable ; de nouvelles captures peuvent être enregistrées sans l’écraser. Les règles lexicales `utilitySignal` (0–3) identifient des guides, outils et exemples, et sélectionnent automatiquement quelques fiches par lot dans le budget quotidien. Il s’agit d’un premier tri explicite, **pas d’un classement IA des meilleurs contenus de X**. Les fiches utilisent ensuite le pipeline d’analyse configuré et restent consultables dans la bibliothèque.

Trois mesures distinctes :

- Popularité : `likes + 2 × reposts + réponses + citations`, uniquement si l’API fournit ces compteurs. Les imports V12 n’en possèdent pas.
- Progression : variation de cette mesure par heure entre deux observations espacées d’au moins quinze minutes. Inconnue lors de la première observation ou après correction négative des compteurs. Les recherches peuvent retrouver la même publication ; aucune collecte dédiée des métriques n’est effectuée.
- Écart au corpus : distance au vecteur connu le plus proche au moment de l’indexation, limitée à 0–1. Cela ne prouve ni originalité, ni innovation, ni véracité ; cette mesure ne reflète pas encore des regroupements de sujets ou des évolutions temporelles.

Questions : recherche hybride texte/pgvector, fusion RRF, décomposition en au plus trois recherches, reclassement IA des candidats et sélection de huit sources maximum avec diversité d’auteurs. Le port `KnowledgeReasoner` sépare ce raisonnement du fournisseur d’analyse des fiches. Les prompts résident dans `apps/api/src/prompts/x-reasoning.v1.ts`. Les Structured Outputs et les références sont validés avant stockage. Chaque réponse enregistre modèle, version du prompt, textes effectivement fournis et références stables. Les recommandations générées sont séparées des sections issues des sources. Des citations valides n’établissent pas à elles seules la vérité des affirmations : une vérification humaine reste possible grâce aux sources.

En mode `AI_PROVIDER=local`, la recherche utilise les vecteurs lexicaux existants et les réponses affichent **uniquement des extraits**. Pas de synthèse IA, plan, décision ou vérification des faits. Pour activer ces capacités, définir `AI_PROVIDER=openai`, `OPENAI_API_KEY` et un modèle Responses compatible Structured Outputs dans `OPENAI_ANALYSIS_MODEL`. Les textes sélectionnés sont alors transmis à OpenAI ; `store:false` est demandé pour les réponses. Les règles de conservation du fournisseur restent applicables. Les vecteurs sont isolés par fournisseur/modèle et réindexés en arrière-plan lors d’un changement. Le plafond d’indexation ne couvre pas les embeddings des questions, leur décomposition, leur reclassement ni l’analyse des fiches. Deux générations simultanées maximum par processus ; réponses identiques mises en cache une heure pour un état du corpus donné.

La couverture est explicite : publication seule ou publication avec citation capturée. Un lien dans un post n’implique pas que son article ait été lu ; aucun fil complet n’est reconstruit. Enrichir les liens et threads est une prochaine étape distincte.

## Architecture et limites de volume

`XRule` → `XCollectionRun` → `XPost`, `XCapture`, `XObservation` → indexation → recherche / `XAnswer` ou `ProcessingJob` → `KnowledgeCard`.

Le worker utilise PostgreSQL, baux et jetons de possession, sans nouvelle infrastructure. Les captures brutes sont séparées des métriques et des réponses générées. Les index incluent FTS GIN, topics GIN, vecteurs HNSW et curseurs par date/mesure. L’API évite de retourner un corpus entier et applique des limites de candidats. L’authentification privée existante protège toutes les routes `/api/x`.

Ce jalon **n’est pas dimensionné ni testé pour un million de publications**. Le volume Railway existant de 512 Mo n’est pas adapté à cet objectif. Avant une collecte massive : mesurer la taille des textes/vecteurs/index, augmenter le stockage, mettre en place sauvegardes/restauration, chunking, rétention des captures, index ANN filtrés et tests de charge, puis optimiser le classement et les coûts. Les snapshots de réponses et captures ne sont pas encore purgés automatiquement. Aucune donnée fictive n’est injectée en production.

## Vérification

`npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`.

Les tests utilisent des réponses X/OpenAI simulées et une base PostgreSQL/pgvector isolée. Ils couvrent les importations, restrictions de source, quotas, pagination, reprise, déduplication, provenance, références, recherche et parcours navigateur. Les appels réels X/OpenAI nécessitent les accès correspondants ; leur fonctionnement ne doit pas être affirmé sans vérification réelle.
