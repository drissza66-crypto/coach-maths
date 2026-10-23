import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CHAPITRES,
  CHAPITRE_LABELS,
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  type Chapitre,
  type ContentDetail,
  type ContentSummary,
  type ContentType,
  type CourseDocument,
} from '@mathsuivi/shared';
import { api, errorMessage } from '../../api/client';
import { Alert, Field, useAsyncAction } from '../../components/ui';

const DEFAULT_COUNT: Record<ContentType, number> = { fiche: 1, quiz: 6, flashcards: 8 };

/** Fiches, quiz et cartes de la classe : génération par l'IA, puis relecture avant publication. */
export function ContenusClasse({ classId }: { classId: string }) {
  const id = useId();
  const navigate = useNavigate();
  const [contenus, setContenus] = useState<ContentSummary[] | null>(null);
  const [docs, setDocs] = useState<CourseDocument[]>([]);
  const [type, setType] = useState<ContentType>('quiz');
  const [source, setSource] = useState('');
  const [notion, setNotion] = useState('');
  const [chapitre, setChapitre] = useState<Chapitre | ''>('');
  const [nombre, setNombre] = useState(6);
  const [consignes, setConsignes] = useState('');
  const { busy, error, setError, run } = useAsyncAction();

  const load = useCallback(() => {
    api<ContentSummary[]>(`/contenus?classId=${classId}`)
      .then(setContenus)
      .catch((err) => setError(errorMessage(err)));
    api<CourseDocument[]>(`/documents?classId=${classId}`)
      .then(setDocs)
      .catch(() => undefined);
  }, [classId, setError]);
  useEffect(load, [load]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!source && notion.trim().length < 2) return setError('Choisissez un cours ou indiquez une notion.');
    run(async () => {
      const created = await api<ContentDetail>('/contenus/generer', 'POST', {
        classId,
        type,
        ...(source && { documentId: source }),
        ...(notion.trim() && { notion: notion.trim() }),
        ...(chapitre && { chapitre }),
        ...(type !== 'fiche' && { nombre }),
        ...(consignes.trim() && { consignes: consignes.trim() }),
      });
      navigate(`/formateur/contenus/${created.id}`);
    });
  };

  return (
    <section className="card" aria-labelledby={`${id}-titre`}>
      <h2 id={`${id}-titre`}>Révisions de la classe</h2>
      <p className="muted small">
        Le coach prépare une fiche, un quiz ou des cartes mémoire. Vous relisez et corrigez avant de publier : les
        apprentis ne voient que ce qui est publié.
      </p>
      <Alert kind="error">{error}</Alert>

      {contenus && contenus.length > 0 && (
        <ul className="member-list" style={{ marginBottom: '1rem' }}>
          {contenus.map((c) => (
            <li key={c.id} className="member">
              <Link to={`/formateur/contenus/${c.id}`} className="member-name" style={{ flex: '1 1 14rem' }}>
                {c.titre}
              </Link>
              <span className="member-meta small">
                <span className="muted">
                  {CONTENT_TYPE_LABELS[c.type]} · {c.nbElements} élément{c.nbElements > 1 ? 's' : ''}
                </span>
                {c.publie ? <span className="badge badge-ok">Publié</span> : <span className="badge badge-wait">Brouillon</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <details open={contenus?.length === 0}>
        <summary>Générer une révision</summary>
        <form onSubmit={submit} noValidate>
          <fieldset>
            <legend className="legend">Type</legend>
            <div className="row">
              {CONTENT_TYPES.map((t) => (
                <label key={t} className="choice">
                  <input
                    type="radio"
                    name={`${id}-type`}
                    checked={type === t}
                    onChange={() => {
                      setType(t);
                      setNombre(DEFAULT_COUNT[t]);
                    }}
                  />
                  {CONTENT_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <label htmlFor={`${id}-source`}>À partir de</label>
            <select id={`${id}-source`} className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Une notion (sans cours)</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  Cours : {d.titre}
                </option>
              ))}
            </select>
          </div>

          <Field
            label={source ? 'Notion précise (facultatif)' : 'Notion'}
            hint="Exemple : aire du rectangle, règle de trois, pente en %"
            value={notion}
            onChange={(e) => setNotion(e.target.value)}
            maxLength={80}
          />

          <div className="field">
            <label htmlFor={`${id}-chapitre`}>Chapitre (facultatif)</label>
            <select id={`${id}-chapitre`} className="input" value={chapitre} onChange={(e) => setChapitre(e.target.value as Chapitre | '')}>
              <option value="">Détecter automatiquement</option>
              {CHAPITRES.map((c) => (
                <option key={c} value={c}>
                  {CHAPITRE_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          {type !== 'fiche' && (
            <Field
              label={type === 'quiz' ? 'Nombre de questions' : 'Nombre de cartes'}
              type="number"
              min={3}
              max={15}
              value={nombre}
              onChange={(e) => setNombre(Math.min(15, Math.max(3, Number(e.target.value) || 3)))}
            />
          )}

          <Field
            label="Consignes pour le coach (facultatif)"
            hint="Exemple : niveau facile, exemples de plomberie"
            value={consignes}
            onChange={(e) => setConsignes(e.target.value)}
            maxLength={500}
          />

          <button className="btn" disabled={busy}>
            {busy ? 'Préparation en cours…' : 'Générer'}
          </button>
          {busy && (
            <p role="status" className="small muted">
              Le coach rédige… cela peut prendre jusqu’à une minute.
            </p>
          )}
        </form>
      </details>
    </section>
  );
}
