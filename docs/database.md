# Base de données

PostgreSQL 16 et pgvector 0.8.1, volume Compose persistant.

| Entité          | Responsabilité                                                                |
| --------------- | ----------------------------------------------------------------------------- |
| Source          | Catalogue de plateformes                                                      |
| Content         | Raw, texte normalisé, provenance, hash et identité                            |
| SourceReference | Soumissions et URL alternatives                                               |
| KnowledgeCard   | Projection courante lisible et recherchable                                   |
| CardAnalysis    | Révision immuable, modèle, prompt, pipeline, usages                           |
| Topic / Concept | Vocabulaires distincts en many-to-many                                        |
| Embedding       | Vecteur 1536, fournisseur, modèle et révision                                 |
| ProcessingJob   | Entrée conservée, raw téléchargé, états, erreurs, bail                        |
| WatchSettings   | Critères personnels, plafond et prochaine collecte opt-in                     |
| WatchSource     | Flux RSS/Atom, activation et état du dernier accès                            |
| WatchRun        | Collecte durable, bail, snapshots, compteurs et erreurs                       |
| WatchCandidate  | Proposition, snapshot de provenance, pré-tri et décision atomique liée au job |

La fiche pointe vers une révision active ; les anciennes analyses et leurs vecteurs sont conservés. La recherche utilise uniquement la révision active dans l’espace du fournisseur/modèle configuré. Changer de modèle demande de réanalyser les fiches concernées.

## Migrations

```bash
npm run db:generate
npm run migration
# Développement seulement, après modification du schéma :
npm run migration:dev -- --name description_du_changement
```

La migration initiale crée extension, tables, contraintes, catalogues, GIN et HNSW. Le compte initial doit pouvoir installer l’extension et le serveur posséder pgvector. L’image fournie le permet. Ne pas remplacer les migrations par `prisma db push`.

`20261026160000_watch` ajoute la veille et `ProcessingJob.discovery` sans modifier les captures existantes. La contrainte unique d’URL empêche les doublons de propositions ; `jobId` est unique pour relier une décision à un traitement. Les contraintes SQL bornent plafond, score de correspondance et compteurs. Voir [veille](watch.md) pour les baux, décisions et limites.

## Tests et sauvegarde

Les commandes de test créent une base dérivée terminant par `_test`, y appliquent les migrations et ne tronquent que cette base. Le compte doit pouvoir créer une base. `TEST_DATABASE_URL` peut désigner une base de test déjà préparée. Ne jamais désigner une base contenant des données utiles. Ne pas lancer intégration et E2E simultanément sur la même base.

```bash
mkdir -p .local/backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > .local/backups/knowledge.sql
```

Conserver une copie chiffrée hors de cette machine et vérifier sa restauration sur une base isolée. Git ne sauvegarde pas les captures PostgreSQL. `docker compose down` conserve les volumes ; `down -v` les détruit. Changer le mot de passe dans `.env` ne change pas celui d’un volume déjà initialisé.
