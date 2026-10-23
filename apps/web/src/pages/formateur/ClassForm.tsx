import { useId, useState, type FormEvent } from 'react';
import { METIERS, METIER_LABELS, NIVEAUX, NIVEAU_LABELS, type ClassCreate, type Metier, type Niveau } from '@mathsuivi/shared';
import { Alert, Field, useAsyncAction } from '../../components/ui';

/** Formulaire partagé : création et modification d'une classe. */
export function ClassForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: ClassCreate;
  submitLabel: string;
  onSubmit(values: ClassCreate): Promise<void>;
}) {
  const id = useId();
  const [nom, setNom] = useState(initial?.nom ?? '');
  const [metier, setMetier] = useState<Metier>(initial?.metier ?? 'macon');
  const [niveau, setNiveau] = useState<Niveau>(initial?.niveau ?? 'CAP1');
  const { busy, error, run } = useAsyncAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => onSubmit({ nom, metier, niveau }));
  };

  return (
    <form onSubmit={submit} noValidate>
      <Alert kind="error">{error}</Alert>
      <Field
        label="Nom de la classe"
        hint="Exemple : CAP Maçon 1 — groupe A"
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        maxLength={60}
        required
      />
      <div className="field">
        <label htmlFor={`${id}-metier`}>Métier</label>
        <select id={`${id}-metier`} className="input" value={metier} onChange={(e) => setMetier(e.target.value as Metier)}>
          {METIERS.map((m) => (
            <option key={m} value={m}>
              {METIER_LABELS[m]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-niveau`}>Niveau</label>
        <select id={`${id}-niveau`} className="input" value={niveau} onChange={(e) => setNiveau(e.target.value as Niveau)}>
          {NIVEAUX.map((n) => (
            <option key={n} value={n}>
              {NIVEAU_LABELS[n]}
            </option>
          ))}
        </select>
      </div>
      <button className="btn" disabled={busy || nom.trim().length < 2}>
        {busy ? 'Enregistrement…' : submitLabel}
      </button>
    </form>
  );
}
