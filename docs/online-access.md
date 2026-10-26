# Accéder à Knowledge OS en ligne

Ouvrir **https://web-production-355c8.up.railway.app**.

L’accès aux connaissances est protégé par un jeton personnel :

1. Ouvrir le projet Railway https://railway.com/project/fbbbe6ed-d59c-41cf-be81-5232fd7ff3ff.
2. Choisir le service **api**, puis **Variables** dans l’environnement **production**.
3. Copier la valeur de **API_TOKEN** depuis Railway. Ne pas la coller dans une conversation ni dans le dépôt.
4. Revenir dans Knowledge OS, ouvrir **Accès à l’API**, coller le jeton et enregistrer pour la session.

Le jeton est gardé dans le sessionStorage du navigateur et envoyé par header Authorization sur HTTPS. Sans jeton, les assets de l’interface et le healthcheck sont publics ; les contenus restent inaccessibles. Fermer la session du navigateur ou effacer le jeton pour retirer cet accès local.

Le mode local est actif. Les captures manuelles et web, la provenance, les fiches, la déduplication et la recherche vectorielle fonctionnent. Pour utiliser OpenAI, configurer sa clé côté service api, choisir AI_PROVIDER=openai, puis réanalyser les fiches utiles. Une clé OpenAI ne doit jamais être ajoutée au frontend.
