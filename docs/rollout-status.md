# Déploiement Railway — vérifié le 26 octobre 2026

Application : **https://web-production-355c8.up.railway.app**

Projet : https://railway.com/project/fbbbe6ed-d59c-41cf-be81-5232fd7ff3ff

Environnement : `production` (`9884fc3a-e954-4bff-97bb-2fc7b90559d7`).

| Service | Déploiement actif vérifié            | État                |
| ------- | ------------------------------------ | ------------------- |
| db      | bd0109a2-c1b1-4ce8-bd00-efade7d042b5 | SUCCESS, 1 instance |
| api     | eef9cbd9-0374-4562-a575-511cdf10f476 | SUCCESS, 1 instance |
| web     | 42241265-b73b-40da-a33d-61e340153393 | SUCCESS, 1 instance |

Le volume `knowledge-postgres` de 512 Mo est conservé à `/var/lib/postgresql/data`. Le cluster actif utilise `PGDATA=/var/lib/postgresql/data/knowledge-v1`. Le premier cluster, devenu incohérent pendant le placement initial, reste conservé dans l’ancien dossier `pgdata` ; aucun contenu utilisateur n’y avait été importé. Ne pas supprimer ces dossiers ni le volume sans revue et sauvegarde.

La base, son volume, l’API et le frontend sont en Europe (`europe-west4-drams3a`). Les trois services sont en ligne, avec une instance active chacun et aucun déploiement en cours.

## Veille RSS — publiée et vérifiée

Le module de veille est publié : commit fonctionnel `4f0335564f9680497c055ce5142b422ba10bc013`, puis correction RSS/CDATА `61f077dcc27b1668a6b577f876060d3b03bd9ddc`. Les deux services applicatifs sur cette version sont SUCCESS, avec une instance active chacun. La migration `20261026160000_watch` a été appliquée au démarrage sans supprimer les données existantes.

La page `/watch` et son JavaScript sont servis en HTTPS avec HTTP 200. L’asset `index-DFa3nG3j.js` correspond exactement par SHA-256 au build validé localement. Validation : 31 tests unitaires, 22 tests PostgreSQL/pgvector, 6 tests navigateur ; TypeScript, lint, formatage et build passent. Le parcours navigateur RSS → Garder → Inbox → fiche avec texte intégral est testé sur mobile. Voir [utilisation de la veille](watch.md).

Vérification réelle le 26 octobre à **16 h 43 (Europe/Paris)** : une source de départ **GitHub Blog** (`https://github.blog/feed/`) a été ajoutée dans la veille initialement vide. La collecte `4f4d71f8-8a40-4deb-905a-9a4953adc20b` est COMPLETED : dix entrées examinées, dix propositions, aucune erreur de source. Les deux fiches présentes avant la collecte restent les deux seules fiches après celle-ci. Aucune proposition n’a été gardée automatiquement. La planification reste désactivée ; aucun critère personnel n’a été inventé ni clé OpenAI activée.

`GET /api/watch` retourne HTTP 401 sans bearer et HTTP 200 avec la clé configurée. Les réponses API portent `Cache-Control: private, no-store`. Les écrans de connexion et de verrouillage restent actifs. Aucun secret n’est présent dans les assets ou la documentation.

L’incident antérieur du constructeur Railway (`mount source: "overlay" ... err: invalid argument`, avant compilation) ne s’est pas reproduit sur ces déploiements. Le constructeur reste DOCKERFILE / environnement de build V3 ; aucun contournement Config as Code n’est installé.

## Vérifications réelles

- Interface et rechargement d’une route Vue en HTTPS : HTTP 200.
- Healthcheck : HTTP 200.
- Fiches, dashboard, topics, Inbox, recherche et documentation API : HTTP 401 sans bearer, refus d’un bearer incorrect.
- Capture manuelle → COMPLETED → fiche avec provenance et révision.
- Nouvelle soumission du même texte → même fiche.
- Recherche vectorielle → capture retrouvée.
- Téléchargement réel de `https://example.com/` → fiche avec URL source préservée.

Un exemple fictif de validation du déploiement et la page Example Domain sont conservés comme données de vérification. Le fournisseur est `local` : analyse extractive, scores fixes et similarité lexicale. OpenAI reste à connecter pour l’analyse IA et la recherche sémantique réelle.

## Exploitation

Les sources applicatives suivent la branche `main` du dépôt `bad54/knowledge-os`. Les modifications de code, packages, lockfile, configuration TypeScript et fichiers Docker déclenchent les builds Railway. Les modifications de documentation seules sont ignorées par Railway ; une entrée SKIPPED ne remplace pas la dernière release active SUCCESS. GitHub Actions continue à vérifier les pushes et les pull requests.

Les anciens échecs de déploiement restent dans l’historique. Le redémarrage de la nouvelle base et la publication HTTPS ont été explicitement autorisés par le propriétaire le 26 octobre 2026.

`REQUIRE_API_TOKEN=true` interdit un démarrage sans bearer d’au moins 32 caractères. Les valeurs sensibles sont dans les variables Railway et hors Git. Seul le frontend a un domaine public ; la base et l’API sont joignables par réseau privé, les appels du navigateur passant par le proxy web.

Voir [accéder à l’application](online-access.md). Prévoir des sauvegardes hors plateforme et une vérification de restauration ; un volume persistant et un push Git ne constituent pas une sauvegarde indépendante.
