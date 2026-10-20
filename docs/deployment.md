# Mise en ligne

Le dépôt contient l’application complète, mais un push Git ne crée pas d’hébergement. `localhost` désigne l’ordinateur qui ouvre le lien, pas cet environnement distant. Ne pas annoncer une mise en ligne tant que l’URL HTTPS n’a pas été réellement vérifiée.

## Railway : configuration prévue

Un projet, trois services, un volume persistant :

| Service | Source                                 | Configuration                                                                                         |
| ------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| db      | pgvector/pgvector:0.8.1-pg16           | POSTGRES_USER/DB et mot de passe généré ; volume /var/lib/postgresql/data ; réseau privé              |
| api     | Dépôt bad54/knowledge-os, branche main | Dockerfile infra/docker/Dockerfile ; KNOWLEDGE_IMAGE_TARGET=api ; PORT=3000 ; healthcheck /api/health |
| web     | Même dépôt et Dockerfile               | KNOWLEDGE_IMAGE_TARGET=web ; API_UPSTREAM=api.railway.internal:3000 ; domaine HTTPS sur port 8080     |

Conserver la racine du dépôt comme build context : les packages partagés sont nécessaires. Railway transmet les variables déclarées `ARG` pendant le build ; seul le choix de cible est un build argument. Ne jamais déclarer de secret IA comme build argument ni le compiler dans Vue.

L’API écoute IPv4/IPv6. Son DATABASE_URL doit utiliser le hostname privé réel du service db et ses credentials, via variables de référence Railway. Définir API_TOKEN aléatoire, WEB_ORIGIN avec le domaine HTTPS du frontend et AI_PROVIDER=local pour démarrer sans coût OpenAI. Le service web transmet le bearer saisi dans l’interface ; il ne stocke pas de clé serveur dans ses assets. Ne publier ni base ni port API brut ; seul web nécessite un domaine public.

La migration initiale doit pouvoir activer pgvector. Les migrations tournent au démarrage de l’API avant son healthcheck. Le volume DB doit être attaché avant sa première initialisation.

Configurer l’intégration GitHub de Railway sur ce dépôt pour les futurs déploiements à chaque push ; les commits de développement peuvent aussi être déployés explicitement après validation. Un push réussi et un déploiement réussi sont deux états différents.

## Coûts et état

Les trois services et le stockage peuvent générer des frais. Vérifier le plan du workspace, ses crédits, les limites de ressources et le budget accepté avant de démarrer des ressources payantes. Le coût dépend des durées d’exécution, RAM/CPU, volume et réseau. Pas de promesse de gratuité permanente. Voir https://docs.railway.com/pricing/plans.

Ce guide décrit une configuration reproductible ; il ne prouve pas qu’un projet a été déployé. Un service doit être en état SUCCESS et son URL testée avant d’être présenté comme accessible.

## Vérifications après publication

- UI et routes Vue accessibles après rechargement direct.
- API protégée : requêtes sans bearer refusées, `/api/health` disponible.
- Texte de test → COMPLETED → fiche persistée → recherche ; supprimer/identifier ensuite cette capture de test.
- PostgreSQL et API privés, aucune variable sensible dans le code ou les logs.
- Plan de sauvegarde/restauration et monitoring de consommation.

Pour un serveur Docker classique, conserver la configuration Compose sur l’interface loopback et ajouter un reverse proxy HTTPS authentifié adapté à votre domaine. Ne pas ouvrir simplement tous les ports sur Internet.
