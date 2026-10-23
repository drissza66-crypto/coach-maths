import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  METIER_LABELS,
  NIVEAU_LABELS,
  newPinSchema,
  normalizeClassCode,
  pseudoSchema,
  type ClassCheckResult,
  type Me,
} from '@mathsuivi/shared';
import { api } from '../../api/client';
import { homePath, useAuth } from '../../auth/AuthContext';
import { Alert, Field, Page, PinField, useAsyncAction } from '../../components/ui';

type Step = 'code' | 'choix' | 'connexion' | 'inscription';

export function ConnexionApprenti() {
  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState('');
  const [classe, setClasse] = useState<ClassCheckResult | null>(null);

  const titles: Record<Step, string> = {
    code: 'Connexion apprenti',
    choix: 'C’est bien ta classe ?',
    connexion: 'Je me connecte',
    inscription: 'Je crée mon compte',
  };

  return (
    <Page title={titles[step]} narrow>
      {classe && step !== 'code' && (
        <p className="card">
          Classe : <strong>{classe.nom}</strong>
          <br />
          <span className="muted">
            {METIER_LABELS[classe.metier]} · {NIVEAU_LABELS[classe.niveau]}
          </span>
        </p>
      )}
      {step === 'code' && (
        <StepCode
          code={code}
          setCode={setCode}
          onFound={(c) => {
            setClasse(c);
            setStep('choix');
          }}
        />
      )}
      {step === 'choix' && (
        <div className="stack">
          <button className="btn btn-block" onClick={() => setStep('connexion')}>
            J’ai déjà un compte
          </button>
          <button className="btn btn-secondary btn-block" onClick={() => setStep('inscription')}>
            C’est ma première fois
          </button>
          <button className="link-button" onClick={() => setStep('code')}>
            Ce n’est pas ma classe : changer de code
          </button>
        </div>
      )}
      {step === 'connexion' && <StepConnexion code={code} onBack={() => setStep('choix')} />}
      {step === 'inscription' && <StepInscription code={code} onBack={() => setStep('choix')} />}
    </Page>
  );
}

function StepCode({
  code,
  setCode,
  onFound,
}: {
  code: string;
  setCode(v: string): void;
  onFound(c: ClassCheckResult): void;
}) {
  const { busy, error, run } = useAsyncAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => onFound(await api<ClassCheckResult>('/auth/apprenti/classe', 'POST', { code })));
  };
  return (
    <form onSubmit={submit} noValidate>
      <Alert kind="error">{error}</Alert>
      <Field
        label="Code classe"
        hint="Ton formateur te le donne. Exemple : ABC-234."
        className="input-code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={9}
        required
      />
      <button className="btn btn-block" disabled={busy || normalizeClassCode(code).length !== 6}>
        {busy ? 'Vérification…' : 'Continuer'}
      </button>
    </form>
  );
}

function useLoggedIn() {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  return (me: Me) => {
    setMe(me);
    navigate(homePath(me), { replace: true });
  };
}

function StepConnexion({ code, onBack }: { code: string; onBack(): void }) {
  const [pseudo, setPseudo] = useState('');
  const [pin, setPin] = useState('');
  const { busy, error, run } = useAsyncAction();
  const loggedIn = useLoggedIn();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => loggedIn(await api<Me>('/auth/apprenti/connexion', 'POST', { code, pseudo, pin })));
  };

  return (
    <form onSubmit={submit} noValidate>
      <Alert kind="error">{error}</Alert>
      <Field
        label="Ton pseudo"
        value={pseudo}
        onChange={(e) => setPseudo(e.target.value)}
        autoComplete="username"
        required
      />
      <PinField label="Ton code secret" value={pin} onChange={setPin} autoComplete="current-password" />
      <div className="stack">
        <button className="btn btn-block" disabled={busy || !pseudo.trim() || pin.length !== 6}>
          {busy ? 'Connexion…' : 'Me connecter'}
        </button>
        <p className="muted small">Code oublié ? Demande à ton formateur un nouveau code.</p>
        <button type="button" className="link-button" onClick={onBack}>
          Retour
        </button>
      </div>
    </form>
  );
}

