import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Page } from '../../components/ui';

const ACTIVITES = [
  { icon: '🆘', titre: 'Je suis bloqué', texte: 'Photographie ou écris ton exercice. Le coach t’aide pas à pas.' },
  { icon: '🃏', titre: 'Réviser', texte: 'Fiches, cartes mémoire et quiz de ta classe.' },
  { icon: '📈', titre: 'Mes progrès', texte: 'Ce que tu maîtrises et ce qu’il reste à travailler.' },
];

export function AccueilApprenti() {
  const { me } = useAuth();
  const message = (useLocation().state as { message?: string } | null)?.message;
  if (!me) return null;
  const classe = me.classes[0];

  return (
    <Page title={`Salut ${me.pseudo} !`}>
      <Alert kind="success">{message}</Alert>
      {classe && <p className="muted">Classe : {classe.nom}</p>}

      {!me.tuteurIaAutorise && (
        <Alert kind="info">
          {me.moinsDe15Ans ? (
            <p>Le tuteur IA s’ouvrira quand ton formateur aura reçu l’accord de tes parents.</p>
          ) : (
            <p>
              Le tuteur IA n’est pas activé. Tu peux l’activer dans <Link to="/mes-donnees">Mes données</Link>.
            </p>
          )}
        </Alert>
      )}

      <h2>Que veux-tu faire ?</h2>
      <ul className="grid" style={{ listStyle: 'none', padding: 0 }}>
        {ACTIVITES.map((a) => (
          <li key={a.titre}>
            <div className="choice-card" aria-disabled="true">
              <span className="icon" aria-hidden="true">
                {a.icon}
              </span>
              <strong>{a.titre}</strong>
              <span className="muted">{a.texte}</span>
              <p className="small" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
                <span className="badge badge-wait">Bientôt disponible</span>
              </p>
            </div>
          </li>
        ))}
      </ul>

      <p style={{ marginTop: '1.5rem' }}>
        <Link to="/apprenti/code">Changer mon code secret</Link>
      </p>
    </Page>
  );
}
