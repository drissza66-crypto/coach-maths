import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { Fiche, Flashcards, Quiz, QuizCorrection, QuizForApprenti } from '@mathsuivi/shared';
import { api, errorMessage } from '../api/client';
import { Alert } from './ui';

const LETTRES = ['A', 'B', 'C', 'D'];

export function FicheView({ fiche }: { fiche: Fiche }) {
  return (
    <article className="fiche">
      <p className="fiche-resume">{fiche.resume}</p>
      {fiche.formule && (
        <p className="fiche-formule">
          <span className="visually-hidden">Formule : </span>
          {fiche.formule}
        </p>
      )}
      <h2>Points clés</h2>
      <ul>
        {fiche.points_cles.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      <h2>Exemple sur le chantier</h2>
      <div className="card">
        <p>
          <strong>{fiche.exemple_btp.enonce}</strong>
        </p>
        <ol>
          {fiche.exemple_btp.etapes.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ol>
        <p>
          Résultat : <strong>{fiche.exemple_btp.resultat}</strong>
        </p>
      </div>
      <h2>Attention aux erreurs</h2>
      <ul>
        {fiche.erreurs_frequentes.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      <p className="alert alert-success">
        <strong>À retenir : </strong>
        {fiche.a_retenir}
      </p>
    </article>
  );
}

/** Cartes mémoire, une à la fois : la réponse s'affiche à la demande. */
export function FlashcardsPlayer({ cartes }: { cartes: Flashcards['cartes'] }) {
  const [order, setOrder] = useState(() => cartes.map((_, i) => i));
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const carte = cartes[order[index]!]!;

  const go = (delta: number) => {
    setIndex((i) => (i + delta + cartes.length) % cartes.length);
    setShown(false);
  };

  return (
    <div className="flashcards">
      <p className="muted" aria-live="polite">
        Carte {index + 1} sur {cartes.length}
      </p>
      <div className="flashcard">
        <p className="flashcard-recto">{carte.recto}</p>
        <div aria-live="polite">
          {shown && (
            <p className="flashcard-verso">
              <span className="visually-hidden">Réponse : </span>
              {carte.verso}
            </p>
          )}
        </div>
      </div>
      <div className="row">
        <button className="btn" onClick={() => setShown((s) => !s)} aria-expanded={shown}>
          {shown ? 'Cacher la réponse' : 'Voir la réponse'}
        </button>
        <button className="btn btn-secondary" onClick={() => go(-1)}>
          ← Précédente
        </button>
        <button className="btn btn-secondary" onClick={() => go(1)}>
          Suivante →
        </button>
        <button
          className="link-button"
          onClick={() => {
            setOrder((o) => [...o].sort(() => Math.random() - 0.5));
            setIndex(0);
            setShown(false);
          }}
        >
          Mélanger les cartes
        </button>
      </div>
    </div>
  );
}

function ChoiceLine({ text, index, state }: { text: string; index: number; state?: 'juste' | 'faux' | 'bonne' }) {
  return (
    <>
      <span className="choice-letter" aria-hidden="true">
        {LETTRES[index]}
      </span>
      <span>{text}</span>
      {state === 'juste' && <span className="badge badge-ok">✓ Ta réponse est juste</span>}
      {state === 'faux' && <span className="badge badge-ko">✗ Ta réponse</span>}
      {state === 'bonne' && <span className="badge badge-ok">✓ Bonne réponse</span>}
    </>
  );
}

/** Quiz de l'apprenti : réponses envoyées au serveur, qui corrige et explique. */
export function QuizPlayer({ id, quiz }: { id: string; quiz: QuizForApprenti }) {
  const formId = useId();
  const [reponses, setReponses] = useState<number[]>(() => quiz.questions.map(() => -1));
  const [debut, setDebut] = useState(() => Date.now());
  const [correction, setCorrection] = useState<QuizCorrection | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const manquantes = reponses.filter((r) => r === -1).length;

  // Après correction : on amène le score à l'écran et le lecteur d'écran l'annonce.
  useEffect(() => {
    if (!correction) return;
    const result = document.getElementById(`${formId}-resultat`);
    result?.scrollIntoView({ block: 'center' });
    result?.focus({ preventScroll: true });
  }, [correction, formId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<QuizCorrection>(`/revisions/${id}/tentatives`, 'POST', {
        reponses,
        dureeSecondes: Math.round((Date.now() - debut) / 1000),
      });
      setCorrection(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (correction) {
    return (
      <div>
        <div id={`${formId}-resultat`} tabIndex={-1} className="alert alert-success" role="status">
          <p>
            <strong>
              Score : {correction.score} / {correction.total}
            </strong>
            {correction.score === correction.total ? ' — Parfait, bravo !' : correction.score >= correction.total / 2 ? ' — Bien joué, continue !' : ' — Relis les explications, puis réessaie.'}
          </p>
        </div>
        <ol className="quiz">
          {correction.questions.map((q, i) => (
            <li key={i} className="card">
              <p className="quiz-enonce">{q.enonce}</p>
              <ul className="quiz-choix">
                {q.choix.map((c, j) => (
                  <li key={j} className={j === q.bonne_reponse ? 'choix-bon' : j === q.reponse ? 'choix-faux' : ''}>
                    <ChoiceLine
                      text={c}
                      index={j}
                      state={j === q.reponse && q.correct ? 'juste' : j === q.reponse ? 'faux' : j === q.bonne_reponse ? 'bonne' : undefined}
                    />
                  </li>
                ))}
              </ul>
              {q.reponse === -1 && <p className="muted small">Pas de réponse.</p>}
              {!q.correct && <p className="quiz-explication">{q.explication}</p>}
            </li>
          ))}
        </ol>
        <button
          className="btn"
          onClick={() => {
            setCorrection(null);
            setReponses(quiz.questions.map(() => -1));
            setDebut(Date.now());
          }}
        >
          Recommencer le quiz
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <ol className="quiz">
        {quiz.questions.map((q, i) => (
          <li key={i} className="card">
            <fieldset>
              <legend className="quiz-enonce">{q.enonce}</legend>
              {q.choix.map((c, j) => (
                <label key={j} className="choice quiz-option">
                  <input
                    type="radio"
                    name={`${formId}-q${i}`}
                    checked={reponses[i] === j}
                    onChange={() => setReponses((r) => r.map((v, k) => (k === i ? j : v)))}
                  />
                  <ChoiceLine text={c} index={j} />
                </label>
              ))}
            </fieldset>
          </li>
        ))}
      </ol>
      <Alert kind="error">{error}</Alert>
      {manquantes > 0 && (
        <p className="muted small">
          {manquantes} question{manquantes > 1 ? 's' : ''} sans réponse.
        </p>
      )}
      <button className="btn" disabled={busy}>
        {busy ? 'Correction…' : 'Valider mes réponses'}
      </button>
    </form>
  );
}

/** Aperçu formateur d'un quiz : bonnes réponses visibles, question retirable. */
export function QuizPreview({ quiz, onRemove }: { quiz: Quiz; onRemove?(index: number): void }) {
  return (
    <ol className="quiz">
      {quiz.questions.map((q, i) => (
        <li key={i} className="card">
          <p className="quiz-enonce">{q.enonce}</p>
          <ul className="quiz-choix">
            {q.choix.map((c, j) => (
              <li key={j} className={j === q.bonne_reponse ? 'choix-bon' : ''}>
                <ChoiceLine text={c} index={j} state={j === q.bonne_reponse ? 'bonne' : undefined} />
              </li>
            ))}
          </ul>
          <p className="quiz-explication">{q.explication}</p>
          {onRemove && <RemoveButton label={`la question ${i + 1}`} onClick={() => onRemove(i)} />}
        </li>
      ))}
    </ol>
  );
}

export function FlashcardsPreview({ cartes, onRemove }: { cartes: Flashcards['cartes']; onRemove?(index: number): void }) {
  return (
    <ol className="quiz">
      {cartes.map((c, i) => (
        <li key={i} className="card">
          <p className="quiz-enonce">{c.recto}</p>
          <p>→ {c.verso}</p>
          {onRemove && <RemoveButton label={`la carte ${i + 1}`} onClick={() => onRemove(i)} />}
        </li>
      ))}
    </ol>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick(): void }): ReactNode {
  return (
    <button className="btn btn-danger btn-small" onClick={onClick}>
      Retirer<span className="visually-hidden"> {label}</span>
    </button>
  );
}
