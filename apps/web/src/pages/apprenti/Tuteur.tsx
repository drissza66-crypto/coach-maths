import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useMatch, useNavigate } from 'react-router-dom';
import {
  CHAPITRE_LABELS,
  ETAPES,
  ETAPE_LABELS,
  MAX_MESSAGE_LENGTH,
  type ConversationDetail,
  type ConversationSummary,
  type PhotoReadResult,
  type Quota,
  type TutorMessage,
  type TutorStreamEvent,
} from '@mathsuivi/shared';
import { api, apiUpload, errorMessage } from '../../api/client';
import { prepareImage } from '../../api/image';
import { postStream } from '../../api/stream';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Page, formatDate } from '../../components/ui';

export function Tuteur() {
  const { me } = useAuth();
  const id = useMatch('/apprenti/tuteur/:id')?.params.id;
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loadError, setLoadError] = useState('');

  const refreshQuota = useCallback(() => {
    api<Quota>('/tuteur/quota').then(setQuota).catch(() => undefined);
  }, []);
  useEffect(refreshQuota, [refreshQuota]);

  // Ne dépend que de l'adresse : une conversation qui démarre (sans changement de route)
  // ne doit surtout pas être effacée pendant que la réponse arrive.
  useEffect(() => {
    if (!id) return;
    setLoadError('');
    setDetail((d) => (d?.id === id ? d : null));
    api<ConversationDetail>(`/tuteur/conversations/${id}`)
      .then(setDetail)
      .catch((err) => setLoadError(errorMessage(err)));
  }, [id]);

  if (!me) return null;

  if (!me.tuteurIaAutorise) {
    return (
      <Page title="Je suis bloqué">
        <Alert kind="info">
          {me.moinsDe15Ans ? (
            <p>Le tuteur IA s’ouvrira quand ton formateur aura reçu l’accord de tes parents.</p>
          ) : (
            <p>
              Le tuteur IA n’est pas activé. Tu peux l’activer dans <Link to="/mes-donnees">Mes données</Link>.
            </p>
          )}
        </Alert>
      </Page>
    );
  }

  if (id && !detail) {
    return (
      <Page title="Mon exercice">
        {loadError ? <Alert kind="error">{loadError}</Alert> : <p role="status">Chargement…</p>}
        <Link to="/apprenti/tuteur">← Nouvel exercice</Link>
      </Page>
    );
  }

  return (
    <Chat
      key={id ?? 'new'}
      detail={detail}
      quota={quota}
      onQuota={setQuota}
      onStarted={(conv) => {
        setDetail({ ...conv, notion: null, messages: [] });
        // Passer par le routeur recréerait la page et couperait la réponse en cours :
        // on met seulement l'adresse à jour (lien partageable, rechargement possible).
        window.history.replaceState(window.history.state, '', `/apprenti/tuteur/${conv.id}`);
      }}
      onDetail={setDetail}
      onNew={() => {
        setDetail(null);
        navigate('/apprenti/tuteur');
      }}
    />
  );
}

/** Retire les marques de gras Markdown que certains modèles ajoutent. */
const clean = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '');

function Bubble({ message, streaming }: { message: Pick<TutorMessage, 'auteur' | 'contenu'>; streaming?: boolean }) {
  const mine = message.auteur === 'apprenti';
  return (
    <li className={`bubble ${mine ? 'bubble-me' : 'bubble-coach'}`} aria-busy={streaming || undefined}>
      <span className="bubble-author">{mine ? 'Toi' : 'Coach'}</span>
      <div className="bubble-text">{clean(message.contenu)}</div>
    </li>
  );
}

function Stepper({ etape, niveauIndice, resolue }: { etape: ConversationDetail['etape']; niveauIndice: number; resolue: boolean }) {
  const current = ETAPES.indexOf(etape);
  const state = (e: (typeof ETAPES)[number], i: number) => {
    if (i === current) return 'current';
    // Un indice n'est « fait » que s'il a été demandé : on peut trouver sans indice.
    if (e === 'indice1') return niveauIndice >= 1 ? 'done' : '';
    if (e === 'indice2') return niveauIndice >= 2 ? 'done' : '';
    return i < current || resolue ? 'done' : '';
  };
  return (
    <ol className="stepper" aria-label="Étapes de l’exercice">
      {ETAPES.map((e, i) => (
        <li key={e} className={state(e, i)} aria-current={i === current ? 'step' : undefined}>
          {ETAPE_LABELS[e]}
          {state(e, i) === 'done' && <span className="visually-hidden"> (fait)</span>}
        </li>
      ))}
    </ol>
  );
}

