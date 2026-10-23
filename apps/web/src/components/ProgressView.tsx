import { Link } from 'react-router-dom';
import { CHAPITRE_LABELS, type ApprentiProgress, type MasteryStatus } from '@mathsuivi/shared';
import { Alert, formatDate } from './ui';
import { MasteryBadge, Meter, StatTile, pct } from './stats';

/** 125 s → « 2 min » ; 3 900 s → « 1 h 05 ». */
export function duree(secondes: number) {
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

const semaineLabel = (iso: string) =>
  `Sem. du ${new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;

const ENCOURAGEMENT: Record<MasteryStatus, string> = {
  acquis: 'Bravo, c’est solide !',
  en_cours: 'Bien parti, continue à t’entraîner.',
  a_retravailler: 'À reprendre : une fiche ou le coach peuvent t’aider.',
  peu_de_donnees: 'Fais quelques exercices pour voir où tu en es.',
};

/**
 * Suivi d'un apprenti. `pourApprenti` : textes à la 2e personne et liens vers les révisions ;
 * sinon, fiche pour le formateur.
 */
export function ProgressView({ progress, pourApprenti }: { progress: ApprentiProgress; pourApprenti: boolean }) {
  const s = progress.semaine;
  const max = Math.max(1, ...progress.semaines.map((w) => w.secondes));
  const acquis = progress.chapitres.filter((c) => c.statut === 'acquis');

  return (
    <>
      <h2>Ces 7 derniers jours</h2>
      <div className="stat-row">
        <StatTile label="Temps passé" value={duree(s.secondes)} detail={`${s.joursActifs} jour${s.joursActifs > 1 ? 's' : ''} actif${s.joursActifs > 1 ? 's' : ''}`} />
        <StatTile label="Exercices avec le coach" value={s.exercices} detail={`${s.exercicesResolus} trouvé${s.exercicesResolus > 1 ? 's' : ''}`} />
        <StatTile label="Quiz" value={s.quiz} detail={s.quiz ? `${pct(s.moyenneQuiz)} de bonnes réponses` : undefined} />
      </div>

      {pourApprenti && acquis.length > 0 && (
        <Alert kind="success">
          <p>
            <strong>Tu maîtrises :</strong> {acquis.map((c) => CHAPITRE_LABELS[c.chapitre]).join(', ')}. Bravo !
          </p>
        </Alert>
      )}

      <section className="card" aria-labelledby="mes-notions">
        <h2 id="mes-notions">{pourApprenti ? 'Mes notions' : 'Notions'}</h2>
        {progress.chapitres.length === 0 ? (
          <p className="muted">
            {pourApprenti
              ? 'Pas encore de résultats. Fais un quiz ou un exercice avec le coach pour commencer.'
              : 'Pas encore d’activité sur les 90 derniers jours.'}
          </p>
        ) : (
          <ul className="member-list">
            {progress.chapitres.map((c) => (
              <li key={c.chapitre} className="member">
                <span className="member-name">{CHAPITRE_LABELS[c.chapitre]}</span>
                <span className="member-meta">
                  <Meter value={c.maitrise} />
                  <MasteryBadge statut={c.statut} />
                </span>
                {pourApprenti && <span className="small muted" style={{ flexBasis: '100%' }}>{ENCOURAGEMENT[c.statut]}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="a-revoir">
        <h2 id="a-revoir">{pourApprenti ? 'Mes erreurs à reprendre' : 'Erreurs à reprendre'}</h2>
        {progress.aRevoir.length === 0 ? (
          <p className="muted">
            {pourApprenti ? 'Rien à reprendre pour l’instant. Continue comme ça !' : 'Aucune question ratée en attente.'}
          </p>
        ) : (
          <ol className="quiz">
            {progress.aRevoir.map((q) => (
              <li key={q.enonce} className="card">
                <p className="quiz-enonce">{q.enonce}</p>
                <p>
                  Bonne réponse : <strong>{q.bonneReponse}</strong>
                </p>
                <p className="quiz-explication">{q.explication}</p>
                <p className="small muted">
                  {q.chapitre && `${CHAPITRE_LABELS[q.chapitre]} · `}ratée {q.fois} fois · dernière fois le {formatDate(q.derniere)}
                </p>
              </li>
            ))}
          </ol>
        )}
        {pourApprenti && progress.aRevoir.length > 0 && (
          <p>
            <Link to="/apprenti/reviser">Refaire un quiz</Link> · <Link to="/apprenti/tuteur">Demander au coach</Link>
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="temps">
        <h2 id="temps">Temps passé par semaine</h2>
        <ol className="week-bars">
          {progress.semaines.map((w) => (
            <li key={w.debut}>
              <span className="week-label">{semaineLabel(w.debut)}</span>
              <span className="meter week-meter" aria-hidden="true">
                <span className="meter-fill" style={{ width: `${(w.secondes / max) * 100}%` }} />
              </span>
              <span className="meter-value">{duree(w.secondes)}</span>
            </li>
          ))}
        </ol>
        <p className="small muted">
          Une minute est comptée quand la page est ouverte et utilisée. {pourApprenti ? 'Seul le total par jour est gardé.' : ''}
        </p>
      </section>
    </>
  );
}
