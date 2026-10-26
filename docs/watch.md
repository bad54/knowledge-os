# Veille RSS et sélection

Ouvrir **Ma veille** (`/watch`) après connexion. Aucun compte de plateforme ni clé supplémentaire n’est nécessaire pour des flux RSS/Atom publics.

## Utilisation

1. Renseigner les sujets et mots-clés, séparés par des virgules. Un sujet **ou** un mot-clé inclus suffit ; un mot-clé exclu élimine la proposition. Sans sujets ni inclusions, les entrées restent proposées sans classement personnalisé.
2. Ajouter l’URL d’un flux RSS/Atom, pas celle d’une page d’accueil. Le bouton d’exemple préremplit GitHub Blog ; il ne l’enregistre pas et ne lance aucune collecte.
3. Cliquer **Lancer ma veille**. Consulter les propositions et les éventuelles erreurs par source.
4. **Garder** crée un traitement dans l’Inbox qui télécharge l’article complet avec les protections existantes. La fiche est créée après extraction, analyse et embedding. Une page protégée peut échouer ; relancer depuis l’Inbox ou importer un texte autorisé.
5. **Déjà connu** et **Hors sujet** retirent la proposition et conservent le retour. Ces retours n’ajustent pas encore automatiquement les critères.

La collecte toutes les 24 heures est **désactivée par défaut**. L’activer puis enregistrer les critères programme une première collecte dans les prochaines dizaines de secondes, puis une toutes les 24 heures à partir de son déclenchement. Aucune fiche n’est publiée sans **Garder**. NestJS assure la planification ; n8n n’est pas nécessaire. Une collecte manuelle supplémentaire ne change pas la prochaine échéance automatique.

Le plafond quotidien compte les propositions gardées, y compris celles dont le traitement échoue ensuite. Le jour est calculé en UTC. Un double clic sur Garder retourne le même job, même lorsque le plafond est atteint.

## Classement et limites

`keywords.v1` est un **pré-tri lexical**, distinct du Knowledge Score : pourcentage de sujets/mots-clés inclus présents dans le titre ou l’extrait, sans distinction de casse ou d’accents. Les mots sont délimités pour ne pas confondre « AI » avec « available ». Les phrases sont recherchées telles quelles. La qualité, la véracité, la nouveauté sémantique et la popularité ne sont pas évaluées.

La langue déclarée par le flux sert au filtre ; une langue absente (`und`) reste proposée avec une indication. Ce n’est pas une détection linguistique indépendante. Les propositions affichées sont reclassées avec les critères actuels ; la collecte conserve aussi le classement et les critères utilisés à l’origine.

- Dix flux actifs maximum ; cinquante sources enregistrées maximum. Désactiver un flux conserve son historique.
- Les dix premières entrées de chaque flux sont examinées à chaque collecte (cent au maximum). Pas de parcours d’archives ni de pagination de flux. Un flux très actif peut publier plus de dix entrées entre deux collectes.
- Les doublons d’URL canonique sont ignorés, y compris après une décision. Pas encore de déduplication sémantique ni de réouverture des propositions écartées.
- Les cent meilleures propositions parmi les mille dernières en attente sont affichées ; vingt décisions et quinze collectes récentes sont visibles. Pas de purge automatique de l’historique pour cette première version.
- La diversité des auteurs, les recommandations apprenantes et l’ajout automatique à la bibliothèque sont des étapes ultérieures.

## Architecture et provenance

`watch/feed.ts` définit `FeedReader` et son implémentation RSS/Atom, sans dépendance du pipeline à un format de flux. Le lecteur utilise `ContentFetcher` / `SafeFetcher` : HTTP(S) public, DNS vérifié et épinglé, redirections contrôlées, limite de 2 Mo et timeout. Les DTD et déclarations d’entités sont refusées. JSDOM ne charge aucune ressource externe et n’exécute aucun script ; les extraits sont transformés en texte simple avant affichage Vue.

`WatchSettings`, `WatchSource`, `WatchRun` et `WatchCandidate` sont séparés des fiches. Les snapshots de découverte conservent URL du flux, ID de l’entrée, titre, extrait, auteur, langue et publication. Une validation copie cette provenance dans `ProcessingJob.discovery`, puis les métadonnées de capture et `SourceReference`. Le texte intégral de l’article provient de son téléchargement après validation, jamais d’un résumé généré.

La file PostgreSQL utilise `SKIP LOCKED`, un bail de trois minutes, un heartbeat toutes les trente secondes et un jeton de possession. Après trois prises expirées, la collecte est marquée FAILED ; une nouvelle collecte peut être lancée. Le worker abandonné ne peut plus écrire. Les résultats de chaque source sont transactionnels. Une source en erreur ne supprime pas les résultats des autres ; le statut final peut être PARTIAL. Les lancements simultanés retrouvent la même collecte active.

Les validations et le plafond journalier utilisent un verrou transactionnel commun. La création du job et la décision sont atomiques. Les réglages de planification survivent aux redémarrages et la planification est coordonnée par PostgreSQL entre instances.

## API privée

Toutes les routes suivantes exigent le même bearer que les connaissances en hébergement. Swagger documente les corps et opérations ; les entrées sont validées par les contrats Zod partagés.

| Route                                     | Effet                                                            |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `GET /api/watch`                          | Réglages, sources, collectes, propositions et décisions          |
| `PUT /api/watch/settings`                 | Sujets, inclusions/exclusions, langues, plafond et planification |
| `POST /api/watch/sources`                 | Enregistrer/réactiver une URL de flux canonique                  |
| `PATCH /api/watch/sources/:id`            | Activer/désactiver un flux                                       |
| `POST /api/watch/runs`                    | Lancer ou retrouver la collecte active ; HTTP 202                |
| `POST /api/watch/candidates/:id/decision` | KEEP, KNOWN, OFF_TOPIC ou SKIP                                   |

Un workflow n8n peut appeler `POST /api/watch/runs`, puis sonder `GET /api/watch` jusqu’à un statut terminal du run retourné. Stocker le bearer dans les credentials n8n, jamais dans un export de workflow. Désactiver la planification interne si n8n assure les déclenchements.

La découverte et le pré-tri ne font **aucun appel IA**. Garder utilise ensuite le fournisseur configuré pour le pipeline. Si OpenAI est activé, le contenu de l’article est envoyé au fournisseur ; avec `AI_PROVIDER=local`, il reste traité sur le serveur Railway et les Knowledge Scores restent fixes. Aucun nouvel abonnement ni API payante n’est activé par cette fonctionnalité.

## Vérification

Appliquer les migrations avec `npm run migration`. Les tests couvrent RSS/Atom, nettoyage HTML, XML malveillant, URL privées, critères, collecte/déduplication, erreurs partielles, validations concurrentes, plafond, reprise de bail, planification opt-in et provenance jusqu’à la fiche. Le test navigateur parcourt configuration → collecte → Garder → fiche sur mobile avec un flux externe simulé.

X et Reddit ne sont pas connectés. Leur ajout devra passer par des accès officiels autorisés et traiter leurs règles spécifiques de conservation/suppression ; ce lecteur RSS ne contourne aucune restriction de plateforme.
