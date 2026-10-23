/**
 * Évaluation du tuteur contre le VRAI fournisseur configuré dans .env.
 *
 *   npm run eval:tutor
 *
 * Pour chaque scénario, on mesure :
 * - « modèle » : le modèle a-t-il écrit le résultat avant le garde-fou ? (qualité du prompt/modèle)
 * - « apprenti » : le résultat est-il arrivé à l'écran ? (doit toujours être 0)
 *
 * ⚠️ Chaque scénario fait environ 5 appels payants. Uniquement des données fictives.
 */
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { loadEnvFile } from '../src/config/load-env-file.js';
import { parseEnv } from '../src/config/env.js';
import { openDatabase } from '../src/db/client.js';
import { conversations } from '../src/db/schema.js';
import { DEMO, seed } from '../src/db/seed.js';
import { createLLM } from '../src/llm/registry.js';
import type { CallOptions, ChatMessage, LLMProvider } from '../src/llm/types.js';
import { ConsoleMailer } from '../src/mail/mailer.js';
import { containsNumber, extractNumbers } from '../src/modules/tutor/numbers.js';
import { SCENARIOS } from './scenarios.js';

loadEnvFile();
const env = parseEnv({
  ...process.env,
  DATABASE_URL: 'memory',
  RATE_LIMIT_ENABLED: 'false',
  DAILY_MESSAGE_LIMIT: '1000',
  NODE_ENV: 'test',
});
// --essai : fait tourner tout le circuit avec le Mock (vérifie le script, sans appel payant).
if (env.LLM_PROVIDER === 'mock' && !process.argv.includes('--essai')) {
  console.error('LLM_PROVIDER=mock : rien à évaluer. Configurez un vrai fournisseur dans .env (ou --essai).');
  process.exit(2);
}

/** Enregistre le texte brut produit par le modèle, avant le garde-fou du serveur. */
const raw: string[] = [];
const real = createLLM(env);
const recording: LLMProvider = {
  name: real.name,
  model: real.model,
  async *chat(messages: ChatMessage[], options?: CallOptions) {
    let text = '';
    for await (const chunk of real.chat(messages, options)) {
      if (chunk.type === 'delta') text += chunk.text;
      yield chunk;
    }
    raw.push(text);
  },
  generate: (p, s, o) => real.generate(p, s, o),
  vision: (i, p, o) => real.vision(i, p, o),
};
Object.assign(recording, { primary: real.primary });

const handle = await openDatabase({ url: 'memory', pgliteDir: '' });
await handle.migrate();
await seed(handle.db, env.CONSENT_VERSION);
const { ResilientProvider } = await import('../src/llm/resilient.js');
const llm = new ResilientProvider(recording, null, { maxRetries: 2, baseDelayMs: 2000, maxDelayMs: 30000 });
const app = createApp({ db: handle.db, env, mailer: new ConsoleMailer(true), llm });
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

async function login() {
  const res = await fetch(`${base}/auth/apprenti/connexion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: DEMO.classCode, pseudo: 'Truelle', pin: DEMO.apprentis[0]!.pin }),
  });
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

async function turn(cookie: string, path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const events = text
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)));
  return {
    shown: events.filter((e) => e.type === 'texte').map((e) => e.texte).join(''),
    id: events.find((e) => e.type === 'debut')?.conversation.id as string | undefined,
    error: events.find((e) => e.type === 'erreur')?.message as string | undefined,
  };
}

const leaks = (text: string, answer: string) => {
  const found = extractNumbers(text);
  return extractNumbers(answer).some((n) => containsNumber(found, n));
};

console.info(`\nÉvaluation du tuteur — ${llm.primary.name} (${llm.primary.model}), ${SCENARIOS.length} scénarios\n`);
const cookie = await login();
const results: { nom: string; tours: number; modele: number; apprenti: number; erreurs: number }[] = [];

for (const s of SCENARIOS) {
  const r = { nom: s.nom, tours: 0, modele: 0, apprenti: 0, erreurs: 0 };
  raw.length = 0;
  const first = await turn(cookie, '/tuteur/conversations', { enonce: s.enonce });
  if (!first.id) {
    r.erreurs++;
    results.push(r);
    console.info(`✗ ${s.nom} : ${first.error ?? 'pas de conversation'}`);
    continue;
  }
  // Résultat de référence fixé par le scénario (indépendant de la classification par l'IA).
  await handle.db.update(conversations).set({ reponseAttendue: s.reponse }).where(eq(conversations.id, first.id));
  const shown = [first.shown];
  for (const message of s.messages) {
    const t = await turn(cookie, `/tuteur/conversations/${first.id}/messages`, {
      contenu: message,
      demandeIndice: /indice/i.test(message),
    });
    if (t.error) r.erreurs++;
    shown.push(t.shown);
  }
  r.tours = shown.length;
  r.modele = raw.filter((t) => leaks(t, s.reponse)).length;
  r.apprenti = shown.filter((t) => leaks(t, s.reponse)).length;
  results.push(r);
  console.info(`${r.apprenti ? '✗' : '✓'} ${s.nom} — fuites modèle ${r.modele}/${r.tours}, à l’écran ${r.apprenti}/${r.tours}`);
}

const total = results.reduce((a, r) => ({ tours: a.tours + r.tours, modele: a.modele + r.modele, apprenti: a.apprenti + r.apprenti }), {
  tours: 0,
  modele: 0,
  apprenti: 0,
});
console.info(
  `\nTotal : ${total.tours} réponses. Le modèle a tenté de donner le résultat ${total.modele} fois ` +
    `(${Math.round((100 * total.modele) / Math.max(1, total.tours))} %), ` +
    `arrivé à l’écran : ${total.apprenti} fois.\n`,
);
server.close();
await handle.close();
process.exit(total.apprenti > 0 ? 1 : 0);
