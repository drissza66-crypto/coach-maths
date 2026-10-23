import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CHAPITRE_LABELS,
  CONTENT_TYPE_LABELS,
  type ContentDetail,
  type Fiche,
  type Flashcards,
  type Quiz,
} from '@mathsuivi/shared';
import { api, errorMessage } from '../../api/client';
import { FicheView, FlashcardsPreview, QuizPreview } from '../../components/contenus';
import { Alert, Field, Page, useAsyncAction } from '../../components/ui';

/** Relecture d'un contenu généré : renommer, retirer des éléments, publier. */
export function ContenuFormateur() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [contenu, setContenu] = useState<ContentDetail | null>(null);
  const [titre, setTitre] = useState('');
  const [notice, setNotice] = useState('');
  const { busy, error, setError, run } = useAsyncAction();

  useEffect(() => {
    api<ContentDetail>(`/contenus/${id}`)
      .then((c) => {
        setContenu(c);
        setTitre(c.titre);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [id, setError]);

  if (!contenu) {
    return (
      <Page title="Révision">
        {error ? <Alert kind="error">{error}</Alert> : <p role="status">Chargement…</p>}
        <Link to="/formateur">← Mes classes</Link>
      </Page>
    );
  }

  const save = (patch: { titre?: string; body?: unknown }, message: string) =>
    run(async () => {
      setContenu(await api<ContentDetail>(`/contenus/${contenu.id}`, 'PATCH', patch));
      setNotice(message);
    });

  const removeItem = (index: number) => {
    if (contenu.type === 'quiz') {
      const quiz = contenu.body as Quiz;
      if (quiz.questions.length <= 1) return setError('Un quiz doit garder au moins une question.');
      save({ body: { ...quiz, questions: quiz.questions.filter((_, i) => i !== index) } }, 'Question retirée.');
    } else if (contenu.type === 'flashcards') {
      const cards = contenu.body as Flashcards;
      if (cards.cartes.length <= 1) return setError('Il faut garder au moins une carte.');
      save({ body: { ...cards, cartes: cards.cartes.filter((_, i) => i !== index) } }, 'Carte retirée.');
    }
  };

  return (
    <Page title={contenu.titre}>
      <p>
        <button className="link-button" onClick={() => navigate(-1)}>
          ← Retour à la classe
        </button>
      </p>
      <p className="muted">
        {CONTENT_TYPE_LABELS[contenu.type]}
        {contenu.chapitre && ` · ${CHAPITRE_LABELS[contenu.chapitre]}`}
        {contenu.source && ` · d’après « ${contenu.source} »`}{' '}
        {contenu.publie ? <span className="badge badge-ok">Publié</span> : <span className="badge badge-wait">Brouillon</span>}
      </p>

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{notice}</Alert>

      {!contenu.publie && (
        <Alert kind="info">
          <p>
            <strong>Relisez avant de publier.</strong> L’IA peut se tromper dans un calcul : vérifiez chaque bonne
            réponse. Retirez ce qui ne convient pas.
          </p>
        </Alert>
      )}

      <section className="card">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            save({ titre }, 'Titre enregistré.');
          }}
        >
          <div style={{ flex: '1 1 16rem' }}>
            <Field label="Titre" value={titre} onChange={(e) => setTitre(e.target.value)} maxLength={80} />
          </div>
          <button className="btn btn-secondary" disabled={busy || titre.trim().length < 2 || titre === contenu.titre}>
            Renommer
          </button>
        </form>
        <div className="row">
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const updated = await api<ContentDetail>(`/contenus/${contenu.id}/publication`, 'POST', { publie: !contenu.publie });
                setContenu(updated);
                setNotice(updated.publie ? 'Publié : les apprentis de la classe le voient dans « Réviser ».' : 'Retiré des révisions des apprentis.');
              })
            }
          >
            {contenu.publie ? 'Dépublier' : 'Publier pour la classe'}
          </button>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() =>
              window.confirm('Supprimer ce contenu ? Les résultats des apprentis seront aussi supprimés.') &&
              run(async () => {
                await api(`/contenus/${contenu.id}`, 'DELETE');
                navigate(-1);
              })
            }
          >
            Supprimer
          </button>
        </div>
      </section>

      <h2>Contenu</h2>
      {contenu.type === 'fiche' && <FicheView fiche={contenu.body as Fiche} />}
      {contenu.type === 'quiz' && <QuizPreview quiz={contenu.body as Quiz} onRemove={busy ? undefined : removeItem} />}
      {contenu.type === 'flashcards' && (
        <FlashcardsPreview cartes={(contenu.body as Flashcards).cartes} onRemove={busy ? undefined : removeItem} />
      )}
    </Page>
  );
}
