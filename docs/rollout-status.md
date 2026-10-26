# Déploiement Railway — état au 26 octobre 2026

Projet : https://railway.com/project/fbbbe6ed-d59c-41cf-be81-5232fd7ff3ff

Environnement `production` : `9884fc3a-e954-4bff-97bb-2fc7b90559d7`.

| Service | ID                                   | État observé                                                                  |
| ------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| db      | a9509492-fa5f-48af-9c38-dbf56457fdc8 | Image pgvector démarrée initialement, puis processus arrêté ; 0 replica actif |
| api     | 6f259549-551f-4ebd-9c67-d90eaad136e1 | Build terminé ; connexion PostgreSQL bloquée tant que db est arrêtée          |
| web     | 0d81b643-250d-497f-8851-1949f087bc78 | Build terminé ; attend le healthcheck API                                     |

Volume PostgreSQL conservé : `knowledge-postgres`, 512 Mo, monté dans `/var/lib/postgresql/data`. Vérifier l’alignement de région du volume et des instances avant la remise en service. Aucun contenu utilisateur n’a été importé dans cette nouvelle base.

Les deux services applicatifs suivent `bad54/knowledge-os`, branche `main`. Les pushes déclenchent des builds Railway. Les contrôles GitHub Actions sont également actifs ; ne pas confondre leur succès avec un déploiement réussi.

Les credentials de production ont été générés et configurés dans les variables Railway ; aucune valeur n’est publiée dans Git. `REQUIRE_API_TOKEN=true` interdit le démarrage sans bearer d’au moins 32 caractères. Toutes les routes de données sont protégées ; seul le healthcheck est public. Ni base ni API ne possèdent de domaine ou proxy TCP public.

## Étapes restantes

Le contrôle automatique a refusé le redémarrage PostgreSQL, même après confirmation de l’absence de processus actif. Il a également refusé la génération du domaine, en signalant un risque d’exposition de connaissances privées. Ne pas contourner ces refus.

Obtenir l’accord explicite du propriétaire pour remettre en service cette base en conservant le volume, puis publier l’application HTTPS avec authentification obligatoire. Après accord : remettre db en service, attendre les migrations et les états SUCCESS, publier seulement le service web, vérifier HTTP 401 sans jeton et le parcours capture → fiche → recherche avec jeton.

Aucun lien public utilisable n’est encore disponible. Aucun succès de déploiement complet ne doit être annoncé à ce stade.