function StepInscription({ code, onBack }: { code: string; onBack(): void }) {
  const [pseudo, setPseudo] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [age, setAge] = useState<'plus' | 'moins' | ''>('');
  const [cgu, setCgu] = useState(false);
  const [ia, setIa] = useState(false);
  const { busy, error, setError, run } = useAsyncAction();
  const loggedIn = useLoggedIn();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const checks = [
      pseudoSchema.safeParse(pseudo).error?.issues[0]?.message,
      newPinSchema.safeParse(pin).error?.issues[0]?.message,
      pin !== pin2 ? 'Les deux codes ne sont pas pareils.' : undefined,
      !age ? 'Dis-nous si tu as 15 ans ou plus.' : undefined,
      !cgu ? 'Tu dois accepter les règles d’utilisation.' : undefined,
    ];
    const problem = checks.find(Boolean);
    if (problem) return setError(problem);

    run(async () =>
      loggedIn(
        await api<Me>('/auth/apprenti/inscription', 'POST', {
          code,
          pseudo,
          pin,
          aPlusDe15Ans: age === 'plus',
          accepteCgu: cgu,
          accepteTuteurIa: age === 'plus' && ia,
        }),
      ),
    );
  };

  return (
    <form onSubmit={submit} noValidate>
      <Alert kind="error">{error}</Alert>
      <Field
        label="Choisis un pseudo"
        hint="Pas ton vrai nom. 2 à 20 caractères."
        value={pseudo}
        onChange={(e) => setPseudo(e.target.value)}
        autoComplete="username"
        maxLength={20}
        required
      />
      <PinField
        label="Choisis un code secret"
        hint="6 chiffres. Pas 123456 ni 000000."
        value={pin}
        onChange={setPin}
        autoComplete="new-password"
      />
      <PinField label="Écris-le une 2e fois" hint="Pour vérifier." value={pin2} onChange={setPin2} autoComplete="new-password" />

      <fieldset>
        <legend className="legend">As-tu 15 ans ou plus ?</legend>
        <label className="choice">
          <input type="radio" name="age" checked={age === 'plus'} onChange={() => setAge('plus')} />
          Oui, j’ai 15 ans ou plus
        </label>
        <label className="choice">
          <input type="radio" name="age" checked={age === 'moins'} onChange={() => setAge('moins')} />
          Non, j’ai moins de 15 ans
        </label>
      </fieldset>

      <details className="card">
        <summary>Lire les règles d’utilisation</summary>
        <ul>
          <li>Je respecte les autres.</li>
          <li>Je n’écris pas mon nom, mon adresse ou mon téléphone.</li>
          <li>Le coach m’aide à comprendre. Il ne fait pas les exercices à ma place.</li>
          <li>Mes données restent au CFA. Je peux les télécharger ou les supprimer quand je veux.</li>
        </ul>
      </details>
      <label className="choice">
        <input type="checkbox" checked={cgu} onChange={(e) => setCgu(e.target.checked)} />
        J’ai lu et j’accepte les règles d’utilisation.
      </label>

      {age === 'plus' && (
        <label className="choice">
          <input type="checkbox" checked={ia} onChange={(e) => setIa(e.target.checked)} />
          <span>
            J’accepte d’utiliser le tuteur IA. <span className="muted small">Je pourrai changer d’avis plus tard.</span>
          </span>
        </label>
      )}
      {age === 'moins' && (
        <Alert kind="info">
          <p>Pour utiliser le tuteur IA, il faut l’accord de tes parents. Ton formateur s’en occupe avec eux.</p>
        </Alert>
      )}

      <div className="stack">
        <button className="btn btn-block" disabled={busy}>
          {busy ? 'Création…' : 'Créer mon compte'}
        </button>
        <button type="button" className="link-button" onClick={onBack}>
          Retour
        </button>
      </div>
    </form>
  );
}
