import type { TutorStreamEvent } from '@mathsuivi/shared';
import { ApiError } from './client';

/**
 * POST qui renvoie un flux SSE (réponse du tuteur mot à mot).
 * Une erreur avant l'ouverture du flux (quota, accès refusé) arrive en JSON → ApiError.
 */
export async function postStream(
  path: string,
  body: unknown,
  onEvent: (event: TutorStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError(0, 'Pas de connexion au serveur. Vérifie ta connexion internet.');
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error ?? 'Le serveur ne répond pas. Réessaie dans un instant.');
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('');
      if (data) onEvent(JSON.parse(data) as TutorStreamEvent);
    }
  }
}
