import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CHAPITRE_LABELS, type QuizResults } from '@mathsuivi/shared';
import { api, errorMessage } from '../../api/client';
import { Alert, Page, formatDate } from '../../components/ui';
import { Meter, StatTile, TableWrap, pct } from '../../components/stats';

/** Résultats d'un quiz : les questions les moins réussies d'abord, avec l'erreur typique. */
export function ResultatsQuiz() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<QuizResults | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<QuizResults>(`/tableau-de-bord/quiz/${id}`)
      .then(setData)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  if (!data) {
    return (
      <Page title="Résultats du quiz">
        {error ? <Alert kind="error">{error}</Alert> : <p role="status">Chargement…</p>}
      </Page>
    );
  }

  const questions = [...data.questions].sort((a, b) => (a.reussite ?? 2) - (b.reussite ?? 2));

  return (
    <Page title={`Résultats — ${data.titre}`}>
      <p>
        <Link to={`/formateur/contenus/${data.id}`}>← Voir le quiz</Link>
      </p>
      {data.chapitre && <p className="muted">{CHAPITRE_LABELS[data.chapitre]}</p>}

      <div className="stat-row">
        <StatTile label="Participants" value={data.participants} />
        <StatTile label="Réussite moyenne" value={pct(data.moyenne)} />
      </div>

      {data.participants === 0 ? (
        <p>Aucun apprenti n’a encore passé ce quiz.</p>
      ) : (
        <>
          <section className="card" aria-labelledby="questions">
            <h2 id="questions">Questions, des moins réussies aux plus réussies</h2>
            <TableWrap label="Réussite par question">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">N°</th>
                    <th scope="col">Question</th>
                    <th scope="col">Réussite</th>
                    <th scope="col">Erreur la plus fréquente</th>
                    <th scope="col">Bonne réponse</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.map((q) => (
                    <tr key={q.index}>
                      <td>{q.index + 1}</td>
                      <th scope="row" className="cell-wrap">
                        {q.enonce}
                      </th>
                      <td>
                        <Meter value={q.reussite} />
                        <span className="small muted"> {q.reponses} rép.</span>
                      </td>
                      <td>{q.erreurFrequente ? `${q.erreurFrequente.choix} (${q.erreurFrequente.fois}×)` : '—'}</td>
                      <td>{q.bonneReponse}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </section>

          <section className="card" aria-labelledby="par-apprenti">
            <h2 id="par-apprenti">Par apprenti</h2>
            <TableWrap label="Scores par apprenti">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Apprenti</th>
                    <th scope="col">Meilleur score</th>
                    <th scope="col">Tentatives</th>
                    <th scope="col">Dernière tentative</th>
                  </tr>
                </thead>
                <tbody>
                  {data.apprentis.map((a) => (
                    <tr key={a.id}>
                      <th scope="row">{a.pseudo}</th>
                      <td>
                        {a.meilleurScore} / {a.total}
                      </td>
                      <td>{a.tentatives}</td>
                      <td>{formatDate(a.derniereTentative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </section>
        </>
      )}
    </Page>
  );
}
