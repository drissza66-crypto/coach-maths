# Déployer Coach Maths

Une seule application Node.js : l'API sert aussi l'interface. Il lui faut un PostgreSQL,
un serveur SMTP, un dossier pour les fichiers importés (chiffrés) et un proxy HTTPS devant.

## Pilote sur un PC du CFA (réseau local, sans HTTPS)

Pour quelques apprentis, l'application peut tourner sur le PC du formateur, sans Docker
ni e-mail :

```bash
NODE_ENV=development
APP_URL=http://NOM-DU-PC.local:3001       # nom Windows du PC (echo %COMPUTERNAME%)
WEB_DIST_DIR=C:/chemin/vers/mathsuivi-tuteur/apps/web/dist
MAIL_TRANSPORT=console                    # le lien formateur s'affiche dans le terminal
FORMATEUR_ALLOWED_DOMAINS=votre-cfa.fr
```

```bash
npm run build
npm run start -w @mathsuivi/api
```

- Les apprentis ouvrent `http://NOM-DU-PC.local:3001` (le nom ne change pas quand l'IP
  change). Si leur appareil ne résout pas les noms `.local`, l'IP du moment marche aussi :
  hors production, toute adresse qui mène au serveur lui-même (nom `.local`, IP, localhost)
  est acceptée, un nom de domaine ordinaire non.
- Ouvrir le port 3001 dans le pare-feu Windows (en administrateur) :
  `New-NetFirewallRule -DisplayName "Coach Maths" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow`
- Base embarquée (PGlite) : sauvegarder le dossier `PGLITE_DATA_DIR` serveur arrêté.
- **Données hors d'`AppData`** (`PGLITE_DATA_DIR`, `FILES_DIR`), par exemple
  `C:/Users/<vous>/CoachMaths-donnees/…`. Un programme lancé depuis une application
  « empaquetée » (Microsoft Store, application Claude…) écrit dans `AppData` via un dossier
  privé : selon qui lance le serveur, on obtient deux bases différentes.
- **PC branché sur secteur pendant les séances.** Sur batterie, Windows éteint l'écran au bout
  de quelques minutes, se met en veille et coupe le Wi-Fi : les apprentis voient « Coach Maths
  ne répond pas ». Sinon : Paramètres → Système → Alimentation → écran et veille « Jamais ».
- Lancer le serveur dans un terminal qui reste ouvert pendant toute la séance.

Le reste de ce guide concerne un déploiement complet sur serveur.

## 1. Avant de commencer

- **Hébergement dans l'UE** (Scaleway, OVH, Clever Cloud…), PostgreSQL 14 ou plus récent.
- **Fournisseur d'IA** dont le contrat interdit l'entraînement sur les données et garantit
  un traitement dans l'UE. Les offres gratuites (Groq, Gemini gratuit…) servent seulement
  aux tests avec des données fictives.
- **SMTP** : celui du CFA ou un service d'envoi transactionnel (Brevo, Mailjet, Scaleway TEM).
  Sans e-mail, aucun formateur ne peut se connecter.
- **Textes d'information et consentements** validés par le CFA, responsable du traitement.

## 2. Configuration

Copier `.env.example` en `.env.production` (jamais versionné) et régler au minimum :

```bash
NODE_ENV=production
COOKIE_SECURE=true
APP_URL=https://coach-maths.votre-cfa.fr
DATABASE_URL=postgres://mathsuivi:MOT_DE_PASSE@hote:5432/mathsuivi
MAIL_TRANSPORT=smtp
SMTP_URL=smtps://utilisateur:motdepasse@smtp.exemple.fr:465
MAIL_FROM=Coach Maths <coach-maths@votre-cfa.fr>
FORMATEUR_ALLOWED_DOMAINS=votre-cfa.fr
FILE_ENCRYPTION_KEY=…      # openssl rand -base64 32
FILES_DIR=/data/files
LLM_PROVIDER=…
LLM_MODEL=…
LLM_API_KEY=…
```

