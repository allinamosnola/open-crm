import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// withRetry y fetchWithRetry con reloj falso (vi.useFakeTimers): las esperas
// del backoff se avanzan a mano, sin dormir de verdad. Sin red.

const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/observability', () => ({ reportError }));

const {
  backoffDelay,
  fetchWithRetry,
  isTransientError,
  parseRetryAfter,
  RetryableHttpError,
  withRetry,
} = await import('@/lib/retry');

function httpError(status: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`status ${status}`), { status, ...extra });
}

function timeoutError() {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

function json(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

beforeEach(() => {
  reportError.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('backoffDelay', () => {
  it('crece exponencialmente con jitter completo y respeta el tope', () => {
    const max = () => 0.999999;
    expect(backoffDelay(1, { baseDelayMs: 500, random: max })).toBe(500);
    expect(backoffDelay(2, { baseDelayMs: 500, random: max })).toBe(1000);
    expect(backoffDelay(3, { baseDelayMs: 500, random: max })).toBe(2000);
    expect(backoffDelay(10, { baseDelayMs: 500, maxDelayMs: 8000, random: max })).toBe(8000);
    expect(backoffDelay(3, { baseDelayMs: 500, random: () => 0 })).toBe(0);
  });
});

describe('parseRetryAfter', () => {
  it('lee segundos, fecha HTTP y retry-after-ms', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '3' }))).toBe(3000);
    expect(parseRetryAfter(new Headers({ 'retry-after-ms': '250', 'retry-after': '3' }))).toBe(250);
    const now = Date.parse('2026-10-13T12:00:00Z');
    expect(parseRetryAfter(new Headers({ 'retry-after': 'Tue, 13 Oct 2026 12:00:05 GMT' }), now)).toBe(5000);
    expect(parseRetryAfter(new Headers({ 'retry-after': 'mañana' }))).toBeNull();
    expect(parseRetryAfter(new Headers())).toBeNull();
  });
});

describe('isTransientError', () => {
  it('429, 5xx, 529, red y timeout son transitorios; 4xx y AbortError no', () => {
    for (const status of [429, 500, 502, 503, 504, 529]) expect(isTransientError(httpError(status))).toBe(true);
    for (const status of [400, 401, 403, 404, 422]) expect(isTransientError(httpError(status))).toBe(false);
    expect(isTransientError(timeoutError())).toBe(true);
    expect(isTransientError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientError(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }))).toBe(true);
    expect(isTransientError(new DOMException('aborted', 'AbortError'))).toBe(false);
    expect(isTransientError(new Error('bug'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('reintenta un 503 con backoff y devuelve el resultado; registra cada intento con where y attempt', async () => {
    const fn = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce('ok');
    const promise = withRetry(fn, { where: 'test.op', baseDelayMs: 100, random: () => 1 });

    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    // Primera espera: 100 ms; segunda: 200 ms.
    await vi.advanceTimersByTimeAsync(99);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toBe('ok');
    expect(fn.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);

    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError.mock.calls[0][2]).toMatchObject({
      where: 'test.op',
      tags: { attempt: '1' },
      extra: { status: 503, will_retry: true, transient: true },
    });
    expect(reportError.mock.calls[1][2]).toMatchObject({ tags: { attempt: '2' } });
  });

  it('respeta Retry-After de un 429', async () => {
    const error = new RetryableHttpError(429, 3000);
    const fn = vi.fn<() => Promise<string>>().mockRejectedValueOnce(error).mockResolvedValueOnce('ok');
    const promise = withRetry(fn, { where: 'test.op', baseDelayMs: 10, random: () => 0 });
    await vi.advanceTimersByTimeAsync(2999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe('ok');
    expect(reportError.mock.calls[0][2].extra).toMatchObject({ retry_after_ms: 3000 });
  });

  it('no espera un Retry-After mayor que maxDelayMs: falla ya', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new RetryableHttpError(429, 60_000));
    await expect(withRetry(fn, { where: 'test.op', maxDelayMs: 8000 })).rejects.toBeInstanceOf(RetryableHttpError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][2].extra).toMatchObject({ will_retry: false });
  });

  it('un error permanente (400) no se reintenta', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(httpError(400));
    await expect(withRetry(fn, { where: 'test.op' })).rejects.toMatchObject({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][2].extra).toMatchObject({ transient: false, will_retry: false });
  });

  it('agota maxAttempts y relanza el último error', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(timeoutError());
    const promise = withRetry(fn, { where: 'test.op', maxAttempts: 4, baseDelayMs: 50 });
    const settled = expect(promise).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.runAllTimersAsync();
    await settled;
    expect(fn).toHaveBeenCalledTimes(4);
    expect(reportError).toHaveBeenCalledTimes(4);
    expect(reportError.mock.calls[3][2]).toMatchObject({ tags: { attempt: '4' }, extra: { will_retry: false } });
  });
});

describe('fetchWithRetry', () => {
  it('429 con Retry-After y luego 200', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(429, { error: 'rate' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(json(200, { id: 'x' }));
    const promise = fetchWithRetry('https://api.test/x', { method: 'POST' }, { where: 'test.fetch', fetch: fetchMock });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const response = await promise;
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('503 persistente: al agotar los intentos devuelve la última respuesta', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => json(503));
    const promise = fetchWithRetry('https://api.test/x', undefined, { where: 'test.fetch', fetch: fetchMock });
    await vi.runAllTimersAsync();
    const response = await promise;
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('timeout y luego 200', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(json(200));
    const promise = fetchWithRetry('https://api.test/x', undefined, {
      where: 'test.fetch',
      fetch: fetchMock,
      timeoutMs: 5000,
    });
    await vi.runAllTimersAsync();
    expect((await promise).status).toBe(200);
    // Cada intento lleva su propia señal de timeout.
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('x-should-retry: false no se reintenta; un 400 tampoco', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(503, {}, { 'x-should-retry': 'false' }))
      .mockResolvedValueOnce(json(400));
    expect((await fetchWithRetry('https://api.test/x', undefined, { where: 't', fetch: fetchMock })).status).toBe(503);
    expect((await fetchWithRetry('https://api.test/x', undefined, { where: 't', fetch: fetchMock })).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('si quien llama abortó, no se reintenta', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      fetchWithRetry('https://api.test/x', { signal: controller.signal }, { where: 't', fetch: fetchMock }),
    ).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
