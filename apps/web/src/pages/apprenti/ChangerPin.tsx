import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { newPinSchema } from '@mathsuivi/shared';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Page, PinField, useAsyncAction } from '../../components/ui';

export function ChangerPin() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const { busy, error, setError, run } = useAsyncAction();
  const forced = me?.doitChangerPin;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = newPinSchema.safeParse(newPin).error?.issues[0]?.message;
    if (problem) return setError(problem);
    if (newPin !== newPin2) return setError('Les deux nouveaux codes ne sont pas pareils.');
    run(async () => {
      await api('/auth/pin', 'POST', { currentPin, newPin });
      await refresh();
      navigate('/apprenti', { replace: true, state: { message: 'Ton code secret est changé.' } });
    });
  };

  return (
    <Page title={forced ? 'Choisis ton code secret' : 'Changer mon code secret'} narrow>
      {forced && (
        <Alert kind="info">
          <p>Ton formateur t’a donné un code provisoire. Choisis maintenant ton propre code.</p>
        </Alert>
      )}
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        <PinField
          label={forced ? 'Code provisoire' : 'Code actuel'}
          value={currentPin}
          onChange={setCurrentPin}
          autoComplete="current-password"
        />
        <PinField
          label="Nouveau code"
          hint="6 chiffres. Pas 123456 ni 000000."
          value={newPin}
          onChange={setNewPin}
          autoComplete="new-password"
        />
        <PinField label="Nouveau code, une 2e fois" hint="Pour vérifier." value={newPin2} onChange={setNewPin2} autoComplete="new-password" />
        <button className="btn btn-block" disabled={busy || currentPin.length !== 6}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </Page>
  );
}