interface ChatProps {
  detail: ConversationDetail | null;
  quota: Quota | null;
  onQuota(q: Quota): void;
  onStarted(conv: ConversationSummary): void;
  onDetail(d: ConversationDetail): void;
  onNew(): void;
}

function Chat({ detail, quota, onQuota, onStarted, onDetail, onNew }: ChatProps) {
  const inputId = useId();
  const [text, setText] = useState('');
  const [streamText, setStreamText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry?: { texte: string; indice: boolean } } | null>(null);
  const [announce, setAnnounce] = useState('');
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const current = useRef(detail);
  current.current = detail;
  const photoInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [photoNotice, setPhotoNotice] = useState('');

  /** Photo → texte de l'énoncé, que l'apprenti vérifie avant de commencer. */
  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setPhotoNotice('');
    setReading(true);
    try {
      const form = new FormData();
      form.append('photo', await prepareImage(file), 'enonce.jpg');
      const result = await apiUpload<PhotoReadResult>('/tuteur/photo', form);
      setText(result.texte);
      onQuota(result.quota);
      setPhotoNotice('Voici ce que j’ai lu. Vérifie le texte, corrige-le si besoin, puis appuie sur « Commencer ».');
      input.current?.focus();
    } catch (err) {
      setError({ message: errorMessage(err) });
    } finally {
      setReading(false);
    }
  }

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [detail?.messages.length, streamText, pending]);

  useEffect(() => () => abort.current?.abort(), []);

  // « Nouvel exercice » depuis une conversation commencée ici : on repart d'une page propre.
  useEffect(() => {
    if (!detail && !abort.current) {
      setError(null);
      setText('');
      setAnnounce('');
    }
  }, [detail]);

  async function send(texte: string, indice = false) {
    const trimmed = texte.trim();
    if (!trimmed || busy) return;
    setError(null);
    setBusy(true);
    setPending(trimmed);
    setText('');
    setStreamText('');
    setAnnounce('');
    const controller = new AbortController();
    abort.current = controller;

    const conv = current.current;
    const path = conv ? `/tuteur/conversations/${conv.id}/messages` : '/tuteur/conversations';
    const body = conv ? { contenu: trimmed, demandeIndice: indice } : { enonce: trimmed };
    let failed: string | null = null;

    try {
      await postStream(
        path,
        body,
        (event: TutorStreamEvent) => {
          if (event.type === 'debut') onStarted(event.conversation);
          else if (event.type === 'texte') setStreamText((t) => t + event.texte);
          else if (event.type === 'fin') {
            const base = current.current;
            if (!base) return;
            onDetail({
              ...base,
              etape: event.etape,
              niveauIndice: event.niveauIndice,
              resolue: event.resolue,
              messages: [...base.messages, event.messageApprenti, event.message],
            });
            onQuota(event.quota);
            setAnnounce(`Coach : ${clean(event.message.contenu)}`);
          } else if (event.type === 'erreur') failed = event.message;
        },
        controller.signal,
      );
    } catch (err) {
      failed = controller.signal.aborted ? 'Réponse arrêtée.' : errorMessage(err);
    }

    setStreamText('');
    setPending(null);
    setBusy(false);
    abort.current = null;
    if (failed) {
      // Le message n'est pas perdu : il revient dans la zone de saisie.
      setText(trimmed);
      setError({ message: failed, retry: controller.signal.aborted ? undefined : { texte: trimmed, indice } });
    }
    input.current?.focus();
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(text);
    }
  };

  const noQuota = quota !== null && quota.restants === 0;
  const title = detail ? 'Mon exercice' : 'Je suis bloqué';

  return (
    <Page title={title}>
      {detail && (
        <p>
          <button type="button" className="link-button" onClick={onNew} disabled={busy}>
            + Nouvel exercice
          </button>
        </p>
      )}

      {detail && (
        <section className="card exercise" aria-labelledby="enonce-titre">
          <h2 id="enonce-titre" className="small muted">
            Ton exercice {detail.chapitre && <span className="badge badge-wait">{CHAPITRE_LABELS[detail.chapitre]}</span>}
            {detail.resolue && <span className="badge badge-ok"> Trouvé !</span>}
          </h2>
          <p className="exercise-text">{detail.enonce}</p>
          <Stepper etape={detail.etape} niveauIndice={detail.niveauIndice} resolue={detail.resolue} />
        </section>
      )}

      {!detail && (
        <>
          <p>
            Prends ton exercice en photo, ou recopie-le. Le coach ne te donne pas la réponse : il t’aide à la trouver,
            pas à pas.
          </p>
          <div className="row" style={{ marginBottom: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => photoInput.current?.click()} disabled={reading || busy}>
              <span aria-hidden="true">📷</span> {reading ? 'Lecture de la photo…' : 'Prendre l’exercice en photo'}
            </button>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={onPhoto}
            />
          </div>
          {reading && <p role="status">Je lis ta photo…</p>}
          <Alert kind="info">{photoNotice}</Alert>
          <p className="muted small">
            Cadre seulement l’exercice. Pas de nom, d’adresse ou de téléphone. La photo n’est pas gardée.
          </p>
        </>
      )}

      {(detail?.messages.length || pending) && (
        <ol className="chat" aria-label="Conversation avec le coach">
          {detail?.messages.map((m) => <Bubble key={m.id} message={m} />)}
          {pending && <Bubble message={{ auteur: 'apprenti', contenu: pending }} />}
          {busy && (
            <Bubble message={{ auteur: 'tuteur', contenu: streamText || '…' }} streaming />
          )}
        </ol>
      )}
      <div ref={bottom} />

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {busy ? 'Le coach écrit…' : announce}
      </div>

      {error && (
        <Alert kind="error">
          <p>{error.message}</p>
          {error.retry && (
            <button className="btn btn-secondary btn-small" onClick={() => send(error.retry!.texte, error.retry!.indice)}>
              Réessayer
            </button>
          )}
        </Alert>
      )}

      {noQuota ? (
        <Alert kind="info">
          <p>Tu as utilisé tes {quota.limite} messages d’aujourd’hui. Bravo pour ton travail ! Reviens demain.</p>
        </Alert>
      ) : (
        <form className="composer" onSubmit={submit}>
          <label htmlFor={inputId} className={detail ? 'visually-hidden' : undefined}>
            {detail ? 'Ton message' : 'Ton exercice'}
          </label>
          <textarea
            id={inputId}
            ref={input}
            className="input"
            rows={detail ? 2 : 5}
            maxLength={MAX_MESSAGE_LENGTH}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={detail ? 'Écris ta réponse ou ta question…' : 'Exemple : Une pièce mesure 4,5 m sur 3,2 m…'}
            aria-describedby={`${inputId}-hint`}
          />
          <span id={`${inputId}-hint`} className="hint">
            Entrée pour envoyer, Maj + Entrée pour aller à la ligne.
            {quota && ` ${quota.restants} message${quota.restants > 1 ? 's' : ''} restant${quota.restants > 1 ? 's' : ''} aujourd’hui.`}
          </span>
          <div className="row">
            {busy ? (
              <button type="button" className="btn btn-secondary" onClick={() => abort.current?.abort()}>
                Arrêter
              </button>
            ) : (
              <button className="btn" disabled={!text.trim()}>
                {detail ? 'Envoyer' : 'Commencer'}
              </button>
            )}
            {detail && !detail.resolue && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || detail.niveauIndice >= 2}
                onClick={() => send(`Je voudrais un indice.${text.trim() ? ` ${text.trim()}` : ''}`, true)}
              >
                Un indice ({detail.niveauIndice}/2)
              </button>
            )}
          </div>
        </form>
      )}

      {!detail && <RecentConversations />}
    </Page>
  );
}

