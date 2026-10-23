import { errorFromException, errorFromHttp } from './errors.js';

/** Signal qui s'annule au premier des deux : délai dépassé ou annulation par l'appelant. */
export function deadline(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

/** POST JSON ; lève une LLMError normalisée en cas d'échec HTTP ou réseau. */
export async function postJson(
  provider: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw errorFromException(provider, err, signal);
  }
  if (!res.ok) {
    // Le corps n'est lu que pour classer l'erreur, jamais journalisé.
    const text = await res.text().catch(() => '');
    throw errorFromHttp(provider, res.status, text, res.headers);
  }
  return res;
}

/** Lit un flux Server-Sent Events et renvoie le champ data de chaque événement. */
export async function* readSse(provider: string, res: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let sep: number;
      while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data) yield data;
      }
    }
  } catch (err) {
    throw errorFromException(provider, err, signal);
  } finally {
    reader.releaseLock();
  }
}
