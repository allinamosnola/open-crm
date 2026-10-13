import twilio from 'twilio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOT_DISABLED_REPLY,
  BOT_ERROR_REPLY,
  MEDIA_ONLY_REPLY,
  SUBSCRIPTION_INACTIVE_REPLY,
} from '@/lib/bot/replies';

import { db } from './fake-repository';

// ---------------------------------------------------------------------------
// Mocks: base de datos (repositorio en memoria), envío por Twilio, el agente
// (su loop con Claude se prueba en tests/bot/agent.test.ts) y after() de Next.
// La validación de la firma usa el SDK real de Twilio (no hace red): así se
// prueba de verdad.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  // Tareas de after(): se ejecutan en flushAfter(), después de la respuesta.
  pendingAfter: [] as (() => Promise<unknown>)[],
  sendWhatsApp: vi.fn(),
  handleMessage: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    mocks.pendingAfter.push(task);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/whatsapp/repository', () => import('./fake-repository'));
vi.mock('@/lib/bot/agent', () => ({ handleMessage: mocks.handleMessage }));
vi.mock('@/lib/bot/repository-supabase', () => ({ createSupabaseBotRepository: () => ({ fake: 'repo' }) }));
vi.mock('@/lib/whatsapp/twilio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/twilio')>()),
  sendWhatsApp: mocks.sendWhatsApp,
}));

const { POST: webhook } = await import('@/app/api/whatsapp/route');
const { POST: statusCallback } = await import('@/app/api/whatsapp/status/route');

const AUTH_TOKEN = 'test-auth-token';
const BASE_URL = 'https://demo.ngrok.app';
const SANDBOX = '+14155238886';
const CLINIC_A = 'clinic-a';
// Así llega un celular de México en el From de Twilio; el paciente se guarda con +52.
const NEW_PHONE = '+5215588887777';
const NEW_PHONE_NORMALIZED = '+525588887777';
const BOT_TEXT = 'Claro, ¿para qué día te gustaría tu cita?';

function signedRequest(path: string, params: Record<string, string>, signature?: string) {
  const sig = signature ?? twilio.getExpectedTwilioSignature(AUTH_TOKEN, `${BASE_URL}${path}`, params);
  // Next ve la URL local (detrás de ngrok); la firma se calcula con PUBLIC_BASE_URL.
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': sig,
    },
    body: new URLSearchParams(params).toString(),
  });
}

function inbound(overrides: Partial<Record<string, string>> = {}) {
  const params: Record<string, string> = {
    MessageSid: 'SM00000000000000000000000000000001',
    AccountSid: 'AC00000000000000000000000000000000',
    From: `whatsapp:${NEW_PHONE}`,
    To: `whatsapp:${SANDBOX}`,
    Body: 'quiero una cita',
    NumMedia: '0',
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) params[key] = value;
  }
  return params;
}

async function flushAfter() {
  const tasks = mocks.pendingAfter.splice(0);
  for (const task of tasks) await task();
  return tasks.length;
}

let sidCounter = 0;

