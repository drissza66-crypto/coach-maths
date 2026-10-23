export type LLMErrorKind =
  /** Trop de requêtes en peu de temps : on réessaie après une pause. */
  | 'rate_limit'
  /** Quota ou crédit épuisé : inutile de réessayer, on passe au fournisseur de repli. */
  | 'quota'
  | 'auth'
  | 'timeout'
  | 'unavailable'
  | 'bad_request'
  /** Le fournisseur a refusé le contenu (filtre de sécurité). */
  | 'content_filter'
  /** Sortie structurée invalide même après une tentative de réparation. */
  | 'invalid_output'
  | 'aborted';

export class LLMError extends Error {
  constructor(
    public readonly kind: LLMErrorKind,
    public readonly provider: string,
    message?: string,
    public readonly retryAfterMs?: number,
    options?: { cause?: unknown },
  ) {
    super(message ?? kind, options);
    this.name = 'LLMError';
  }

  get retryable() {
    return this.kind === 'rate_limit' || this.kind === 'unavailable' || this.kind === 'timeout';
  }
}

/** Retry-After en secondes ou en date HTTP → millisecondes. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

const QUOTA_HINT = /quota|exhaust|insufficient|billing|credit|limit exceeded for (the )?(day|month)/i;

/** Traduit une réponse HTTP en erreur normalisée (fournisseurs appelés par fetch). */
export function errorFromHttp(provider: string, status: number, body: string, headers?: Headers): LLMError {
  const retryAfter = parseRetryAfter(headers?.get('retry-after'));
  const detail = `HTTP ${status}`;
  if (status === 401 || status === 403) return new LLMError('auth', provider, detail);
  if (status === 402) return new LLMError('quota', provider, detail);
  if (status === 429) {
    return QUOTA_HINT.test(body) && !retryAfter
      ? new LLMError('quota', provider, detail)
      : new LLMError('rate_limit', provider, detail, retryAfter);
  }
  if (status === 408 || status === 504) return new LLMError('timeout', provider, detail);
  if (status >= 500) return new LLMError('unavailable', provider, detail, retryAfter);
  return new LLMError('bad_request', provider, detail);
}

/** Erreurs réseau, délai dépassé, annulation → erreur normalisée. */
export function errorFromException(provider: string, err: unknown, signal?: AbortSignal): LLMError {
  if (err instanceof LLMError) return err;
  const e = err as { name?: string };
  if (signal?.aborted && signal.reason?.name !== 'TimeoutError') {
    return new LLMError('aborted', provider, 'aborted', undefined, { cause: err });
  }
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return new LLMError('timeout', provider, 'timeout', undefined, { cause: err });
  }
  return new LLMError('unavailable', provider, 'network error', undefined, { cause: err });
}
