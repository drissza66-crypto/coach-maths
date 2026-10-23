import { Link } from 'react-router-dom';
import { Page } from '../components/ui';

export function Introuvable() {
  return (
    <Page title="Page introuvable">
      <p>Cette page n’existe pas.</p>
      <Link to="/">Revenir à l’accueil</Link>
    </Page>
  );
}
