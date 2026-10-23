import { Link } from 'react-router-dom';
import { Page } from '../components/ui';

export function Accueil() {
  return (
    <Page title="Bienvenue sur Coach Maths">
      <p className="muted">Ton coach pour progresser en maths, avec des exemples du chantier.</p>
      <div className="choice-cards">
        <Link to="/apprenti/connexion" className="choice-card">
          <span className="icon" aria-hidden="true">
            🧱
          </span>
          <strong>Je suis apprenti</strong>
          <span className="muted">J’ai un code classe donné par mon formateur.</span>
        </Link>
        <Link to="/formateur/connexion" className="choice-card">
          <span className="icon" aria-hidden="true">
            📐
          </span>
          <strong>Je suis formateur</strong>
          <span className="muted">Connexion par lien envoyé par e-mail.</span>
        </Link>
      </div>
    </Page>
  );
}
