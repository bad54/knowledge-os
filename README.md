# Knowledge OS

**Application en ligne : https://web-production-355c8.up.railway.app** — accès aux connaissances protégé par jeton. Voir le [guide d’accès](docs/online-access.md).

Gestion personnelle de connaissances : capturer une ressource, conserver sa provenance, produire une fiche structurée et la retrouver par recherche.

Vue 3 / TypeScript / Vite, NestJS REST + Swagger, Prisma, PostgreSQL + pgvector. Monolithe modulaire ; n8n optionnel.

## Démarrer avec Docker

Prérequis : Git, Docker Engine/Desktop et Compose v2 ; ports locaux 5173, 3000 et 5432 disponibles.

```bash
git clone https://github.com/bad54/knowledge-os.git
cd knowledge-os
cp .env.example .env
# Définir POSTGRES_PASSWORD et le même mot de passe dans DATABASE_URL.
# Utiliser un mot de passe aléatoire compatible URL : lettres, chiffres, tiret, underscore.
docker compose up --build -d
docker compose ps
```

L’API applique les migrations avant son démarrage ; le frontend attend sa disponibilité. Ouvrir **http://localhost:5173**, API **http://localhost:3000/api**, Swagger **http://localhost:3000/api/docs**.

Ces adresses fonctionnent sur l’ordinateur qui exécute Docker. Un `localhost` fourni par un environnement distant ne constitue pas un lien public. Voir [déploiement](docs/deployment.md) pour la mise en ligne.

```bash
# Trois exemples fictifs analysés localement, sans coût IA :
docker compose exec api npm run seed
# Arrêter sans supprimer les captures :
docker compose down
# n8n optionnel :
docker compose --profile automation up -d
```

Les volumes conservent les données. Ne pas utiliser `down -v` sauf pour effacer volontairement les bases.

## Développement

Prérequis supplémentaires : Node.js 22.12+ et npm, Node 22 ou 24 conseillé.

```bash
npm ci
docker compose up -d db
npm run migration
npm run build:packages
npm run seed
npm run dev
```

API 3000, Vite 5173 avec proxy `/api`. `npm run db:generate` régénère Prisma. Toute évolution du schéma passe par `npm run migration:dev -- --name description`, puis commit de migration. En exploitation : `npm run migration` uniquement.

## Configuration

| Variable                                        | Utilisation                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| DATABASE_URL                                    | PostgreSQL en développement ; Compose fournit l’URL réseau interne à l’API |
| POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB | Initialisation PostgreSQL Docker                                           |
| API_TOKEN                                       | Bearer ; vide uniquement en local, obligatoire avant exposition publique   |
| REQUIRE_API_TOKEN                               | `true` en ligne : refuse le démarrage sans jeton d’au moins 32 caractères  |
| WEB_ORIGIN                                      | Origine autorisée, défaut http://localhost:5173                            |
| AI_PROVIDER                                     | `local` sans clé ou `openai`                                               |
| OPENAI_API_KEY                                  | Clé serveur, jamais dans Vue ou Git                                        |
| OPENAI_ANALYSIS_MODEL                           | Défaut gpt-4.1-mini, compatible Structured Outputs                         |
| OPENAI_EMBEDDING_MODEL                          | Défaut text-embedding-3-small, 1536 dimensions                             |
| YOUTUBE_API_KEY                                 | Métadonnées officielles facultatives                                       |
| YOUTUBE_ACCESS_TOKEN                            | OAuth autorisé pour télécharger les sous-titres accessibles au compte      |
| LOG_LEVEL                                       | info, debug, warn, error ou silent                                         |

Pour une API protégée, saisir son jeton confidentiel dans « Clé d’accès privée », puis « Ouvrir ma bibliothèque » ; il reste dans le sessionStorage de l’onglet. « Verrouiller » efface cette copie et retire les fiches affichées. Sans clé valide, la bibliothèque affiche son état verrouillé. Swagger/OpenAPI sont également protégés. Aucun secret dans le dépôt. Voir [accès en ligne et confidentialité](docs/online-access.md).

**Fournisseur local / Analyse extractive** : résumé extractif, scores fixes 5/10 et similarité lexicale, traités sur le serveur applicatif. Il permet d’utiliser le produit sans API externe ; ce n’est pas une analyse IA ni une recherche sémantique réelle. Ce nom ne signifie pas que les données sont stockées sur votre ordinateur : sur Railway, elles restent hébergées chez Railway. OpenAI active l’analyse IA et la recherche sémantique en transmettant les contenus nécessaires au fournisseur. Une réanalyse crée une version avec le fournisseur courant.

## Vérifier

Le workflow GitHub Actions `Knowledge OS checks` exécute les contrôles ci-dessous à chaque push sur `main` et sur les pull requests. Il utilise une base PostgreSQL/pgvector éphémère et le fournisseur local, sans secret ni appel IA payant. Les tests d’intégration et navigateur s’exécutent successivement.

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test
npm run test:integration
npx playwright install --with-deps chromium
npm run test:e2e
```

Intégration et E2E utilisent PostgreSQL/pgvector et des services externes simulés. Ces suites créent une base isolée finissant par `_test` et peuvent la vider. `TEST_DATABASE_URL` peut désigner une base de test préparée ; le compte DB doit pouvoir la créer si nécessaire. Ne pas lancer les deux suites simultanément sur la même base. Avec Chromium système : `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e`.

## Fonctionnalités et limites V1

Capture manuelle et web statique ; YouTube avec transcription fournie ou sous-titres officiellement autorisés ; Inbox durable et relance ; provenance et raw conservés ; déduplication URL/ID/hash ; topics/concepts ; analyses versionnées ; scores, filtres et recherche texte/vectorielle/hybride ; cinq écrans responsive.

Reddit et X : import manuel opérationnel, intégrations API non connectées. Pas de contournement de restrictions. Pas encore de PDF, chunking, fusion sémantique, graphe, multi-utilisateur, projets ou décisions. Les appels réels OpenAI/YouTube demandent vos credentials et ne sont pas validés sans ceux-ci.

Dans cet environnement de développement, le trafic Internet passe par un proxy. Le fetch SSRF épingle les IP et ne délègue pas la résolution au proxy ; les téléchargements web externes réels peuvent donc être indisponibles ici. Les fixtures testent le pipeline sans ce réseau. Sur un hôte Docker classique, le fetch public utilise le réseau direct autorisé de cet hôte.

## Organisation

```text
apps/api       API, pipeline, adapters, IA, Prisma et migrations
apps/web       Vue 3, pages et composants
packages       domaine et contrats partagés
infra          Docker et n8n
tests          unitaires, intégration et E2E
docs           décisions et guides
```

[Architecture](docs/architecture.md) · [Base de données](docs/database.md) · [Ajouter une source](docs/adding-a-source.md) · [Pipeline IA](docs/ai-pipeline.md) · [n8n](docs/n8n.md) · [Déploiement](docs/deployment.md)

Chaque modification cohérente validée est commitée et poussée sur GitHub selon la demande du propriétaire. Git sauvegarde le code ; PostgreSQL nécessite ses propres backups.