function RecentConversations() {
  const [list, setList] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<ConversationSummary[]>('/tuteur/conversations')
      .then(setList)
      .catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(load, [load]);

  if (!list?.length) return error ? <Alert kind="error">{error}</Alert> : null;
  return (
    <section aria-labelledby="recents" style={{ marginTop: '2rem' }}>
      <h2 id="recents">Mes exercices récents</h2>
      <p className="muted small">Effacés automatiquement après 30 jours sans activité.</p>
      <ul className="member-list">
        {list.map((c) => (
          <li key={c.id} className="member">
            <Link to={`/apprenti/tuteur/${c.id}`} className="member-name" style={{ flex: '1 1 16rem' }}>
              {c.enonce.length > 80 ? `${c.enonce.slice(0, 80)}…` : c.enonce}
            </Link>
            <span className="member-meta small">
              {c.chapitre && <span className="badge badge-wait">{CHAPITRE_LABELS[c.chapitre]}</span>}
              {c.resolue && <span className="badge badge-ok">Trouvé</span>}
              <span className="muted">{formatDate(c.misAJourLe)}</span>
            </span>
            <button
              className="btn btn-danger btn-small"
              onClick={async () => {
                if (!window.confirm('Effacer cet exercice et la conversation ?')) return;
                await api(`/tuteur/conversations/${c.id}`, 'DELETE').catch((err) => setError(errorMessage(err)));
                load();
              }}
            >
              Effacer<span className="visually-hidden"> cet exercice</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
