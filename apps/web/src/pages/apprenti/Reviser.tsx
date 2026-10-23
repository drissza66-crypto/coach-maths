import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CHAPITRE_LABELS,
  CONTENT_TYPE_LABELS,
  type Fiche,
  type Flashcards,
  type QuizForApprenti,
  type RevisionDetail,
  type RevisionItem,
} from '@mathsuivi/shared';
import { api, errorMessage } from '../../api/client';
import { FicheView, FlashcardsPlayer, QuizPlayer } from '../../components/contenus';
import { Alert, Page } from '../../components/ui';

const ICONS = { fiche: '📄', quiz: '✅', flashcards: '🃏' } as const;

export function Reviser() {
  const [items, setItems] = useState<RevisionItem[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<RevisionItem[]>('/revisions')
      .then(setItems)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <Page title="Réviser">
      <Alert kind="error">{error}</Alert>
      {items === null && !error && <p role="status">Chargement…</p>}
      {items?.length === 0 && <p>Ton formateur n’a encore rien publié. Reviens bientôt !</p>}
      {items && items.length > 0 && (
        <ul className="grid" style={{ listStyle: 'none', padding: 0 }}>
          {items.map((r) => (
            <li key={r.id}>
              <Link to={`/apprenti/reviser/${r.id}`} className="choice-card">
                <span className="icon" aria-hidden="true">
                  {ICONS[r.type]}
                </span>
                <strong>{r.titre}</strong>
                <span className="muted">
                  {CONTENT_TYPE_LABELS[r.type]}
                  {r.chapitre && ` · ${CHAPITRE_LABELS[r.chapitre]}`}
                </span>
                {r.meilleurScore && (
                  <span className="small" style={{ display: 'block', marginTop: '0.4rem' }}>
                    <span className="badge badge-ok">
                      Meilleur score : {r.meilleurScore.score}/{r.meilleurScore.total}
                    </span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

export function Revision() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<RevisionDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<RevisionDetail>(`/revisions/${id}`)
      .then(setItem)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  if (!item) {
    return (
      <Page title="Réviser">
        {error ? <Alert kind="error">{error}</Alert> : <p role="status">Chargement…</p>}
        <Link to="/apprenti/reviser">← Toutes les révisions</Link>
      </Page>
    );
  }

  return (
    <Page title={item.titre}>
      <p>
        <Link to="/apprenti/reviser">← Toutes les révisions</Link>
      </p>
      <p className="muted">
        {CONTENT_TYPE_LABELS[item.type]}
        {item.chapitre && ` · ${CHAPITRE_LABELS[item.chapitre]}`}
      </p>
      {item.type === 'fiche' && <FicheView fiche={item.body as Fiche} />}
      {item.type === 'flashcards' && <FlashcardsPlayer cartes={(item.body as Flashcards).cartes} />}
      {item.type === 'quiz' && <QuizPlayer id={item.id} quiz={item.body as QuizForApprenti} />}
    </Page>
  );
}
