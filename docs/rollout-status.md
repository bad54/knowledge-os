# Déploiement Railway — vérifié le 26 octobre 2026

Application : **https://web-production-355c8.up.railway.app**

Projet : https://railway.com/project/fbbbe6ed-d59c-41cf-be81-5232fd7ff3ff

Environnement : `production` (`9884fc3a-e954-4bff-97bb-2fc7b90559d7`).

| Service | Déploiement actif vérifié            | État                |
| ------- | ------------------------------------ | ------------------- |
| db      | bd0109a2-c1b1-4ce8-bd00-efade7d042b5 | SUCCESS, 1 instance |
| api     | d311f2d0-5af4-40cd-8e3f-fa4200d47b5f | SUCCESS, 1 instance |
| web     | 8aa6bd33-7b95-4b33-bfc4-c33a7939af88 | SUCCESS, 1 instance |

Le volume `knowledge-postgres` de 512 Mo est conservé à `/var/lib/postgresql/data`. Le cluster actif utilise `PGDATA=/var/lib/postgresql/data/knowledge-v1`. Le premier cluster, devenu incohérent pendant le placement initial, reste conservé dans l’ancien dossier `pgdata` ; aucun contenu utilisateur n’y avait été importé. Ne pas supprimer ces dossiers ni le volume sans revue et sauvegarde.

La base et son volume sont en Europe (`europe-west4-drams3a`). Les instances applicatives actives sont encore en `us-west2` ; leurs configurations cibles sont en Europe pour un prochain déploiement. Les connexions privées entre régions ont été vérifiées. Cette répartition peut ajouter de la latence.

## Mise à jour de l’accès privé — publication bloquée

Le commit `ecf75a5a7dbc71b2cbb4c5c40c7c8593e9d4efac` ajoute un état « Votre bibliothèque est verrouillée », une connexion explicite, un bouton de verrouillage qui efface le jeton de l’onglet et la clarification « Analyse extractive ». Les 23 tests unitaires, 10 tests d’intégration PostgreSQL/pgvector et 5 tests navigateur passent, ainsi que TypeScript, lint, formatage et build. Le nouveau test navigateur vérifie une mauvaise clé, une bonne clé, le rechargement et le verrouillage sur mobile.

Cette version n’est **pas encore publiée**. Les builds initiaux `9fae9e70-7d70-450d-8321-adf51cb80960` (web) et `7575fca9-591b-4640-adad-829491bff330` (api), puis les relances `04993e05-2ff6-416f-ac8a-7da6b330cbee` et `cc2f2c38-6e22-4224-97e5-281a6d77c198`, ont échoué avant compilation. Le constructeur Railway retourne `mount source: "overlay" ... err: invalid argument` dès la préparation du système de fichiers. Aucun changement du domaine, des secrets, du volume ou du réseau privé n’a été nécessaire.

Une tentative de sélectionner un autre environnement de build via Config as Code a été refusée par Railway : ce mécanisme est désormais déprécié au profit de `.railway/railway.ts`. La tentative n’a modifié aucune configuration active et aucun fichier de contournement n’est conservé. Ne pas annoncer un changement de constructeur effectif.

Dernière vérification HTTPS en lecture seule le 26 octobre à **16 h 08 (Europe/Paris)** : interface, asset JavaScript et healthcheck HTTP 200 ; les sept routes de données/documentation contrôlées renvoient HTTP 401 sans clé ; une mauvaise clé est refusée ; la bonne clé donne accès aux deux fiches de test. L’asset servi reste celui de l’ancienne interface. Résoudre le problème du constructeur Railway, puis redéployer le commit applicatif, attendre SUCCESS et revérifier l’asset et les accès. Les identifiants ci-dessus permettent d’ouvrir un ticket Railway sans transmettre les secrets.

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
