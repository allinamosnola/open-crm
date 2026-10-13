import { reportError } from '@/lib/observability';

// Reintentos con backoff exponencial y jitter para las llamadas a APIs de
// terceros (Twilio, Resend, Anthropic). Solo se reintentan errores transitorios
// (429, 5xx, 529 de Anthropic, red, timeouts); un 4xx de validación falla a la
// primera. Si la respuesta trae Retry-After se respeta, salvo que pida esperar
// más que maxDelayMs: entonces se deja de reintentar (en un webhook con
// maxDuration no tiene sentido esperar minutos). Cada intento fallido se
// registra con reportError (tags where y attempt).
//
// Sin 'server-only': el agente del bot también corre en scripts (eval, simulador).

export interface RetryOptions {
  // Punto del código (tag `where` en Sentry), p. ej. 'twilio.send'.
  where: string;
  clinicId?: string;
  // Intentos totales, incluido el primero.
  maxAttempts?: number;
  // Espera base del backoff: base * 2^(intento - 1), con jitter completo.
  baseDelayMs?: number;
  // Tope de cada espera (y de un Retry-After aceptable).
  maxDelayMs?: number;
  // Decide si un error es transitorio. Por defecto, isTransientError.
  isRetryable?: (error: unknown) => boolean;
  // Se llama antes de esperar para el siguiente intento.
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  // Inyectables para tests (reloj falso, jitter determinista).
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 8_000;

// 408 timeout, 425 too early, 429 rate limit, 5xx, 529 = Anthropic sobrecargado.
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

// Errores de red de Node/undici: la petición no llegó o se cortó.
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
]);

// Error de una respuesta HTTP transitoria (lo lanza fetchWithRetry para que
// withRetry reintente). Conserva la respuesta por si ya no quedan intentos.
export class RetryableHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly response: Response | null;
  constructor(status: number, retryAfterMs: number | null, response: Response | null = null) {
    super(`http_${status}`);
    this.name = 'RetryableHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.response = response;
  }
}

export function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status);
}

// Código HTTP de un error de SDK (Twilio RestException, Anthropic APIError).
export function httpStatusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function networkCodeOf(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') return code;
  // fetch de Node envuelve el error real en `cause` ("fetch failed").
  const cause = (error as { cause?: unknown }).cause;
  return cause && cause !== error ? networkCodeOf(cause) : null;
}

// Timeout de AbortSignal.timeout() o error de red sin respuesta.
export function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'TimeoutError') return true;
  const code = networkCodeOf(error);
  return code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT';
}

export function isNetworkError(error: unknown): boolean {
  const code = networkCodeOf(error);
  if (code && NETWORK_ERROR_CODES.has(code)) return true;
  return error instanceof TypeError && error.message === 'fetch failed';
}

// Criterio por defecto: 429/5xx, red o timeout. Un AbortError (cancelado por
// quien llama) no se reintenta.
export function isTransientError(error: unknown): boolean {
  if (error instanceof RetryableHttpError) return true;
  const status = httpStatusOf(error);
  if (status != null) return isTransientStatus(status);
  return isTimeoutError(error) || isNetworkError(error);
}

// Retry-After en ms: retry-after-ms (Anthropic), segundos o fecha HTTP.
export function parseRetryAfter(headers: Headers | null | undefined, now: number = Date.now()): number | null {
  if (!headers) return null;
  const ms = headers.get('retry-after-ms');
  if (ms != null && ms.trim() !== '') {
    const value = Number(ms);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const raw = headers.get('retry-after');
  if (raw == null || raw.trim() === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function retryAfterOf(error: unknown): number | null {
  if (error instanceof RetryableHttpError) return error.retryAfterMs;
  if (!error || typeof error !== 'object') return null;
  const headers = (error as { headers?: unknown }).headers;
  return headers instanceof Headers ? parseRetryAfter(headers) : null;
}

// Espera del intento `attempt` (1 = tras el primer fallo): jitter completo
// sobre el backoff exponencial, con tope.
export function backoffDelay(
  attempt: number,
  options: { baseDelayMs?: number; maxDelayMs?: number; random?: () => number } = {},
): number {
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const ceiling = Math.min(max, base * 2 ** (attempt - 1));
  return Math.round((options.random ?? Math.random)() * ceiling);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Ejecuta fn hasta maxAttempts veces. fn recibe el número de intento (1..n).
// Relanza el último error si se agotan los intentos o si no es transitorio.
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const isRetryable = options.isRetryable ?? isTransientError;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      const retryAfterMs = retryAfterOf(error);
      const transient = isRetryable(error);
      // Retry-After mayor que el tope: mejor fallar ya y dejarlo visible.
      const waitTooLong = retryAfterMs != null && retryAfterMs > maxDelayMs;
      const willRetry = transient && !waitTooLong && attempt < maxAttempts;
      const status = httpStatusOf(error);

      reportError(`${options.where}: intento ${attempt}/${maxAttempts} falló`, error, {
        where: options.where,
        clinicId: options.clinicId,
        tags: { attempt: String(attempt) },
        extra: {
          max_attempts: maxAttempts,
          transient,
          will_retry: willRetry,
          ...(status != null ? { status } : {}),
          ...(retryAfterMs != null ? { retry_after_ms: retryAfterMs } : {}),
        },
      });
      if (!willRetry) throw error;

      const delay = retryAfterMs ?? backoffDelay(attempt, { ...options, maxDelayMs });
      options.onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
}

export interface FetchRetryOptions extends RetryOptions {
  // Timeout de cada intento (AbortSignal.timeout); sin valor, sin timeout propio.
  timeoutMs?: number;
}

// fetch con reintentos: una respuesta 429/5xx se reintenta (salvo
// `x-should-retry: false`); al agotar los intentos se devuelve la última
// respuesta tal cual, para que quien llama lea el estado. Los errores de red y
// timeouts se reintentan y, al final, se relanzan. Si la señal de quien llama ya
// está abortada no se reintenta.
export async function fetchWithRetry(
  input: string | URL | Request,
  init: RequestInit | undefined,
  options: FetchRetryOptions & { fetch?: typeof fetch },
): Promise<Response> {
  const fetchImpl = options.fetch ?? fetch;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const callerSignal = init?.signal ?? undefined;
  try {
    return await withRetry(
      async () => {
        const signals = [callerSignal, options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined]
          .filter((s): s is AbortSignal => !!s);
        const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
        const response = await fetchImpl(input, { ...init, ...(signal ? { signal } : {}) });
        if (isTransientStatus(response.status) && response.headers.get('x-should-retry') !== 'false') {
          throw new RetryableHttpError(response.status, parseRetryAfter(response.headers), response);
        }
        return response;
      },
      {
        ...options,
        maxAttempts,
        isRetryable: (error) => !callerSignal?.aborted && (options.isRetryable ?? isTransientError)(error),
        onRetry: (error, attempt, delay) => {
          // Se descarta el cuerpo de la respuesta que se va a reintentar.
          if (error instanceof RetryableHttpError) void error.response?.body?.cancel().catch(() => {});
          options.onRetry?.(error, attempt, delay);
        },
      },
    );
  } catch (error) {
    if (error instanceof RetryableHttpError && error.response) return error.response;
    throw error;
  }
}

// fetch compatible con la opción `fetch` de los SDK (Anthropic): reintenta
// cada petición HTTP por separado. Así un 429 a mitad del loop de herramientas
// no repite las herramientas ya ejecutadas (lo haría reintentar el loop entero).
export function createRetryingFetch(
  options: FetchRetryOptions & { fetch?: typeof fetch },
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return (input, init) => fetchWithRetry(input, init, options);
}
