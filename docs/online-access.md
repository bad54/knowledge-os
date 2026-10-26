# Accéder à Knowledge OS en ligne

Ouvrir **https://web-production-355c8.up.railway.app**.

L’accès aux connaissances est protégé par un jeton personnel :

1. Ouvrir le projet Railway https://railway.com/project/fbbbe6ed-d59c-41cf-be81-5232fd7ff3ff.
2. Choisir le service **api**, puis **Variables** dans l’environnement **production**.
3. Copier la valeur de **API_TOKEN** depuis Railway. Ne pas la coller dans une conversation ni dans le dépôt.
4. Revenir dans Knowledge OS. Dans le formulaire **Connexion privée** (ou via **Se connecter** en haut de page), coller le jeton dans **Clé d’accès privée**, puis cliquer **Ouvrir ma bibliothèque**.

Le jeton est un secret donnant accès à l’ensemble de la bibliothèque, comme un mot de passe. Il est gardé dans le sessionStorage du navigateur et envoyé par header Authorization sur HTTPS. Sans jeton valide, l’interface affiche **Votre bibliothèque est verrouillée** : cela ne signifie pas qu’elle est vide. Les assets de l’interface et le healthcheck sont publics ; les contenus restent inaccessibles. Le bouton **Verrouiller** efface le jeton de cet onglet et retire les fiches affichées. Fermer la session du navigateur retire aussi cette copie locale. Pour révoquer une clé partagée ou compromise, remplacer API_TOKEN dans Railway et redéployer l’API ; verrouiller un onglet ne révoque pas les autres sessions.

Les données sont hébergées sur les serveurs Railway, pas sur l’ordinateur de l’utilisateur. L’accès privé protège leur consultation ; il ne s’agit pas d’un chiffrement de bout en bout et aucune protection ne garantit un risque nul. La base et l’API utilisent le réseau privé Railway, sans domaine public ni proxy TCP ; seul le site expose une entrée HTTPS et transmet les appels API protégés.

Le fournisseur `local`, affiché **Analyse extractive**, est actif. « Local » désigne ici un traitement sur le serveur applicatif, sans appel à OpenAI ; cela ne décrit pas le lieu de stockage. Les captures manuelles et web, la provenance, les fiches, la déduplication et la recherche vectorielle fonctionnent. Pour utiliser OpenAI, configurer sa clé côté service api, choisir AI_PROVIDER=openai, puis réanalyser les fiches utiles. Cette activation transmet les contenus analysés au fournisseur OpenAI. Une clé OpenAI ne doit jamais être ajoutée au frontend.