beforeEach(() => {
  vi.stubEnv('TWILIO_AUTH_TOKEN', AUTH_TOKEN);
  vi.stubEnv('PUBLIC_BASE_URL', `${BASE_URL}/`);
  db.reset();
  db.clinics.push(
    { id: CLINIC_A, whatsapp_from: SANDBOX, subscription_status: 'active' },
    { id: 'clinic-b', whatsapp_from: null, subscription_status: 'trial' },
  );
  mocks.pendingAfter.length = 0;
  sidCounter = 0;
  mocks.handleMessage.mockReset().mockResolvedValue(BOT_TEXT);
  mocks.sendWhatsApp.mockReset().mockImplementation(async () => ({
    sid: `SMout${String(++sidCounter).padStart(29, '0')}`,
    status: 'queued',
    errorCode: null,
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/whatsapp', () => {
  it('con firma válida crea el paciente por identificar, la conversación y el mensaje, y responde el bot', async () => {
    const res = await webhook(signedRequest('/api/whatsapp', inbound()));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/xml');
    expect(await res.text()).toContain('<Response></Response>');

    expect(db.patients).toHaveLength(1);
    expect(db.patients[0]).toMatchObject({
      clinic_id: CLINIC_A,
      phone: NEW_PHONE_NORMALIZED,
      full_name: null,
      status: 'unidentified',
    });
    expect(db.conversations).toHaveLength(1);
    // La conversación guarda el From original: a ese número se responde.
    expect(db.conversations[0]).toMatchObject({ phone: NEW_PHONE, unread_count: 1, bot_paused: false });
    expect(db.messages.filter((m) => m.direction === 'in')).toEqual([
      expect.objectContaining({
        sender: 'patient',
        body: 'quiero una cita',
        twilio_sid: 'SM00000000000000000000000000000001',
        status: 'received',
      }),
    ]);

    // La respuesta sale en after(), por la API REST.
    await flushAfter();
    expect(mocks.handleMessage).toHaveBeenCalledWith(
      db.conversations[0].id,
      'quiero una cita',
      expect.objectContaining({ repo: { fake: 'repo' } }),
    );
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
    const sent = mocks.sendWhatsApp.mock.calls[0][0];
    expect(sent).toMatchObject({ from: SANDBOX, to: NEW_PHONE, body: BOT_TEXT });

    const botMessage = db.messages.find((m) => m.sender === 'bot');
    expect(botMessage).toMatchObject({
      direction: 'out',
      body: BOT_TEXT,
      status: 'queued',
      twilio_sid: 'SMout00000000000000000000000000001',
    });
  });

  it('+521 y +52 son el mismo paciente; se responde al último From', async () => {
    db.patients.push({
      id: 'patient-carlos',
      clinic_id: CLINIC_A,
      phone: '+525511112222',
      full_name: 'Carlos Hernández',
      status: 'active',
    });

    // Llega con +521: se liga al paciente guardado con +52.
    await webhook(signedRequest('/api/whatsapp', inbound({ From: 'whatsapp:+5215511112222', Body: 'hola' })));
    await flushAfter();
    expect(db.patients).toHaveLength(1);
    expect(db.conversations).toHaveLength(1);
    expect(db.conversations[0]).toMatchObject({ patient_id: 'patient-carlos', phone: '+5215511112222' });
    expect(mocks.sendWhatsApp.mock.calls[0][0].to).toBe('+5215511112222');

    // Luego escribe con +52: misma conversación, y se le responde a ese número.
    await webhook(
      signedRequest(
        '/api/whatsapp',
        inbound({ MessageSid: 'SM00000000000000000000000000000002', From: 'whatsapp:+525511112222', Body: 'sigo aquí' }),
      ),
    );
    await flushAfter();
    expect(db.patients).toHaveLength(1);
    expect(db.conversations).toHaveLength(1);
    expect(db.conversations[0]).toMatchObject({ phone: '+525511112222', unread_count: 2 });
    expect(mocks.sendWhatsApp.mock.calls[1][0].to).toBe('+525511112222');
  });

  it('si el agente no responde nada (otro turno ya contestó), no envía', async () => {
    mocks.handleMessage.mockResolvedValue('');
    await webhook(signedRequest('/api/whatsapp', inbound()));
    await flushAfter();
    expect(mocks.handleMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(db.messages.filter((m) => m.sender === 'bot')).toHaveLength(0);
  });

  it('con firma inválida responde 403 y no guarda nada', async () => {
    const res = await webhook(signedRequest('/api/whatsapp', inbound(), 'firma-falsa'));
    expect(res.status).toBe(403);

    // Firma válida pero de otros parámetros (body alterado).
    const tampered = signedRequest(
      '/api/whatsapp',
      inbound({ Body: 'otro texto' }),
      twilio.getExpectedTwilioSignature(AUTH_TOKEN, `${BASE_URL}/api/whatsapp`, inbound()),
    );
    expect((await webhook(tampered)).status).toBe(403);

    // Sin encabezado de firma.
    const unsigned = new Request('http://localhost:3000/api/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(inbound()).toString(),
    });
    expect((await webhook(unsigned)).status).toBe(403);

    await flushAfter();
    expect(db.patients).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('un MessageSid repetido (reintento de Twilio) no duplica ni vuelve a responder', async () => {
    const first = await webhook(signedRequest('/api/whatsapp', inbound()));
    await flushAfter();
    const retry = await webhook(signedRequest('/api/whatsapp', inbound()));
    await flushAfter();

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(db.patients).toHaveLength(1);
    expect(db.conversations).toHaveLength(1);
    expect(db.messages.filter((m) => m.direction === 'in')).toHaveLength(1);
    expect(db.conversations[0].unread_count).toBe(1);
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
  });

  it('con el bot pausado guarda el mensaje pero no envía nada', async () => {
    db.patients.push({
      id: 'patient-maria',
      clinic_id: CLINIC_A,
      phone: '+525522223333',
      full_name: 'María González',
      status: 'active',
    });
    db.conversations.push({
      id: 'conversation-maria',
      clinic_id: CLINIC_A,
      patient_id: 'patient-maria',
      phone: '+5215522223333',
      bot_paused: true,
      unread_count: 0,
      last_message_at: null,
    });

    const res = await webhook(
      signedRequest('/api/whatsapp', inbound({ From: 'whatsapp:+5215522223333', Body: 'hola' })),
    );
    await flushAfter();

    expect(res.status).toBe(200);
    expect(db.patients).toHaveLength(1); // usa el paciente existente
    expect(db.messages).toEqual([
      expect.objectContaining({ conversation_id: 'conversation-maria', direction: 'in', body: 'hola' }),
    ]);
    expect(db.conversations[0].unread_count).toBe(1);
    expect(mocks.handleMessage).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('si la recepción pausa el bot antes de que responda, after() no envía', async () => {
    await webhook(signedRequest('/api/whatsapp', inbound()));
    // La recepción toma la conversación antes de que corra after().
    db.conversations[0].bot_paused = true;
    expect(await flushAfter()).toBe(1);
    expect(mocks.handleMessage).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('un número To no registrado se descarta con 200 y no crea nada', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await webhook(signedRequest('/api/whatsapp', inbound({ To: 'whatsapp:+15550009999' })));
    await flushAfter();

    expect(res.status).toBe(200);
    expect(db.patients).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('+15550009999'));
    warn.mockRestore();
  });

  it('con la suscripción inactiva guarda el mensaje y responde un texto fijo sin IA', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const status of ['canceled', 'past_due'] as const) {
      db.reset();
      db.clinics.push({ id: CLINIC_A, whatsapp_from: SANDBOX, subscription_status: status });
      mocks.sendWhatsApp.mockClear();
      await webhook(signedRequest('/api/whatsapp', inbound()));
      await flushAfter();

      expect(db.messages.filter((m) => m.direction === 'in')).toHaveLength(1);
      expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
      expect(mocks.sendWhatsApp.mock.calls[0][0]).toMatchObject({ to: NEW_PHONE, body: SUBSCRIPTION_INACTIVE_REPLY });
      expect(db.messages.find((m) => m.sender === 'bot')?.body).toBe(SUBSCRIPTION_INACTIVE_REPLY);
    }
    expect(mocks.handleMessage).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('con la suscripción inactiva y el bot pausado no responde', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.clinics[0].subscription_status = 'canceled';
    await webhook(signedRequest('/api/whatsapp', inbound()));
    await flushAfter();
    db.conversations[0].bot_paused = true;
    mocks.sendWhatsApp.mockClear();
    await webhook(signedRequest('/api/whatsapp', inbound({ MessageSid: 'SM00000000000000000000000000000002' })));
    await flushAfter();
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sin bot en el plan no guarda nada ni llama al agente, y responde el texto fijo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.clinics[0].bot_enabled = false;
    const res = await webhook(signedRequest('/api/whatsapp', inbound()));

    // Twilio recibe 200 y TwiML vacío de inmediato (si no, reintentaría); la respuesta va en after().
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<Response></Response>');
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(await flushAfter()).toBe(1);

    expect(db.patients).toHaveLength(0);
    expect(db.conversations).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    expect(mocks.handleMessage).not.toHaveBeenCalled();
    // From = número del consultorio (To del webhook); To = From original del paciente (con +521).
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(mocks.sendWhatsApp.mock.calls[0][0]).toEqual({
      from: SANDBOX,
      to: NEW_PHONE,
      body: BOT_DISABLED_REPLY,
    });
    // Solo queda la marca del límite (consultorio + teléfono normalizado), sin contenido.
    expect([...db.disabledReplies.keys()]).toEqual([`${CLINIC_A}|${NEW_PHONE_NORMALIZED}`]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(SANDBOX));
    warn.mockRestore();
  });

  it('sin bot en el plan responde una sola vez cada 24 h por número (+521 y +52 cuentan igual)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.clinics[0].bot_enabled = false;
    await webhook(signedRequest('/api/whatsapp', inbound()));
    await webhook(
      signedRequest('/api/whatsapp', inbound({ MessageSid: 'SM00000000000000000000000000000002', Body: 'sigo aquí' })),
    );
    // Mismo celular escrito sin el 1 (+52): es el mismo número.
    await webhook(
      signedRequest(
        '/api/whatsapp',
        inbound({ MessageSid: 'SM00000000000000000000000000000003', From: `whatsapp:${NEW_PHONE_NORMALIZED}` }),
      ),
    );
    // Reintento de Twilio con el mismo MessageSid: tampoco.
    await webhook(signedRequest('/api/whatsapp', inbound()));
    await flushAfter();
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);

    // Otro paciente sí recibe su respuesta.
    await webhook(
      signedRequest(
        '/api/whatsapp',
        inbound({ MessageSid: 'SM00000000000000000000000000000004', From: 'whatsapp:+5215599990000' }),
      ),
    );
    await flushAfter();
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(2);
    expect(mocks.sendWhatsApp.mock.calls[1][0]).toMatchObject({ to: '+5215599990000', body: BOT_DISABLED_REPLY });

    // Pasadas 24 h se vuelve a responder al primero.
    db.disabledReplies.set(`${CLINIC_A}|${NEW_PHONE_NORMALIZED}`, Date.now() - 24 * 60 * 60 * 1000 - 1);
    await webhook(
      signedRequest('/api/whatsapp', inbound({ MessageSid: 'SM00000000000000000000000000000005' })),
    );
    await flushAfter();
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(3);
    expect(mocks.sendWhatsApp.mock.calls[2][0]).toMatchObject({ to: NEW_PHONE, body: BOT_DISABLED_REPLY });

    expect(db.patients).toHaveLength(0);
    expect(db.conversations).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    expect(mocks.handleMessage).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sin bot en el plan no envía los otros textos fijos (suscripción inactiva o multimedia)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.clinics[0].bot_enabled = false;
    db.clinics[0].subscription_status = 'canceled';
    const first = await webhook(
      signedRequest('/api/whatsapp', inbound({ Body: '', NumMedia: '1' })),
    );
    await flushAfter();

    expect(first.status).toBe(200);
    expect(db.patients).toHaveLength(0);
    expect(db.conversations).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    expect(mocks.handleMessage).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(mocks.sendWhatsApp.mock.calls[0][0].body).toBe(BOT_DISABLED_REPLY);
    warn.mockRestore();
  });

  it('sin bot en el plan no toca la conversación de un paciente que ya escribía', async () => {
    // Con bot: queda guardado el primer mensaje.
    await webhook(signedRequest('/api/whatsapp', inbound()));
    await flushAfter();
    expect(db.messages.filter((m) => m.direction === 'in')).toHaveLength(1);
    const before = structuredClone(db.conversations[0]);
    const messagesBefore = structuredClone(db.messages);
    mocks.handleMessage.mockClear();
    mocks.sendWhatsApp.mockClear();

    // La cuenta pierde el bot: el siguiente mensaje se descarta y se responde el texto fijo.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.clinics[0].bot_enabled = false;
    const res = await webhook(
      signedRequest('/api/whatsapp', inbound({ MessageSid: 'SM00000000000000000000000000000002' })),
    );
    await flushAfter();

    expect(res.status).toBe(200);
    expect(db.messages).toEqual(messagesBefore);
    expect(db.conversations[0]).toEqual(before);
    expect(mocks.handleMessage).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(mocks.sendWhatsApp.mock.calls[0][0]).toEqual({ from: SANDBOX, to: NEW_PHONE, body: BOT_DISABLED_REPLY });
    warn.mockRestore();
  });

  it('sin bot en el plan, si Twilio falla la ruta responde 200, se reporta y el turno se libera para reintentar', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.clinics[0].bot_enabled = false;

    // Twilio devuelve el error (sendWhatsApp no lanza).
    mocks.sendWhatsApp.mockResolvedValueOnce({ sid: null, status: 'failed', errorCode: '63016' });
    const res = await webhook(signedRequest('/api/whatsapp', inbound()));
    expect(res.status).toBe(200);
    await expect(flushAfter()).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('consultorio sin bot (error 63016)'),
      expect.any(Error),
    );

    // El turno se liberó: el siguiente mensaje del mismo número vuelve a intentar.
    mocks.sendWhatsApp.mockResolvedValueOnce({ sid: 'SMok', status: 'queued' });
    await webhook(signedRequest('/api/whatsapp', inbound({ MessageSid: 'SM00000000000000000000000000000002' })));
    await flushAfter();
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(2);

    // Ya se respondió bien: un tercer mensaje no manda otro.
    await webhook(signedRequest('/api/whatsapp', inbound({ MessageSid: 'SM00000000000000000000000000000004' })));
    await flushAfter();
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(2);

    // El sender lanza (error inesperado): after() lo atrapa y la ruta ya respondió 200.
    mocks.sendWhatsApp.mockRejectedValueOnce(new Error('red caída'));
    const other = await webhook(
      signedRequest(
        '/api/whatsapp',
        inbound({ MessageSid: 'SM00000000000000000000000000000003', From: 'whatsapp:+5215599990000' }),
      ),
    );
    expect(other.status).toBe(200);
    await expect(flushAfter()).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith('Error respondiendo a un consultorio sin bot:', expect.any(Error));
    // Si el sender lanzó, el turno también se liberó.
    expect(db.disabledReplies.has(`${CLINIC_A}|+525599990000`)).toBe(false);

    expect(db.patients).toHaveLength(0);
    expect(db.conversations).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    warn.mockRestore();
    error.mockRestore();
  });

  it('un número To no registrado no recibe el texto de consultorio sin bot', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    db.clinics[0].bot_enabled = false;
    const res = await webhook(signedRequest('/api/whatsapp', inbound({ To: 'whatsapp:+15550009999' })));
    expect(res.status).toBe(200);
    expect(await flushAfter()).toBe(0);
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(db.disabledReplies.size).toBe(0);
    warn.mockRestore();
  });

  it('multimedia sin texto: guarda el mensaje y pide texto sin IA', async () => {
    await webhook(signedRequest('/api/whatsapp', inbound({ Body: '', NumMedia: '1' })));
    await flushAfter();

    expect(db.messages.find((m) => m.direction === 'in')?.body).toBe('[Mensaje multimedia]');
    expect(mocks.handleMessage).not.toHaveBeenCalled();
    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(mocks.sendWhatsApp.mock.calls[0][0].body).toBe(MEDIA_ONLY_REPLY);
  });

  it('multimedia con texto: responde el bot con el texto', async () => {
    await webhook(signedRequest('/api/whatsapp', inbound({ Body: 'mira mi diente', NumMedia: '1' })));
    await flushAfter();
    expect(mocks.handleMessage).toHaveBeenCalledWith(expect.any(String), 'mira mi diente', expect.anything());
    expect(mocks.sendWhatsApp.mock.calls[0][0].body).toBe(BOT_TEXT);
  });

  it('si el agente falla, responde con el mensaje genérico de error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.handleMessage.mockRejectedValue(new Error('Anthropic caído'));
    await webhook(signedRequest('/api/whatsapp', inbound()));
    await flushAfter();

    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(mocks.sendWhatsApp.mock.calls[0][0].body).toBe(BOT_ERROR_REPLY);
    error.mockRestore();
  });

  it('si Twilio rechaza el envío, el mensaje del bot queda failed con el código', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.sendWhatsApp.mockResolvedValue({ sid: null, status: 'failed', errorCode: '63016' });
    await webhook(signedRequest('/api/whatsapp', inbound()));
    await flushAfter();

    expect(db.messages.find((m) => m.sender === 'bot')).toMatchObject({
      status: 'failed',
      error_code: '63016',
      twilio_sid: null,
    });
    error.mockRestore();
  });
});

