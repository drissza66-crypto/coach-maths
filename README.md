# Coach Maths — tuteur IA pour les CAP du BTP

Application web gratuite d'appui en mathématiques pour les apprentis de CAP
(maçonnerie, menuiserie, plomberie…). Le tuteur guide sans donner les réponses.

> **État : étape 1 sur 7 — authentification, comptes et classes.**
> Le tuteur IA, l'import de documents, les quiz et le suivi arrivent aux étapes suivantes.

## Démarrer en local

Prérequis : **Node.js 20.12 ou plus**. Docker et PostgreSQL ne sont **pas** nécessaires :
en développement, l'API utilise PostgreSQL embarqué ([PGlite](https://pglite.dev)).

```bash
npm install
cp .env.example .env
npm run db:seed     # données de démonstration fictives
npm run dev         # API sur :3001, interface sur http://localhost:5173
```

### Comptes de démonstration (fictifs)

| Rôle | Connexion |
|---|---|
| Formateur | `formateur@cfa-demo.test` : le lien de connexion s'affiche à l'écran et dans le terminal de l'API |
| Classe | « CAP Maçon 1 — Démo », code **DAL-LE7** |
| Apprentis | `Truelle` / `Niveau` / `Equerre` (moins de 15 ans) : codes PIN dans [`apps/api/src/db/seed.ts`](apps/api/src/db/seed.ts) |

Pour repartir de zéro : supprimer `apps/api/.data/` puis relancer `npm run db:seed`.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | API + interface en mode développement |
| `npm test` | Tests de l'API (base en mémoire, aucune configuration) |
| `npm run typecheck` | Vérification TypeScript de tout le projet |
| `npm run build` | Construction de l'interface (`apps/web/dist`) |
| `npm run db:generate` | Nouvelle migration SQL après modification de `schema.ts` |

## Structure

```
apps/api        Express + Drizzle ORM (PostgreSQL)
  src/config    variables d'environnement validées au démarrage
  src/db        schéma, migrations SQL, données de démo
  src/modules   auth (lien magique, code classe + PIN), classes, privacy (RGPD)
  src/jobs      purge automatique des données expirées
  tests/        tests d'intégration (supertest + PostgreSQL en mémoire)
apps/web        React + Vite, mobile d'abord, accessible
packages/shared schémas Zod et types partagés entre API et interface
```

## Connexion

- **Formateur** : lien magique par e-mail (valable 15 min, à usage unique, jeton
  placé après `#` pour ne pas apparaître dans les journaux). Seuls les domaines de
  `FORMATEUR_ALLOWED_DOMAINS` peuvent créer un compte.
- **Apprenti** : code classe + pseudo + code PIN à 6 chiffres. Pas d'e-mail demandé.
  - pseudo unique dans la classe (accents et majuscules ignorés) ;
  - PIN haché (scrypt), PIN trop simples refusés ;
  - **5 erreurs → compte bloqué 15 min** (protection contre la devinette du PIN) ;
  - PIN oublié : le formateur génère un code provisoire, à changer à la connexion.
- Sessions par cookie `httpOnly`, `SameSite=Lax`, `Secure` en production ;
  requêtes d'écriture venant d'un autre site refusées.

## Données personnelles (RGPD)

**En phase de test, utiliser uniquement des données fictives.**

- **Minimisation** : pseudo (pas de nom réel), pas de date de naissance (seulement
  « moins de 15 ans : oui/non »), e-mail uniquement pour les formateurs.
- **Consentement** : chaque accord est enregistré avec qui l'a donné, la version du
  texte (`CONSENT_VERSION`) et la date. En dessous de 15 ans, l'accord pour le
  tuteur IA doit venir des représentants légaux : le formateur l'enregistre après
  réception de l'accord écrit.
- **Droit d'accès** : « Mes données → Télécharger » (JSON, sans aucun secret).
- **Droit à l'effacement** : suppression du compte par l'apprenti, par le formateur,
  ou suppression d'une classe entière en fin d'année (comptes inclus). L'effacement
  est réel (cascade en base), pas un simple masquage.
- **Aucune publicité, aucun pistage**, aucune ressource tierce chargée par l'interface.

> ⚠️ **Avant d'accueillir de vrais apprentis (souvent mineurs)** :
> - faire valider la base légale et les textes d'information par le DPO du CFA ;
> - héberger en UE (Scaleway, OVH, Clever Cloud…) avec PostgreSQL managé ;
> - choisir un fournisseur d'IA dont le contrat **interdit l'entraînement sur les
>   données** et garantit un traitement dans l'UE (DPA signé). Les offres gratuites
>   de nombreux fournisseurs autorisent cet usage : elles sont réservées aux tests
>   avec des données fictives.

## Production

```bash
NODE_ENV=production
COOKIE_SECURE=true
DATABASE_URL=postgres://…
APP_URL=https://coach-maths.exemple.fr
MAIL_TRANSPORT=smtp
SMTP_URL=smtps://…
FORMATEUR_ALLOWED_DOMAINS=votre-cfa.fr
```

L'API applique les migrations au démarrage. L'interface (`apps/web/dist`) se sert
derrière le même domaine que l'API (proxy `/api`), pour que les cookies restent
« même site ». `docker-compose.yml` fournit un PostgreSQL local pour tester ce mode.
