import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CHAPITRE_LABELS,
  MASTERY_RULE,
  PERIODES,
  type ClassDashboard,
  type FormateurClassDetail,
  type Periode,
} from '@mathsuivi/shared';
import { api, errorMessage } from '../../api/client';
import { Alert, Page, formatDate } from '../../components/ui';
import { MasteryBadge, Meter, StatTile, TableWrap, pct } from '../../components/stats';

/** Tableau de bord d'une classe : compteurs et taux, jamais le contenu des échanges. */
export function TableauDeBord() {
  const { id } = useParams<{ id: string }>();
  const [periode, setPeriode] = useState<Periode>(7);
  const [data, setData] = useState<ClassDashboard | null>(null);
  const [classe, setClasse] = useState<FormateurClassDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<FormateurClassDetail>(`/classes/${id}`)
      .then(setClasse)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  useEffect(() => {
    setError('');
    api<ClassDashboard>(`/tableau-de-bord/classes/${id}?periode=${periode}`)
      .then(setData)
      .catch((err) => setError(errorMessage(err)));
  }, [id, periode]);

  const r = data?.resume;
  const aRetravailler = data?.chapitres.filter((c) => c.statut === 'a_retravailler') ?? [];

  return (
    <Page title={classe ? `Tableau de bord — ${classe.nom}` : 'Tableau de bord'}>
      <p>
        <Link to={`/formateur/classes/${id}`}>← Retour à la classe</Link>
      </p>

      <div className="row" role="group" aria-label="Période">
        {PERIODES.map((p) => (
          <button
            key={p}
            className={`btn btn-small ${periode === p ? '' : 'btn-secondary'}`}
            aria-pressed={periode === p}
            onClick={() => setPeriode(p)}
          >
            {p} derniers jours
          </button>
        ))}
      </div>

      <Alert kind="error">{error}</Alert>
      {!data && !error && <p role="status">Chargement…</p>}

      {r && data && (
        <>
          <div className="stat-row" style={{ marginTop: '1rem' }}>
            <StatTile label="Apprentis actifs" value={`${r.actifs} / ${r.apprentis}`} detail={`venus ces ${data.periodeJours} jours`} />
            <StatTile
              label="Exercices avec le coach"
              value={r.exercices}
              detail={r.exercices ? `${r.exercicesResolus} trouvé${r.exercicesResolus > 1 ? 's' : ''} (${pct(r.exercicesResolus / r.exercices)})` : 'aucun'}
            />
            <StatTile label="Quiz passés" value={r.quizPasses} />
            <StatTile label="Réussite aux quiz" value={pct(r.moyenneQuiz)} detail="bonnes réponses" />
          </div>

          {aRetravailler.length > 0 && (
            <Alert kind="info">
              <p>
                <strong>À retravailler en classe : </strong>
                {aRetravailler.map((c) => CHAPITRE_LABELS[c.chapitre]).join(', ')}.
              </p>
            </Alert>
          )}

          <section className="card" aria-labelledby="notions">
            <h2 id="notions">Maîtrise par notion</h2>
            {data.chapitres.length === 0 ? (
              <p className="muted">Pas encore d’activité sur cette période.</p>
            ) : (
              <TableWrap label="Maîtrise par notion">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Notion</th>
                      <th scope="col">Maîtrise</th>
                      <th scope="col">Statut</th>
                      <th scope="col">Exercices trouvés</th>
                      <th scope="col">Indices / exercice</th>
                      <th scope="col">Réussite aux quiz</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.chapitres.map((c) => (
                      <tr key={c.chapitre}>
                        <th scope="row">{CHAPITRE_LABELS[c.chapitre]}</th>
                        <td>
                          <Meter value={c.maitrise} />
                        </td>
                        <td>
                          <MasteryBadge statut={c.statut} />
                        </td>
                        <td>{c.exercices ? `${c.resolus} / ${c.exercices}` : '—'}</td>
                        <td>{c.indicesMoyens === null ? '—' : c.indicesMoyens.toLocaleString('fr-FR')}</td>
                        <td>
                          {c.reponsesQuiz ? `${pct(c.reussiteQuiz)} (${c.reponsesQuiz} rép.)` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <details className="small">
              <summary>Comment est calculée la maîtrise ?</summary>
              <p>
                Bonnes réponses aux quiz + exercices trouvés avec le coach, divisés par le total. Un exercice trouvé
                après un indice compte un peu moins (−{MASTERY_RULE.penaliteIndice * 100} % par indice). Acquis à partir
                de {MASTERY_RULE.acquis * 100} %, en cours à partir de {MASTERY_RULE.enCours * 100} %. En dessous de{' '}
                {MASTERY_RULE.minElements} éléments, on ne conclut pas. Un exercice encore ouvert n’est pas compté.
              </p>
            </details>
          </section>

          <section className="card" aria-labelledby="apprentis">
            <h2 id="apprentis">Apprentis</h2>
            {data.apprentis.length === 0 ? (
              <p className="muted">Aucun apprenti dans cette classe.</p>
            ) : (
              <TableWrap label="Activité des apprentis">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Apprenti</th>
                      <th scope="col">Dernière visite</th>
                      <th scope="col">Exercices trouvés</th>
                      <th scope="col">Quiz</th>
                      <th scope="col">Demandes de réponse directe</th>
                      <th scope="col">À retravailler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.apprentis.map((a) => (
                      <tr key={a.id}>
                        <th scope="row">
                          <Link to={`/formateur/classes/${id}/apprentis/${a.id}`}>{a.pseudo}</Link>
                        </th>
                        <td>{formatDate(a.derniereVisite)}</td>
                        <td>{a.exercices ? `${a.resolus} / ${a.exercices}` : '—'}</td>
                        <td>{a.quizPasses ? `${a.quizPasses} · ${pct(a.moyenneQuiz)}` : '—'}</td>
                        <td>{a.demandesReponse || '—'}</td>
                        <td>
                          {a.aRetravailler.length
                            ? a.aRetravailler.map((c) => (
                                <span key={c} className="badge badge-ko" style={{ marginRight: '0.25rem' }}>
                                  {CHAPITRE_LABELS[c]}
                                </span>
                              ))
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <p className="muted small">
              Vous voyez des compteurs, jamais ce que les apprentis écrivent au coach. Les échanges sont effacés après
              30 jours.
            </p>
          </section>

          <section className="card" aria-labelledby="quiz-titre">
            <h2 id="quiz-titre">Quiz de la classe</h2>
            {data.quiz.length === 0 ? (
              <p className="muted">Aucun quiz. Générez-en un depuis la page de la classe.</p>
            ) : (
              <TableWrap label="Résultats des quiz">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Quiz</th>
                      <th scope="col">Statut</th>
                      <th scope="col">Participants</th>
                      <th scope="col">Réussite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.quiz.map((q) => (
                      <tr key={q.id}>
                        <th scope="row">
                          <Link to={`/formateur/contenus/${q.id}/resultats`}>{q.titre}</Link>
                        </th>
                        <td>{q.publie ? 'Publié' : 'Brouillon'}</td>
                        <td>{q.participants}</td>
                        <td>
                          <Meter value={q.moyenne} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </section>
        </>
      )}
    </Page>
  );
}
