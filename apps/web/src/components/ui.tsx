import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';

let firstPage = true;

/**
 * Titre de page : met à jour l'onglet (WCAG 2.4.2) et place le focus sur le h1
 * après chaque navigation, pour que les lecteurs d'écran annoncent la nouvelle page.
 */
export function Page({ title, children, narrow }: { title: string; children: ReactNode; narrow?: boolean }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} — Coach Maths`;
    if (firstPage) firstPage = false;
    else h1.current?.focus();
  }, [title]);
  useEffect(() => {
    document.getElementById('contenu')?.classList.toggle('narrow', !!narrow);
  }, [narrow]);
  return (
    <>
      <h1 ref={h1} tabIndex={-1}>
        {title}
      </h1>
      {children}
    </>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Field({ label, hint, error, className, ...input }: FieldProps) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      <input
        id={id}
        className={`input ${className ?? ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
      />
      {error && (
        <p className="field-error" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Code PIN à 6 chiffres, avec bouton Afficher (le collage reste autorisé, WCAG 3.3.8). */
export function PinField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <span className="hint" id={`${id}-hint`}>
        {hint ?? '6 chiffres.'}
      </span>
      <div className="input-group">
        <input
          id={id}
          className="input input-code"
          type={visible ? 'text' : 'password'}
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoComplete={autoComplete}
          aria-describedby={`${id}-hint`}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <button
          type="button"
          className="btn btn-secondary"
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? 'Masquer' : 'Afficher'}
        </button>
      </div>
    </div>
  );
}

export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function formatDate(iso: string | null) {
  if (!iso) return 'jamais';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
