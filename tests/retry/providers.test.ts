import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Reintentos aplicados a cada proveedor, con respuestas simuladas (sin red):
// Twilio (sendWhatsApp), Resend (sendEscalationEmail) y Anthropic (cliente del
// bot con fetch simulado y el Tool Runner real del SDK).

const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/observability', () => ({ reportError }));

const { sendWhatsApp, isRetryableTwilioError } = await import('@/lib/whatsapp/twilio');
const { sendEscalationEmail } = await import('@/lib/notify/email');
const { createAnthropicClient, handleMessage } = await import('@/lib/bot/agent');
const { createFixture, CONVERSATION, NOW } = await import('../bot/helpers');

// Error de la API REST de Twilio (RestException: status HTTP + código Twilio).
function twilioError(status: number, code: number) {
  return Object.assign(new Error(`Twilio ${code}`), { status, code });
}

const MESSAGE = { sid: 'SM123', status: 'queued', errorCode: null };
const PARAMS = { from: '+14155238886', to: '+5215588887777', body: 'Hola' };

beforeEach(() => {
  reportError.mockClear();
  vi.useFakeTimers();
  vi.stubEnv('PUBLIC_BASE_URL', 'https://crm.test');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Twilio: sendWhatsApp', () => {
  it('429 (20429) y luego aceptado: un fallo transitorio no pierde el mensaje', async () => {
    const create = vi.fn().mockRejectedValueOnce(twilioError(429, 20429)).mockResolvedValueOnce(MESSAGE);
    const promise = sendWhatsApp(PARAMS, { create });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ sid: 'SM123', status: 'queued', errorCode: null });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toMatchObject({
      to: 'whatsapp:+5215588887777',
      statusCallback: 'https://crm.test/api/whatsapp/status',
    });
    expect(reportError.mock.calls[0][2]).toMatchObject({ where: 'twilio.send', tags: { attempt: '1' } });
  });

  it('503 persistente: queda failed con el código tras agotar los intentos', async () => {
    const create = vi.fn().mockRejectedValue(twilioError(503, 20503));
    const promise = sendWhatsApp(PARAMS, { create });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ sid: null, status: 'failed', errorCode: '20503' });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('63016 (fuera de la ventana de 24 h) es permanente: un solo intento', async () => {
    const create = vi.fn().mockRejectedValue(twilioError(400, 63016));
    expect(await sendWhatsApp(PARAMS, { create })).toEqual({ sid: null, status: 'failed', errorCode: '63016' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('un timeout es ambiguo (Twilio pudo aceptarlo): no se reintenta para no duplicar', async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
    expect(await sendWhatsApp(PARAMS, { create })).toEqual({ sid: null, status: 'failed', errorCode: 'ECONNABORTED' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('sin conexión (la petición no salió) sí se reintenta', () => {
    expect(isRetryableTwilioError(Object.assign(new Error('dns'), { code: 'ENOTFOUND' }))).toBe(true);
    expect(isRetryableTwilioError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(false);
  });
});

describe('Resend: sendEscalationEmail', () => {
  const EMAIL = {
    to: 'recepcion@demo.local',
    clinicName: 'Consultorio',
    patientName: null,
    patientPhone: null,
    category: 'other' as const,
    reason: 'Pregunta',
    conversationId: 'conv-1',
  };

  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', 'bot@demo.local');
  });

  it('503 y luego 200, con la misma Idempotency-Key en ambos intentos', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }));
    const promise = sendEscalationEmail(EMAIL, { fetch: fetchMock });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ sent: true, id: 'email_1' });
    const keys = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('idempotency-key'));
    expect(keys[0]).toMatch(/^escalation-conv-1-/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('timeouts en todos los intentos: no lanza, devuelve network', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    const promise = sendEscalationEmail(EMAIL, { fetch: fetchMock });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ sent: false, reason: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('429 persistente: no lanza, devuelve el código', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}', { status: 429 }));
    const promise = sendEscalationEmail(EMAIL, { fetch: fetchMock });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ sent: false, reason: 'http_429' });
  });

  it('422 (validación) no se reintenta', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 422 }));
    expect(await sendEscalationEmail(EMAIL, { fetch: fetchMock })).toEqual({ sent: false, reason: 'http_422' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Anthropic: cliente del bot', () => {
  function messageResponse(text: string) {
    return new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  function overloaded(status: number, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'x' } }), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }

  async function runTurn(fetchMock: typeof fetch) {
    const repo = createFixture();
    repo.addMessage(CONVERSATION, 'patient', 'hola');
    const anthropic = createAnthropicClient({ apiKey: 'test-key', fetch: fetchMock });
    return handleMessage(CONVERSATION, 'hola', { repo, anthropic, now: () => NOW, effort: 'low', notify: async () => {} });
  }

  it('429 con retry-after-ms y 529 (sobrecargado), luego responde', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(overloaded(429, { 'retry-after-ms': '1500' }))
      .mockResolvedValueOnce(overloaded(529))
      .mockResolvedValueOnce(messageResponse('¡Hola! ¿En qué te ayudo?'));
    const promise = runTurn(fetchMock);
    await vi.runAllTimersAsync();
    expect(await promise).toBe('¡Hola! ¿En qué te ayudo?');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(reportError.mock.calls.map((c) => c[2].where)).toEqual(['anthropic.messages', 'anthropic.messages']);
    expect(reportError.mock.calls[0][2].extra).toMatchObject({ status: 429, retry_after_ms: 1500 });
  });

  it('error de autenticación (401) no se reintenta y el turno lanza', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(overloaded(401));
    await expect(runTurn(fetchMock)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
