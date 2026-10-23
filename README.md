# Coach Maths — tuteur IA pour les CAP du BTP

Application web gratuite d'appui en mathématiques pour les apprentis de CAP
(maçonnerie, menuiserie, plomberie…). Le tuteur guide sans donner les réponses.

> **État : étapes 1 à 3 sur 7 — comptes et classes, couche fournisseur d'IA, chat tuteur.**
> L'import de documents (photo d'énoncé), les quiz et le suivi arrivent aux étapes suivantes.

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

Pour repartir de zéro : supprimer le dossier `PGLITE_DATA_DIR` puis relancer `npm run db:seed`.

> ⚠️ **OneDrive / Dropbox** : la synchronisation verrouille les fichiers de la base
> embarquée, qui ne démarre plus (« PGlite failed to initialize properly »). Placez
> `PGLITE_DATA_DIR` hors du dossier synchronisé, par exemple
> `C:/Users/<vous>/AppData/Local/mathsuivi-tuteur/pglite`.

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

## Fournisseur d'IA

Le fournisseur se choisit **uniquement** dans `.env`. Aucun nom de modèle n'est écrit
dans le code. Sans configuration, l'application tourne en **mode Mock** : réponses
de démonstration, aucune clé, aucune donnée envoyée.

| `LLM_PROVIDER` | Variables | Remarques |
|---|---|---|
| `mock` | aucune | Réponses socratiques prédéfinies ; `MOCK_FAIL` simule une panne |
| `mistral` | `LLM_MODEL`, `LLM_API_KEY` | Hébergé dans l'UE ; sorties JSON contraintes par schéma |
| `gemini` | `LLM_MODEL`, `LLM_API_KEY` | API Google AI Studio |
| `claude` | `LLM_MODEL` (ex. `claude-opus-5-5`), `LLM_API_KEY` | SDK officiel Anthropic ; repli serveur en cas de refus de sécurité |
| `openai-compatible` | `LLM_MODEL`, `LLM_BASE_URL`, `LLM_API_KEY` si besoin | Groq, OpenRouter, Ollama (`http://localhost:11434/v1`, sans clé)… |

Exemple :

```bash
LLM_PROVIDER=mistral
LLM_MODEL=nom-du-modele
LLM_API_KEY=…
LLM_FALLBACK_PROVIDER=gemini      # facultatif
LLM_FALLBACK_MODEL=nom-du-modele
LLM_FALLBACK_API_KEY=…
```

Au démarrage, l'API vérifie la configuration (modèle et clé obligatoires) et affiche
le fournisseur utilisé. Le formateur le voit aussi via `GET /api/llm/etat`.

**Architecture** (`apps/api/src/llm/`) :
- `types.ts` : l'interface unique `LLMProvider` (`chat` en streaming, `generate` validé
  par un schéma Zod, `vision`). Le reste de l'application ne connaît qu'elle.
- `providers/` : un adaptateur par fournisseur, plus le `MockProvider`.
- `resilient.ts` : réessai sur erreur passagère (attente croissante, `Retry-After`
  respecté), puis bascule sur le fournisseur de repli. Pendant un streaming, la
  bascule n'a lieu qu'avant le premier mot.
- `journal.ts` : une ligne par appel (fournisseur, modèle, statut, durée, jetons),
  **jamais le contenu**, effacée après `LLM_LOG_RETENTION_DAYS` ; limite quotidienne
  de messages par apprenti (`DAILY_MESSAGE_LIMIT`).
- `user-messages.ts` : messages clairs à l'apprenti en cas de panne ou de quota.
- `src/prompts/tutor.system.md` : le prompt système du tuteur, indépendant du fournisseur.

Ajouter un fournisseur : écrire l'adaptateur, l'ajouter à `registry.ts` et à la liste
`ADAPTERS` de `tests/llm/contract.test.ts`, puis faire passer les tests de contrat.

## Chat tuteur

Parcours de l'apprenti bloqué (`/apprenti/tuteur`) : il écrit son exercice, le coach
pose une question de compréhension, donne l'indice 1 puis l'indice 2 à la demande,
vérifie la démarche, puis propose un exercice similaire. Réponses en streaming (SSE).

**Le tuteur ne donne jamais la réponse finale.** Plusieurs couches, de la plus souple
à la plus stricte (`apps/api/src/modules/tutor/`) :

1. **Prompt système** (`src/prompts/tutor.system.md`) : règle absolue, guidage socratique.
2. **Consigne du tour** (`orchestrator.ts`) : l'étape, le niveau d'indice et la
   vérification de la réponse sont décidés par le serveur, pas par le modèle. À la
   création, l'exercice est classé (chapitre, notion) et son résultat calculé ; ce
   résultat reste sur le serveur et n'est jamais envoyé au modèle qui dialogue.
3. **Détection de triche et de contournement** (`cheat.ts`) : consigne de recadrage,
   compteur sans texte.
4. **`answerGuard`** (`answer-guard.ts`) : le flux est vérifié phrase par phrase ; une
   phrase contenant le résultat attendu est remplacée avant d'arriver à l'écran, tant que
   l'apprenti ne l'a pas trouvé lui-même. Limite connue : un résultat écrit en toutes
   lettres (« quatorze virgule quatre ») n'est pas repéré.

**Modération** (`moderation.ts`), avant tout envoi à l'IA :
- téléphone, e-mail et adresse sont masqués (ni envoyés, ni enregistrés) ;
- mal-être ou danger : réponse humaine fixe avec le 3114, le 119 et le 112, sans IA ;
- langage inadapté : rappel bienveillant, sans IA.

**Tests** : `npm test` vérifie avec un faux fournisseur « tricheur » que le résultat
n'arrive jamais à l'écran (découpé en morceaux, écrit à l'anglaise, etc.).
`npm run eval:tutor` rejoue 10 scénarios d'apprentis qui insistent ou contournent les
règles contre le **vrai** fournisseur de `.env`. Il mesure le taux de tentatives du
modèle et vérifie que rien n'arrive à l'écran (≈ 40 appels payants, données fictives).
`npm run eval:tutor -- --essai` vérifie le script en mode Mock.

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
