# Déploiement Railway — vérifié le 26 octobre 2026

Application : **https://web-production-355c8.up.railway.app**

Projet : https://railway.com/project/fbbbe6ed-d59c-41cf-be81-5232fd7ff3ff

Environnement : `production` (`9884fc3a-e954-4bff-97bb-2fc7b90559d7`).

| Service | Déploiement actif vérifié            | État                |
| ------- | ------------------------------------ | ------------------- |
| db      | bd0109a2-c1b1-4ce8-bd00-efade7d042b5 | SUCCESS, 1 instance |
| api     | fccfc960-a304-4fef-bc05-6cebb857371a | SUCCESS, 1 instance |
| web     | df2a048d-be11-4b95-92cd-4f1b810ec53a | SUCCESS, 1 instance |

Le volume `knowledge-postgres` de 512 Mo est conservé à `/var/lib/postgresql/data`. Le cluster actif utilise `PGDATA=/var/lib/postgresql/data/knowledge-v1`. Le premier cluster, devenu incohérent pendant le placement initial, reste conservé dans l’ancien dossier `pgdata` ; aucun contenu utilisateur n’y avait été importé. Ne pas supprimer ces dossiers ni le volume sans revue et sauvegarde.

La base, son volume, l’API et le frontend sont en Europe (`europe-west4-drams3a`). Les trois services sont en ligne, avec une instance active chacun et aucun déploiement en cours.

## Mise à jour de l’accès privé — publiée et vérifiée

Le commit `ecf75a5a7dbc71b2cbb4c5c40c7c8593e9d4efac` ajoute un état « Votre bibliothèque est verrouillée », une connexion explicite, un bouton de verrouillage qui efface le jeton de l’onglet et la clarification « Analyse extractive ». Les 23 tests unitaires, 10 tests d’intégration PostgreSQL/pgvector et 5 tests navigateur passent, ainsi que TypeScript, lint, formatage et build. Le nouveau test navigateur vérifie une mauvaise clé, une bonne clé, le rechargement et le verrouillage sur mobile.

Le frontend corrigé est publié : déploiement `df2a048d-be11-4b95-92cd-4f1b810ec53a` en état SUCCESS, une instance active. Le JavaScript servi en HTTPS correspond exactement, par SHA-256, au build validé localement (`index-D9eOKtRu.js`). Le déploiement API `fccfc960-a304-4fef-bc05-6cebb857371a` est également en état SUCCESS avec une instance active. Les migrations ont passé le contrôle de démarrage de l’API.

Le blocage initial du constructeur Railway (`mount source: "overlay" ... err: invalid argument`, avant compilation) ne s’est plus reproduit lors de cette relance. Aucun changement du constructeur, du domaine, des secrets, du volume ou du réseau privé n’a été nécessaire. La configuration reste DOCKERFILE / environnement de build V3. L’essai antérieur de Config as Code, refusé par Railway comme déprécié, n’a laissé aucun fichier ni modification active.

Dernière vérification HTTPS en lecture seule le 26 octobre à **15 h 31 (Europe/Paris)** : interface, asset JavaScript et healthcheck HTTP 200 ; les sept routes de données/documentation contrôlées renvoient HTTP 401 sans clé ; une mauvaise clé est refusée ; la bonne clé donne accès aux deux fiches existantes. Le fournisseur reste `local`, sans appel OpenAI. Aucune capture ni modification de données n’a été effectuée pour ces vérifications.

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
