# n8n optionnel

NestJS conserve la logique métier ; n8n est un client d’orchestration externe.

```bash
docker compose --profile automation up -d
```

Ouvrir `http://localhost:5678` sur la machine Docker et créer le compte propriétaire. Ne pas exposer ce port publiquement sans authentification et TLS adaptés.

Importer `infra/n8n/capture-url.json`. Le workflow reste inactif jusqu’à configuration.

1. Dans les nœuds HTTP, sélectionner un credential **Header Auth** : nom `Authorization`, valeur `Bearer <API_TOKEN>`. Il reste dans le coffre n8n, pas dans l’export.
2. Avec l’API locale sans jeton, choisir Authentication: None sur ces nœuds.
3. `http://api:3000` est l’URL interne Compose. Pour un n8n distant, utiliser l’URL HTTPS de votre API avec son jeton.
4. Configurer aussi un credential Header Auth distinct sur le Webhook.
5. Activer, puis envoyer `{"url":"https://example.com/article"}` en JSON à l’URL de production avec le header choisi.

Flux : Webhook → POST job → attente/poll GET job → GET fiche → réponse. Succès 200 ; erreur pipeline 422 ; traitement encore en cours après environ 90 secondes : 202 avec job à suivre. Timeout global de 120 secondes.

L’export ne contient pas de credential réel. Sa structure est validée ; activation et exécution dans n8n ne sont pas couvertes par les tests API.
