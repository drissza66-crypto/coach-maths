import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ApprentiProgress } from '@mathsuivi/shared';
import { api, errorMessage } from '../../api/client';
import { ProgressView } from '../../components/ProgressView';
import { Alert, Page } from '../../components/ui';

/** Fiche de suivi d'un apprenti pour son formateur : mêmes données que « Mes progrès ». */
export function SuiviApprenti() {
  const { id, apprentiId } = useParams<{ id: string; apprentiId: string }>();
  const [progress, setProgress] = useState<ApprentiProgress | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<ApprentiProgress>(`/tableau-de-bord/classes/${id}/apprentis/${apprentiId}`)
      .then(setProgress)
      .catch((err) => setError(errorMessage(err)));
  }, [id, apprentiId]);

  return (
    <Page title={progress ? `Suivi de ${progress.pseudo}` : 'Suivi de l’apprenti'}>
      <p>
        <Link to={`/formateur/classes/${id}/tableau-de-bord`}>← Tableau de bord de la classe</Link>
      </p>
      <Alert kind="error">{error}</Alert>
      {!progress && !error && <p role="status">Chargement…</p>}
      {progress && (
        <>
          <p className="muted small">
            Maîtrise calculée sur les 90 derniers jours. Les échanges avec le coach ne sont pas visibles.
          </p>
          <ProgressView progress={progress} pourApprenti={false} />
        </>
      )}
    </Page>
  );
}
