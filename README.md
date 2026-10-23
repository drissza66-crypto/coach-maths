# Coach Maths — tuteur IA pour les CAP du BTP

Application web gratuite d'appui en mathématiques pour les apprentis de CAP
(maçonnerie, menuiserie, plomberie…). Le tuteur guide sans donner les réponses.

> **État : les 7 étapes du MVP sont développées** — comptes et classes, couche fournisseur
> d'IA, chat tuteur, import de documents et OCR, fiches/quiz/cartes mémoire, tableau de bord
> formateur, suivi des progrès. Reste à faire : tests avec un vrai fournisseur d'IA et avec de
> vrais utilisateurs (voir « Critères d'acceptation » en fin de document).

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
`npm run eval:tutor -- --essai` vérifie le script en mode Mock ; `-- --detail` affiche chaque
réponse du tuteur pour juger la qualité pédagogique à la lecture. Une réponse manquante (panne,
quota) fait échouer l'évaluation : elle ne passe plus pour un succès.

**Affichage** : les modèles écrivent parfois du LaTeX ou du Markdown malgré la consigne
(`\( 4,5 \times 3,2 \)`, tableaux, `**gras**`). `plainText` (`packages/shared`) le transforme
en texte lisible, dans le chat et dans les contenus générés. `answerGuard` vérifie le texte
**tel qu'il sera affiché** : un résultat écrit `14{,}4` en LaTeX est bloqué comme `14,4`.

## Import de documents et OCR

**Photo d'énoncé (apprenti)** — bouton « Prendre l'exercice en photo » :
la photo est réduite et ré-encodée **dans le navigateur** (ce qui retire les métadonnées,
dont la position GPS), lue par le modèle de vision (`src/prompts/ocr.image.md`), puis
**oubliée** : elle n'est jamais écrite sur disque. Le texte lu (données personnelles
masquées) est placé dans la zone de saisie pour que l'apprenti le vérifie.

**Cours de la classe (formateur)** — page de la classe, section « Cours de la classe » :
- PDF avec texte (extraction avec `unpdf`) ou photo d'une page (OCR par le modèle de vision) ;
- type vérifié d'après les premiers octets du fichier, jamais d'après l'extension ;
- fichier chiffré sur disque en **AES-256-GCM** (`src/storage/encrypted-store.ts`),
  clé `FILE_ENCRYPTION_KEY`, **supprimé automatiquement après 30 jours** ;
- texte découpé en passages, indexé par la recherche plein texte française de
  PostgreSQL. **RAG** : à chaque message, le tuteur reçoit les passages les plus proches
  de l'exercice (`src/modules/documents/search.ts`).

Limites connues : un PDF scanné (images seules) est refusé, il faut importer des photos
des pages. En mode Mock, l'OCR renvoie toujours le même énoncé de démonstration.

## Fiches, quiz et cartes mémoire

