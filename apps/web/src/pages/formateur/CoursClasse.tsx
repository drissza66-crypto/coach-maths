import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { CourseDocument, CourseDocumentDetail } from '@mathsuivi/shared';
import { api, apiUpload, errorMessage } from '../../api/client';
import { prepareImage } from '../../api/image';
import { Alert, Field, formatDate, useAsyncAction } from '../../components/ui';

const sizeLabel = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;

/**
 * Cours de la classe : le tuteur s'appuie sur ces documents pour guider les apprentis
 * avec le vocabulaire et les méthodes du formateur.
 */
export function CoursClasse({ classId }: { classId: string }) {
  const fileId = useId();
  const [docs, setDocs] = useState<CourseDocument[] | null>(null);
  const [titre, setTitre] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState('');
  const [apercu, setApercu] = useState<CourseDocumentDetail | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { busy, error, setError, run } = useAsyncAction();

  const load = useCallback(() => {
    api<CourseDocument[]>(`/documents?classId=${classId}`)
      .then(setDocs)
      .catch((err) => setError(errorMessage(err)));
  }, [classId, setError]);
  useEffect(load, [load]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setError('Choisissez un fichier PDF ou une photo.');
    setNotice('');
    run(async () => {
      const form = new FormData();
      form.append('classId', classId);
      form.append('titre', titre);
      // Les photos sont réduites et débarrassées de leurs métadonnées avant l'envoi.
      if (file.type.startsWith('image/')) form.append('fichier', await prepareImage(file), file.name.replace(/\.\w+$/, '.jpg'));
      else form.append('fichier', file, file.name);
      const doc = await apiUpload<CourseDocument>('/documents', form);
      setNotice(`« ${doc.titre} » importé : ${doc.nbPages} page${doc.nbPages > 1 ? 's' : ''} lue${doc.nbPages > 1 ? 's' : ''}.`);
      setTitre('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      load();
    });
  };

  return (
    <section className="card" aria-labelledby="cours-titre">
      <h2 id="cours-titre">Cours de la classe</h2>
      <p className="muted small">
        Le coach s’appuie sur vos cours pour guider les apprentis avec vos méthodes. PDF ou photos, 10 Mo maximum.
        Les fichiers sont chiffrés et supprimés automatiquement après 30 jours.
      </p>

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{notice}</Alert>

      {docs && docs.length > 0 && (
        <ul className="member-list" style={{ marginBottom: '1rem' }}>
          {docs.map((d) => (
            <li key={d.id} className="member">
              <span className="member-name">{d.titre}</span>
              <span className="member-meta small muted">
                {d.nbPages} page{d.nbPages > 1 ? 's' : ''} · {sizeLabel(d.taille)} · supprimé le {formatDate(d.expireLe)}
              </span>
              <span className="member-actions">
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() =>
                    api<CourseDocumentDetail>(`/documents/${d.id}`)
                      .then(setApercu)
                      .catch((err) => setError(errorMessage(err)))
                  }
                >
                  Texte lu<span className="visually-hidden"> dans {d.titre}</span>
                </button>
                <a className="btn btn-secondary btn-small" href={`/api/documents/${d.id}/fichier`}>
                  Télécharger<span className="visually-hidden"> {d.titre}</span>
                </a>
                <button
                  className="btn btn-danger btn-small"
                  onClick={() =>
                    window.confirm(`Supprimer « ${d.titre} » ?`) &&
                    run(async () => {
                      await api(`/documents/${d.id}`, 'DELETE');
                      if (apercu?.id === d.id) setApercu(null);
                      load();
                    })
                  }
                >
                  Supprimer<span className="visually-hidden"> {d.titre}</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {apercu && (
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <h3>Texte lu dans « {apercu.titre} »</h3>
          <p className="exercise-text small">{apercu.apercu || '(aucun texte)'}</p>
          <button className="link-button" onClick={() => setApercu(null)}>
            Fermer l’aperçu
          </button>
        </div>
      )}

      <details open={docs?.length === 0}>
        <summary>Importer un cours</summary>
        <form onSubmit={submit} noValidate>
          <Field label="Titre du cours" hint="Exemple : Aires et volumes" value={titre} onChange={(e) => setTitre(e.target.value)} maxLength={80} />
          <div className="field">
            <label htmlFor={fileId}>Fichier</label>
            <span className="hint" id={`${fileId}-hint`}>
              PDF avec du texte, ou photo d’une page (JPEG, PNG). Pas de nom d’apprenti dans le document.
            </span>
            <input
              id={fileId}
              ref={fileInput}
              className="input"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              aria-describedby={`${fileId}-hint`}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <button className="btn" disabled={busy || !file || titre.trim().length < 2}>
            {busy ? 'Lecture du document…' : 'Importer'}
          </button>
          {busy && (
            <p role="status" className="small muted">
              Lecture en cours, cela peut prendre quelques secondes…
            </p>
          )}
        </form>
      </details>
    </section>
  );
}
