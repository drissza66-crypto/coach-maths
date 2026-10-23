import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  METIER_LABELS,
  NIVEAU_LABELS,
  formatClassCode,
  type ClassMember,
  type FormateurClassDetail,
} from '@mathsuivi/shared';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Field, Page, formatDate, useAsyncAction } from '../../components/ui';
import { ClassForm } from './ClassForm';

type Act = <T>(action: () => Promise<T>, success?: ReactNode | ((result: T) => ReactNode)) => Promise<void>;

export function ClasseDetail() {
  const { id } = useParams<{ id: string }>();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [cls, setCls] = useState<FormateurClassDetail | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [error, setError] = useState('');
  const projection = useRef<HTMLDialogElement>(null);
  const messages = useRef<HTMLDivElement>(null);

  // Les boutons sont souvent loin du message (mobile) : on l'amène à l'écran et on y place le focus.
  useEffect(() => {
    if (!notice && !error) return;
    messages.current?.scrollIntoView({ block: 'center' });
    messages.current?.focus({ preventScroll: true });
  }, [notice, error]);

  const load = useCallback(() => {
    api<FormateurClassDetail>(`/classes/${id}`)
      .then(setCls)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);
  useEffect(load, [load]);

  /** Exécute une action, affiche son résultat ou son erreur en haut de page. */
  const act: Act = async (action, success) => {
    setError('');
    setNotice(null);
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'apprentis' in result) setCls(result as unknown as FormateurClassDetail);
      else load();
      if (success) setNotice(typeof success === 'function' ? success(result) : success);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!cls) {
    return (
      <Page title="Classe">
        {error ? <Alert kind="error">{error}</Alert> : <p role="status">Chargement…</p>}
        <Link to="/formateur">← Mes classes</Link>
      </Page>
    );
  }

  const code = formatClassCode(cls.code);

  return (
    <Page title={cls.nom}>
      <p>
        <Link to="/formateur">← Mes classes</Link>
      </p>
      <p className="muted">
        {METIER_LABELS[cls.metier]} · {NIVEAU_LABELS[cls.niveau]}
        {cls.archivee && (
          <>
            {' '}
            · <span className="badge badge-wait">Archivée</span>
          </>
        )}
      </p>

      <div ref={messages} tabIndex={-1}>
        <Alert kind="error">{error}</Alert>
        <Alert kind="success">{notice}</Alert>
      </div>

      <section className="card" aria-labelledby="code-titre">
        <h2 id="code-titre">Code classe</h2>
        {cls.archivee ? (
          <p>Classe archivée : les apprentis ne peuvent plus se connecter.</p>
        ) : (
          <>
            <p className="code-display">{code}</p>
            <p className="muted small">
              Les apprentis vont sur <strong>{window.location.host}</strong>, choisissent « Je suis apprenti » et
              tapent ce code.
            </p>
            <div className="row">
              <button className="btn" onClick={() => projection.current?.showModal()}>
                Afficher en grand
              </button>
              <button
                className="btn btn-secondary"
                onClick={() =>
                  window.confirm('Créer un nouveau code ? L’ancien ne marchera plus pour se connecter.') &&
                  act(() => api(`/classes/${cls.id}/code`, 'POST'), 'Nouveau code créé.')
                }
              >
                Nouveau code
              </button>
            </div>
          </>
        )}
      </section>

      <dialog ref={projection} aria-labelledby="projection-titre">
        <h2 id="projection-titre">Code de la classe {cls.nom}</h2>
        <p className="projection-code">{code}</p>
        <p style={{ textAlign: 'center' }}>
          {window.location.host} → « Je suis apprenti »
        </p>
        <form method="dialog" style={{ textAlign: 'center' }}>
          <button className="btn">Fermer</button>
        </form>
      </dialog>

      <section className="card" aria-labelledby="apprentis-titre">
        <h2 id="apprentis-titre">Apprentis ({cls.apprentis.length})</h2>
        {cls.apprentis.length === 0 ? (
          <p>Aucun apprenti pour l’instant. Donnez le code classe à vos apprentis pour qu’ils créent leur compte.</p>
        ) : (
          <ul className="member-list">
            {cls.apprentis.map((a) => (
              <MemberRow key={a.id} member={a} classId={cls.id} act={act} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <details>
          <summary>Modifier la classe</summary>
          <ClassForm
            initial={{ nom: cls.nom, metier: cls.metier, niveau: cls.niveau }}
            submitLabel="Enregistrer"
            onSubmit={async (values) => {
              await act(async () => {
                const updated = await api<FormateurClassDetail>(`/classes/${cls.id}`, 'PATCH', values);
                await refresh();
                return updated;
              }, 'Classe enregistrée.');
            }}
          />
        </details>
      </section>

      <section className="card">
        <h2>Fin d’année</h2>
        <p className="muted small">
          Archiver bloque les connexions mais garde les comptes. Supprimer efface la classe et les comptes de ses
          apprentis.
        </p>
        <div className="row">
          <button
            className="btn btn-secondary"
            onClick={() =>
              act(
                () => api(`/classes/${cls.id}`, 'PATCH', { archivee: !cls.archivee }),
                cls.archivee ? 'Classe réactivée.' : 'Classe archivée.',
              )
            }
          >
            {cls.archivee ? 'Réactiver la classe' : 'Archiver la classe'}
          </button>
        </div>
        <DeleteClass
          nbApprentis={cls.apprentis.length}
          onDelete={async () => {
            await api(`/classes/${cls.id}`, 'DELETE', { confirmation: 'SUPPRIMER' });
            await refresh();
            navigate('/formateur', { replace: true });
          }}
        />
      </section>
    </Page>
  );
}

function MemberRow({
  member: a,
  classId,
  act,
}: {
  member: ClassMember;
  classId: string;
  act: Act;
}) {
  const base = `/classes/${classId}/apprentis/${a.id}`;
  return (
    <li className="member">
      <span className="member-name">{a.pseudo}</span>
      <span className="member-meta small">
        <span className="muted">Dernière visite : {formatDate(a.derniereVisite)}</span>
        {a.tuteurIaAutorise ? (
          <span className="badge badge-ok">Tuteur IA autorisé</span>
        ) : a.moinsDe15Ans ? (
          <span className="badge badge-wait">Moins de 15 ans : accord parental attendu</span>
        ) : (
          <span className="badge badge-wait">Tuteur IA refusé</span>
        )}
        {a.bloque && <span className="badge badge-ko">Bloqué (trop d’essais)</span>}
        {a.doitChangerPin && <span className="badge badge-wait">Code provisoire</span>}
      </span>
      <span className="member-actions">
        <button
          className="btn btn-secondary btn-small"
          onClick={() =>
            act(
              () => api<{ pinTemporaire: string }>(`${base}/pin`, 'POST'),
              ({ pinTemporaire }) => <PinNotice pseudo={a.pseudo} pin={pinTemporaire} />,
            )
          }
        >
          Nouveau code secret<span className="visually-hidden"> pour {a.pseudo}</span>
        </button>
        {a.moinsDe15Ans && (
          <button
            className="btn btn-secondary btn-small"
            onClick={() =>
              act(
                () => api(`${base}/accord-parental`, 'POST', { accord: !a.tuteurIaAutorise }),
                a.tuteurIaAutorise
                  ? `Accord parental retiré pour ${a.pseudo}.`
                  : `Accord parental enregistré pour ${a.pseudo}.`,
              )
            }
          >
            {a.tuteurIaAutorise ? 'Retirer l’accord parental' : 'Accord parental reçu'}
            <span className="visually-hidden"> pour {a.pseudo}</span>
          </button>
        )}
        <button
          className="btn btn-danger btn-small"
          onClick={() =>
            window.confirm(`Supprimer le compte de ${a.pseudo} et toutes ses données ? C’est définitif.`) &&
            act(() => api(base, 'DELETE'), `Compte de ${a.pseudo} supprimé.`)
          }
        >
          Supprimer<span className="visually-hidden"> {a.pseudo}</span>
        </button>
      </span>
    </li>
  );
}

function PinNotice({ pseudo, pin }: { pseudo: string; pin: string }) {
  return (
    <>
      <p>
        Code provisoire pour <strong>{pseudo}</strong> :{' '}
        <span className="code-display">{`${pin.slice(0, 3)} ${pin.slice(3)}`}</span>
      </p>
      <p>Donnez-le à l’apprenti. Il devra choisir son propre code à la connexion. Ce code ne sera plus affiché.</p>
    </>
  );
}

function DeleteClass({ nbApprentis, onDelete }: { nbApprentis: number; onDelete(): Promise<void> }) {
  const [confirmation, setConfirmation] = useState('');
  const { busy, error, run } = useAsyncAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(onDelete);
  };
  return (
    <details style={{ marginTop: '1rem' }}>
      <summary>Supprimer la classe</summary>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        <p>
          Cela supprime définitivement la classe et les comptes de ses {nbApprentis} apprenti
          {nbApprentis > 1 ? 's' : ''}.
        </p>
        <Field
          label="Écrivez SUPPRIMER pour confirmer"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          autoComplete="off"
        />
        <button className="btn btn-danger" disabled={busy || confirmation !== 'SUPPRIMER'}>
          Supprimer définitivement
        </button>
      </form>
    </details>
  );
}
