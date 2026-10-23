import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { METIER_LABELS, NIVEAU_LABELS, formatClassCode, type FormateurClass } from '@mathsuivi/shared';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Page } from '../../components/ui';
import { ClassForm } from './ClassForm';

export function Classes() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<FormateurClass[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api<FormateurClass[]>('/classes')
      .then(setClasses)
      .catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(load, [load]);

  const actives = classes?.filter((c) => !c.archivee) ?? [];
  const archivees = classes?.filter((c) => c.archivee) ?? [];

  return (
    <Page title="Mes classes">
      <p className="muted">Bonjour {me?.pseudo}.</p>
      <Alert kind="error">{error}</Alert>

      {creating ? (
        <section className="card" aria-labelledby="nouvelle-classe">
          <h2 id="nouvelle-classe">Nouvelle classe</h2>
          <ClassForm
            submitLabel="Créer la classe"
            onSubmit={async (values) => {
              const created = await api<FormateurClass>('/classes', 'POST', values);
              await refresh();
              navigate(`/formateur/classes/${created.id}`);
            }}
          />
          <button className="link-button" onClick={() => setCreating(false)}>
            Annuler
          </button>
        </section>
      ) : (
        <p>
          <button className="btn" onClick={() => setCreating(true)}>
            + Créer une classe
          </button>
        </p>
      )}

      {classes === null && !error && <p role="status">Chargement…</p>}
      {classes?.length === 0 && (
        <p>Vous n’avez pas encore de classe. Créez-en une pour obtenir un code à donner à vos apprentis.</p>
      )}

      {actives.length > 0 && <ClassList classes={actives} />}
      {archivees.length > 0 && (
        <details>
          <summary>Classes archivées ({archivees.length})</summary>
          <ClassList classes={archivees} />
        </details>
      )}
    </Page>
  );
}

function ClassList({ classes }: { classes: FormateurClass[] }) {
  return (
    <ul className="grid" style={{ listStyle: 'none', padding: 0 }}>
      {classes.map((c) => (
        <li key={c.id} className="card">
          <h2>
            <Link to={`/formateur/classes/${c.id}`}>{c.nom}</Link>
          </h2>
          <p className="muted small">
            {METIER_LABELS[c.metier]} · {NIVEAU_LABELS[c.niveau]} · {c.nbApprentis} apprenti{c.nbApprentis > 1 ? 's' : ''}
          </p>
          <p style={{ marginBottom: 0 }}>
            Code : <span className="code-display">{formatClassCode(c.code)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