describe('POST /api/whatsapp/status', () => {
  async function botMessageSid() {
    await webhook(signedRequest('/api/whatsapp', inbound()));
    await flushAfter();
    return db.messages.find((m) => m.sender === 'bot')!.twilio_sid!;
  }
  const statusParams = (sid: string, status: string, extra: Record<string, string> = {}) => ({
    MessageSid: sid,
    MessageStatus: status,
    AccountSid: 'AC00000000000000000000000000000000',
    To: `whatsapp:${NEW_PHONE}`,
    From: `whatsapp:${SANDBOX}`,
    ...extra,
  });

  it('actualiza el estado del mensaje (sent -> delivered -> read)', async () => {
    const sid = await botMessageSid();
    for (const status of ['sent', 'delivered', 'read']) {
      const res = await statusCallback(signedRequest('/api/whatsapp/status', statusParams(sid, status)));
      expect(res.status).toBe(204);
      expect(db.messages.find((m) => m.twilio_sid === sid)!.status).toBe(status);
    }
    // Un callback atrasado no retrocede el estado.
    await statusCallback(signedRequest('/api/whatsapp/status', statusParams(sid, 'delivered')));
    expect(db.messages.find((m) => m.twilio_sid === sid)!.status).toBe('read');
  });

  it('guarda failed con el ErrorCode (undelivered se trata como failed)', async () => {
    const sid = await botMessageSid();
    const res = await statusCallback(
      signedRequest('/api/whatsapp/status', statusParams(sid, 'undelivered', { ErrorCode: '63016' })),
    );
    expect(res.status).toBe(204);
    expect(db.messages.find((m) => m.twilio_sid === sid)).toMatchObject({
      status: 'failed',
      error_code: '63016',
    });
  });

  it('con firma inválida responde 403 y no cambia nada', async () => {
    const sid = await botMessageSid();
    const res = await statusCallback(
      signedRequest('/api/whatsapp/status', statusParams(sid, 'read'), 'firma-falsa'),
    );
    expect(res.status).toBe(403);
    expect(db.messages.find((m) => m.twilio_sid === sid)!.status).toBe('queued');
  });

  it('ignora estados que no guardamos', async () => {
    const sid = await botMessageSid();
    const res = await statusCallback(signedRequest('/api/whatsapp/status', statusParams(sid, 'receiving')));
    expect(res.status).toBe(204);
    expect(db.messages.find((m) => m.twilio_sid === sid)!.status).toBe('queued');
  });
});
