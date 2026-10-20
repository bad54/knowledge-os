# Architecture

Monolithe modulaire et workspace npm.

| Dossier                 | Rôle                                         |
| ----------------------- | -------------------------------------------- |
| apps/web                | Vue 3, Composition API, client REST          |
| apps/api/src/api        | Contrôleurs, validation et erreurs HTTP      |
| apps/api/src/ingestion  | Registre et adapters                         |
| apps/api/src/processing | File durable et pipeline                     |
| apps/api/src/ai         | Fournisseurs IA                              |
| apps/api/src/knowledge  | Lecture, filtres et recherche                |
| packages/domain         | Ports, contenus normalisés et erreurs métier |
| packages/shared         | Contrats Zod et vues TypeScript              |
| infra                   | Images Docker et workflows externes          |

Les contrôleurs délèguent aux services. Aucun accès DB depuis Vue. Les appels IA restent dans les fournisseurs. Les adapters sont enregistrés dans la composition ; le pipeline ne contient pas de conditions par plateforme.

## Décisions V1

- **Prisma 6** : client typé et migrations SQL reproductibles. pgvector utilise un champ `Unsupported` et des requêtes paramétrées isolées dans la persistance/recherche.
- **PostgreSQL comme file** : `FOR UPDATE SKIP LOCKED`, bail de trois minutes, heartbeat de 30 secondes et jeton de possession. Un traitement interrompu est repris ; cinq expirations entraînent un échec visible. Un worker traite un job à la fois ; plusieurs processus peuvent partager la file.
- **Publication atomique** : fiche, classification, révision, embedding et statut final sont publiés ensemble. La capture est sauvegardée avant l’IA. Une réanalyse échouée conserve la version active.
- **Déduplication exacte** : URL canonique, identifiant externe et hash du texte normalisé, avec verrous transactionnels ordonnés et contraintes uniques. Une soumission normalisée ajoute une référence de provenance.
- **Recherche** : filtres, texte PostgreSQL et cosinus pgvector, fusion RRF. Calcul exact sur le corpus filtré ; l’index HNSW prépare une optimisation future. Pas encore de recherche ANN optimisée pour de grands volumes.

La canonicalisation retire le fragment et les paramètres de tracking connus. Le contenu de la première capture est conservé lorsqu’une URL connue change. Les alias dédupliqués seulement par hash restent des références ; pas encore de registre complet d’identités d’URL ni de versions successives du texte source.

## Frontières futures

`KnowledgeRelationType` définit les types possibles sans implémenter un graphe. Concepts et topics sont distincts. Projets, décisions et actions pourront devenir des modules consommant les IDs des fiches et révisions. Chunking, déduplication sémantique et nouveaux fournisseurs doivent rester derrière les ports existants.

## Sécurité et observabilité

Entrées Zod strictes, UUIDs validés, limites de corps/contenu et timeout réseau. Jeton bearer facultatif en local, nécessaire avant exposition publique ; limite simple par IP en mémoire. V1 mono-utilisateur, sans rôles.

Le fetch vérifie protocole, port, toutes les réponses DNS, chaque redirection et épingle l’IP au socket. Adresses privées/réservées et credentials dans les URL refusés. Les headers d’authentification ne passent pas vers une autre origine. Pas de contournement de connexion, paywall ou anti-bot.

Logs JSON Pino : job, étape, fournisseur, modèle, statut et durée. Pas de texte source, clé ni header d’authentification journalisé. Les révisions prévoient l’usage des tokens. Tracing, coûts et métriques restent à ajouter. Les erreurs inconnues restent génériques côté client.
