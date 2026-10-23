import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Alert, Field, Page, useAsyncAction } from '../../components/ui';

export function ConnexionFormateur() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<{ message: string; devLink?: string } | null>(null);
  const { busy, error, run } = useAsyncAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => setSent(await api('/auth/formateur/lien', 'POST', { email })));
  };

  if (sent) {
    const devPath = sent.devLink && new URL(sent.devLink).pathname + new URL(sent.devLink).hash;
    return (
      <Page title="Vérifiez vos e-mails" narrow>
        <Alert kind="success">
          <p>{sent.message}</p>
          <p>Le lien est valable 15 minutes et ne sert qu’une fois.</p>
        </Alert>
        {devPath && (
          <div className="card">
            <p className="small muted">
              Mode développement : l’e-mail n’est pas envoyé, il s’affiche dans le terminal de l’API.
            </p>
            <Link to={devPath}>Ouvrir le lien de connexion</Link>
          </div>
        )}
        <button className="link-button" onClick={() => setSent(null)}>
          Utiliser une autre adresse
        </button>
      </Page>
    );
  }

  return (
    <Page title="Connexion formateur" narrow>
      <p className="muted">Pas de mot de passe : vous recevez un lien de connexion par e-mail.</p>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        <Field
          label="Adresse e-mail professionnelle"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <button className="btn btn-block" disabled={busy || !email.includes('@')}>
          {busy ? 'Envoi…' : 'Recevoir mon lien'}
        </button>
      </form>
    </Page>
  );
}