**Le serveur refuse de démarrer** s'il manque l'un de ces réglages (base embarquée, adresse
sans HTTPS, e-mails en console, aucun domaine formateur, pas de clé de chiffrement, IA de
démonstration) et affiche la liste de ce qui manque. Au démarrage, il vérifie aussi que le
serveur SMTP répond (`[mail] serveur SMTP joignable.`) et applique les migrations de la base.

## 3. Lancer

**Avec Docker** (PostgreSQL et application sur la même machine) :

```bash
export POSTGRES_PASSWORD="$(openssl rand -base64 24)"   # à conserver
docker compose --profile app up -d --build
docker compose logs -f app
```

L'application écoute sur `127.0.0.1:3001`, les fichiers sont dans le volume `files`.

**Sans Docker** (Node.js 24) :

```bash
npm ci
npm run build                       # construit apps/web/dist
npm ci --omit=dev -w @mathsuivi/api -w @mathsuivi/shared
NODE_ENV=production node --import tsx apps/api/src/server.ts
```

(les variables de `.env.production` sont à fournir par le gestionnaire de service, par
exemple `EnvironmentFile=` dans systemd).

## 4. HTTPS

Mettre un proxy devant le port 3001. Exemple Caddy, certificat automatique :

```
coach-maths.votre-cfa.fr {
    reverse_proxy 127.0.0.1:3001
}
```

Le streaming du tuteur passe par SSE : avec nginx, ajouter `proxy_buffering off;` sur `/api/`.
L'application fait confiance à un seul proxy (`trust proxy = 1`) pour l'adresse IP.

## 5. Sauvegardes

Trois choses à sauvegarder, **la clé à part des deux autres** :

| Quoi | Comment | Pourquoi |
|---|---|---|
| Base PostgreSQL | `pg_dump -Fc` chaque nuit | comptes, classes, contenus, progrès |
| Dossier `FILES_DIR` | copie du dossier (ou du volume `files`) | cours importés, chiffrés |
| `FILE_ENCRYPTION_KEY` | coffre de mots de passe du CFA | sans elle, les fichiers sont illisibles |

```bash
# Base (Docker)
docker compose exec -T postgres pg_dump -U mathsuivi -Fc mathsuivi > mathsuivi-$(date +%F).dump
# Fichiers (Docker)
docker run --rm -v mathsuivi-tuteur_files:/data -v "$PWD":/backup alpine \
  tar czf /backup/fichiers-$(date +%F).tgz -C /data .
```

Garder les sauvegardes au plus 30 jours : au-delà, elles contiendraient des données que
l'application a déjà effacées (cours importés, conversations, comptes supprimés).

**Restaurer** (à tester une fois avant l'ouverture) :

```bash
docker compose exec -T postgres pg_restore -U mathsuivi -d mathsuivi --clean --if-exists < mathsuivi-AAAA-MM-JJ.dump
```

## 6. Surveillance

- `GET /api/sante` répond `{"ok":true}` : à brancher sur une sonde (Uptime Kuma, UptimeRobot…).
  L'image Docker l'utilise déjà comme `HEALTHCHECK`.
- Les logs ne contiennent aucun message d'apprenti. À surveiller :
  `[mail] envoi du lien impossible`, `[mail] ⚠️ serveur SMTP injoignable`,
  `[purge] échec`, `[api] erreur inattendue`.
- Le journal des appels à l'IA (table `llm_calls`, sans contenu) donne les erreurs de
  quota et les replis vers le fournisseur de secours.

## 7. Vérifier sur un vrai PostgreSQL

Les tests de l'API peuvent tourner sur le serveur cible (le compte doit pouvoir créer des
bases : chaque test crée la sienne puis la supprime) :

```bash
docker compose up -d postgres
TEST_DATABASE_URL=postgres://mathsuivi:mathsuivi@localhost:5432/postgres npm test -w @mathsuivi/api
```

## 8. Mettre à jour

```bash
git pull
docker compose --profile app up -d --build
```

Les migrations s'appliquent au démarrage. Faire une sauvegarde de la base juste avant.
