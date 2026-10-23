import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Me } from '@mathsuivi/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Field, Page, useAsyncAction } from '../components/ui';

export function MesDonnees() {
  const { me } = useAuth();
  if (!me) return null;
  const apprenti = me.role === 'apprenti';

  return (
    <Page title={apprenti ? 'Mes données' : 'Mon compte'}>
      {!apprenti && <Profil me={me} />}

      <section className="card" aria-labelledby="ce-qu-on-garde">
        <h2 id="ce-qu-on-garde">Ce que Coach Maths garde sur {apprenti ? 'toi' : 'vous'}</h2>
        {apprenti ? (
          <ul>
            <li>Ton pseudo, ta classe et ton niveau.</li>
            <li>Ton code secret, sous une forme illisible (personne ne peut le lire).</li>
            <li>Tes accords (règles d’utilisation, tuteur IA).</li>
            <li>La date de ta dernière visite.</li>
          </ul>
        ) : (
          <ul>
            <li>Votre adresse e-mail et votre nom affiché.</li>
            <li>Vos classes et la date de votre dernière visite.</li>
          </ul>
        )}
        <p className="muted small">Pas de publicité. Pas de pistage. Pas de revente.</p>
        <Export />
      </section>

      {apprenti && <ConsentementIa me={me} />}
      <Suppression apprenti={apprenti} />
    </Page>
  );
}

function Profil({ me }: { me: Me }) {
  const { setMe } = useAuth();
  const [pseudo, setPseudo] = useState(me.pseudo);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAsyncAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    run(async () => {
      setMe(await api<Me>('/me', 'PATCH', { pseudo }));
      setSaved(true);
    });
  };
  return (
    <section className="card" aria-labelledby="profil">
      <h2 id="profil">Profil</h2>
      <p className="muted">E-mail : {me.email}</p>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        <Alert kind="success">{saved && 'Nom enregistré.'}</Alert>
        <Field label="Nom affiché" value={pseudo} onChange={(e) => setPseudo(e.target.value)} maxLength={40} />
        <button className="btn btn-secondary" disabled={busy || pseudo.trim().length < 2}>
          Enregistrer
        </button>
      </form>
    </section>
  );
}

function Export() {
  const { busy, error, run } = useAsyncAction();
  const download = () =>
    run(async () => {
      const data = await api<unknown>('/me/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mes-donnees-coach-maths.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  return (
    <>
      <Alert kind="error">{error}</Alert>
      <button className="btn btn-secondary" onClick={download} disabled={busy}>
        Télécharger mes données
      </button>
    </>
  );
}

function ConsentementIa({ me }: { me: Me }) {
  const { setMe } = useAuth();
  const { busy, error, run } = useAsyncAction();
  const toggle = () =>
    run(async () => setMe(await api<Me>('/me/consentements', 'POST', { type: 'ia_tuteur', accord: !me.tuteurIaAutorise })));

  return (
    <section className="card" aria-labelledby="tuteur-ia">
      <h2 id="tuteur-ia">Tuteur IA</h2>
      <Alert kind="error">{error}</Alert>
      <p>
        Le tuteur IA t’aide pas à pas sur tes exercices. Tes messages sont envoyés à un service d’intelligence
        artificielle, puis effacés après un temps limité.
      </p>
      <p>
        État :{' '}
        {me.tuteurIaAutorise ? (
          <span className="badge badge-ok">Activé</span>
        ) : (
          <span className="badge badge-wait">Désactivé</span>
        )}
      </p>
      {me.moinsDe15Ans && !me.tuteurIaAutorise ? (
        <p className="muted">Tu as moins de 15 ans : il faut l’accord de tes parents. Ton formateur s’en occupe.</p>
      ) : (
        <button className="btn btn-secondary" onClick={toggle} disabled={busy}>
          {me.tuteurIaAutorise ? 'Désactiver le tuteur IA' : 'Activer le tuteur IA'}
        </button>
      )}
    </section>
  );
}

function Suppression({ apprenti }: { apprenti: boolean }) {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState('');
  const { busy, error, run } = useAsyncAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/me', 'DELETE', { confirmation });
      setMe(null);
      navigate('/', { replace: true });
    });
  };
  return (
    <section className="card" aria-labelledby="supprimer">
      <h2 id="supprimer">Supprimer {apprenti ? 'mon' : 'votre'} compte</h2>
      <p>
        {apprenti
          ? 'Tout sera effacé : ton compte, tes accords, ton travail. C’est définitif.'
          : 'Supprimez d’abord vos classes. Ensuite, votre compte sera effacé définitivement.'}
      </p>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        <Field
          label="Écris SUPPRIMER pour confirmer"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          autoComplete="off"
        />
        <button className="btn btn-danger" disabled={busy || confirmation !== 'SUPPRIMER'}>
          Supprimer définitivement
        </button>
      </form>
    </section>
  );
}
