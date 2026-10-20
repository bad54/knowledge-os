# Ajouter une source

1. Implémenter `SourceAdapter` : `canHandle`, `fetch`, `normalize`.
2. Injecter les clients réseau via `ContentFetcher` ou un nouveau port précis.
3. Produire un `RawContent` sérialisable puis un `NormalizedContent` avec texte, attribution, dates, identifiant externe et métadonnées de provenance.
4. Enregistrer l’adapter dans `createApplication`, avant l’adapter web générique.
5. Pour une nouvelle plateforme, étendre `sourceTypes`, migrer le catalogue `Source` et ajouter le sélecteur UI.
6. Tester fixtures, erreurs, limites et provenance sans services externes réels.

Le pipeline et les contrôleurs n’ont pas à connaître les détails de la nouvelle source.

## Sources incluses

- ManualText : texte et attribution ; permet un import Reddit/X conservant plateforme et URL.
- WebPage : HTML public statique via Readability ou texte brut. Aucun JavaScript distant ni sous-ressource chargé. Pas de navigateur headless.
- YouTube : transcription fournie et timestamps préservés. `YOUTUBE_API_KEY` permet les métadonnées officielles Data API v3. `YOUTUBE_ACCESS_TOKEN` doit disposer des droits OAuth du propriétaire/gestionnaire pour télécharger ses sous-titres (scope approprié, par exemple `youtube.force-ssl`). Une clé API seule n’ouvre pas les transcriptions de toutes les vidéos.
- `RestrictedPlatformAdapter('reddit' | 'x')` : reconnaissance et erreur explicite, contrat prêt pour une API officielle.

Reddit nécessitera une application OAuth avec client ID/secret et un accès autorisé. X nécessitera un projet développeur et un token pour une offre donnant accès aux posts/threads. Ces clients réseau ne sont pas implémentés ; aucun credential n’est demandé ni utilisé par les stubs. L’import manuel fonctionne sans ces accès.

PDF, RSS, GitHub et podcasts pourront suivre le même contrat. Pour du binaire, ajouter un port adapté sans forcer les fichiers dans le fetch HTML limité à 2 Mo.