Parcours du formateur (page de la classe, section « Révisions de la classe ») :
1. **Générer** une fiche de révision, un quiz (QCM) ou des cartes mémoire, à partir d'un
   cours importé (son texte est transmis à l'IA) ou d'une simple notion, avec des consignes
   facultatives (« niveau facile », « exemples de plomberie »…).
2. **Relire** le brouillon : bonnes réponses et explications visibles, renommer, retirer
   une question ou une carte. ⚠️ L'IA peut se tromper dans un calcul : tout est relu avant
   publication.
3. **Publier** pour la classe (ou dépublier).

Côté apprenti (« Réviser ») : la fiche, les cartes une à une (réponse à la demande),
le quiz. **Les bonnes réponses restent sur le serveur** : le quiz est corrigé côté serveur,
qui renvoie le score et une explication pour chaque erreur. Les résultats sont enregistrés
(pour le suivi des progrès) et figurent dans l'export « Mes données ».

Détails : sorties de l'IA validées par des schémas Zod (`packages/shared`), 4 choix
différents par question, choix mélangés (les modèles placent souvent la bonne réponse en
premier), typographie française, limite de `GENERATION_DAILY_LIMIT` générations par jour
et par formateur. Prompts : `src/prompts/generate.{fiche,quiz,flashcards}.md`. En mode
Mock, un contenu de démonstration réaliste (aires et carrelage, calculs vérifiés) est
utilisé.

## Tableau de bord formateur

Page de la classe → « Tableau de bord de la classe » (7 ou 30 derniers jours) :
- **Indicateurs** : apprentis actifs, exercices faits avec le coach (et trouvés), quiz passés,
  réussite moyenne aux quiz.
- **Maîtrise par notion**, de la plus fragile à la plus solide, avec un statut écrit
  (Acquis / En cours / À retravailler / Pas assez de données). Règle unique, dans
  `packages/shared` (`MASTERY_RULE`) : bonnes réponses aux quiz + exercices trouvés avec le
  coach (−20 % par indice), sur le total ; acquis ≥ 75 %, en cours ≥ 50 % ; moins de 3
  éléments → pas de conclusion. Un exercice ouvert depuis moins d'une heure n'est pas compté.
- **Apprentis** : dernière visite, exercices trouvés, quiz et moyenne, nombre de demandes de
  réponse directe, notions à retravailler.
- **Résultats d'un quiz** : réussite par question (les moins réussies d'abord), l'erreur la
  plus choisie (souvent l'erreur typique à reprendre en classe), scores par apprenti.

**Le formateur voit des compteurs et des taux, jamais ce que les apprentis écrivent au
coach.** Les signaux de mal-être détectés par la modération ne sont pas affichés : les
remonter à un adulte référent est une décision à prendre avec le CFA et son DPO.

## Suivi des progrès

**Apprenti** (« Mes progrès ») : temps passé, jours actifs, exercices et quiz des 7 derniers
jours ; maîtrise de chaque notion sur 90 jours (même règle que le tableau de bord), avec un
mot d'encouragement ; **erreurs à reprendre** (questions de quiz ratées et pas encore
réussies depuis, avec la bonne réponse et l'explication) ; temps passé par semaine.

**Formateur** : la même fiche pour chaque apprenti de sa classe, depuis le tableau de bord
(clic sur le pseudo). Toujours sans le contenu des échanges avec le coach.

**Temps passé** : une minute est comptée quand la page est visible et que l'apprenti a
interagi dans les 2 dernières minutes. Seul un total par jour est gardé (table
`activity_days`), effacé après `ACTIVITY_RETENTION_DAYS` (90 jours). Deux onglets ouverts ne
comptent pas double. Le temps des formateurs n'est pas suivi.

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
FILE_ENCRYPTION_KEY=…            # openssl rand -base64 32 — à sauvegarder à part
FILES_DIR=/var/lib/coach-maths/files
LLM_PROVIDER=…                   # fournisseur avec DPA, sans entraînement sur les données
LLM_MODEL=…
LLM_API_KEY=…
```

L'API applique les migrations au démarrage. L'interface (`apps/web/dist`) se sert
derrière le même domaine que l'API (proxy `/api`), pour que les cookies restent
« même site ». `docker-compose.yml` fournit un PostgreSQL local pour tester ce mode.

## Critères d'acceptation

| Critère | État |
|---|---|
| Changer de fournisseur d'IA en modifiant uniquement les variables d'environnement | ✅ `tests/llm/config.test.ts`, contrat commun des 4 adaptateurs (`tests/llm/contract.test.ts`) |
| L'application fonctionne entièrement en mode Mock, sans clé d'API | ✅ chat, photo d'énoncé, cours, génération, quiz, tableau de bord, suivi (tests « mode Mock ») |
| Le tuteur ne donne jamais la réponse finale (tests automatisés) | ✅ `tests/tutor/` avec un fournisseur « tricheur » ; ⏳ `npm run eval:tutor` à lancer avec le vrai fournisseur choisi |
| Import et génération de contenu fonctionnels | ✅ `tests/documents/`, `tests/contents/` ; ⏳ qualité des contenus à juger avec un vrai modèle |
| Données supprimables à la demande | ✅ compte, conversation, cours, classe ; export JSON ; purges automatiques |
| Testé avec au moins 2 apprentis et 1 formateur | ⏳ **à faire avec de vraies personnes**, sur données fictives, avec un fournisseur conforme |

Accessibilité : formulaires étiquetés, focus visible et déplacé à chaque page, annonces
pour les lecteurs d'écran (réponses du coach, scores), statuts jamais portés par la seule
couleur, cibles de 44 px, contrastes AA, mode sombre. Un audit WCAG 2.2 AA complet (outil
automatique + test avec un lecteur d'écran) reste à faire.
