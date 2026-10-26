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
