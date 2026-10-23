import { useEffect, useState } from 'react';
import type { ApprentiProgress } from '@mathsuivi/shared';
import { api, errorMessage } from '../../api/client';
import { ProgressView } from '../../components/ProgressView';
import { Alert, Page } from '../../components/ui';

export function MesProgres() {
  const [progress, setProgress] = useState<ApprentiProgress | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<ApprentiProgress>('/progres')
      .then(setProgress)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <Page title="Mes progrès">
      <Alert kind="error">{error}</Alert>
      {!progress && !error && <p role="status">Chargement…</p>}
      {progress && <ProgressView progress={progress} pourApprenti />}
    </Page>
  );
}
