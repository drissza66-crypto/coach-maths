import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Me } from '@mathsuivi/shared';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Page } from '../../components/ui';

export function Verification() {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    // Le lien ne sert qu'une fois : on évite le double appel du mode strict de React.
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setError('Lien incomplet. Demandez un nouveau lien.');
      return;
    }
    api<Me>('/auth/formateur/verifier', 'POST', { token })
      .then((me) => {
        setMe(me);
        navigate('/formateur', { replace: true });
      })
      .catch((err) => setError(errorMessage(err)));
  }, [navigate, setMe]);

  return (
    <Page title="Connexion en cours" narrow>
      {error ? (
        <>
          <Alert kind="error">{error}</Alert>
          <Link to="/formateur/connexion">Demander un nouveau lien</Link>
        </>
      ) : (
        <p role="status">Vérification du lien…</p>
      )}
    </Page>
  );
}
