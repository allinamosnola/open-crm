import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleMessage, toApiMessages, type BotDeps } from '@/lib/bot/agent';
import { createMemoryBotRepository, emptyConversation, type MemoryBotRepository } from '@/lib/bot/memory-repository';
import { SYSTEM_PROMPT } from '@/lib/bot/prompt';
import { EMPTY_REPLY_FALLBACK, ESCALATION_REPLY } from '@/lib/bot/replies';
import { parseBotState } from '@/lib/bot/state';

import {
  CONVERSATION,
  createFixture,
  fakeAnthropic,
  hoursFromNow,
  NOW,
  resultText,
  text,
  toolResults,
  toolUse,
  type FakeAnthropic,
} from './helpers';

const TOOL_NAMES = [
  'buscar_horarios',
  'agendar_cita',
  'mis_citas',
  'cancelar_cita',
  'reagendar_cita',
  'guardar_nombre',
  'escalar_a_recepcion',
];

function deps(repo: MemoryBotRepository, fake: FakeAnthropic, extra: Partial<BotDeps> = {}): BotDeps {
  return { repo, anthropic: fake.client, now: () => NOW, notify: vi.fn(async () => {}), ...extra };
}

// Simula al webhook: guarda el mensaje del paciente, corre el agente y guarda la respuesta.
async function turn(repo: MemoryBotRepository, fake: FakeAnthropic, body: string, extra: Partial<BotDeps> = {}) {
  repo.addMessage(CONVERSATION, 'patient', body);
  const reply = await handleMessage(CONVERSATION, body, deps(repo, fake, extra));
  if (reply) repo.addMessage(CONVERSATION, 'bot', reply);
  return reply;
}

beforeEach(() => {
  // Independiente del entorno de quien corre los tests.
  vi.stubEnv('CLAUDE_MODEL', '');
  vi.stubEnv('CLAUDE_BOT_EFFORT', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loop del agente (Anthropic mockeado)', () => {
  it('busca horarios con la herramienta y responde; manda los parámetros correctos a la API', async () => {
    const repo = createFixture();
    const fake = fakeAnthropic([
      [toolUse('buscar_horarios', { desde: '2026-10-06', hasta: '2026-10-06', parte_del_dia: 'manana' })],
      [text('Tengo estos horarios mañana:\n1. 09:00\n2. 09:30\n3. 10:00\n¿Cuál prefieres?')],
    ]);

    const reply = await turn(repo, fake, 'Quiero una cita mañana en la mañana');
    expect(reply).toContain('¿Cuál prefieres?');
    expect(fake.requests).toHaveLength(2);

    const first = fake.requests[0];
    expect(first.model).toBe('claude-sonnet-5');
    expect(first.output_config).toEqual({ effort: 'low' });
    // Sonnet 5: sin temperature ni budget_tokens (dan 400) y sin prefill.
    expect(first).not.toHaveProperty('temperature');
    expect(first).not.toHaveProperty('thinking');
    expect(first.tools.map((t: { name: string }) => t.name)).toEqual(TOOL_NAMES);
    // Prompt caching: bloque fijo con cache_control; el contexto variable va después, sin él.
    expect(first.system[0]).toEqual({ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } });
    expect(first.system[1].cache_control).toBeUndefined();
    expect(first.system[1].text).toContain('Fecha y hora actuales: lunes, 5 de octubre de 2026, 06:00');
    expect(first.system[1].text).toContain('Paciente: María González');
    expect(first.messages).toEqual([{ role: 'user', content: 'Quiero una cita mañana en la mañana' }]);
    expect(first.messages.at(-1)?.role).toBe('user');

    // El resultado de la herramienta vuelve al modelo con los huecos del martes.
    const [result] = toolResults(fake.requests[1]);
    expect(result.is_error).toBeFalsy();
    const huecos = JSON.parse(resultText(result)).huecos;
    expect(huecos.map((h: { horario: string }) => h.horario)).toEqual([
      'martes 6 de octubre, 09:00',
      'martes 6 de octubre, 09:30',
      'martes 6 de octubre, 10:00',
    ]);

    // Los huecos ofrecidos quedan en bot_state y el candado se soltó.
    const state = parseBotState(repo.data.conversations[0].bot_state);
    expect(state.offered_slots.map((s) => s.id)).toEqual(['H1', 'H2', 'H3']);
    expect(repo.data.conversations[0].lease).toBeNull();
  });

  it('en el siguiente mensaje agenda el hueco elegido con el estado guardado', async () => {
    const repo = createFixture();
    const first = fakeAnthropic([[toolUse('buscar_horarios', {})], [text('1. lunes 09:00 ...')]]);
    await turn(repo, first, 'quiero una cita');

    const second = fakeAnthropic([[toolUse('agendar_cita', { hueco_id: 'H2' })], [text('¡Listo! Te esperamos.')]]);
    const reply = await turn(repo, second, 'la 2 por favor');
    expect(reply).toBe('¡Listo! Te esperamos.');
    expect(repo.data.appointments).toEqual([expect.objectContaining({ source: 'whatsapp', status: 'scheduled' })]);
    // El historial completo va a la API: paciente = user, bot = assistant.
    expect(second.requests[0].messages).toEqual([
      { role: 'user', content: 'quiero una cita' },
      { role: 'assistant', content: '1. lunes 09:00 ...' },
      { role: 'user', content: 'la 2 por favor' },
    ]);
    expect(parseBotState(repo.data.conversations[0].bot_state).offered_slots.map((s) => s.id)).toEqual(['H1', 'H3']);
  });

  it('un hueco no ofrecido o una entrada inválida vuelven al modelo como error', async () => {
    const repo = createFixture();
    const fake = fakeAnthropic([
      [toolUse('agendar_cita', { hueco_id: 'H99' }), toolUse('buscar_horarios', { desde: 'mañana' })],
      [text('Déjame buscar horarios primero.')],
    ]);
    await turn(repo, fake, 'agéndame el martes');
    const results = toolResults(fake.requests[1]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.is_error)).toBe(true);
    expect(resultText(results[0])).toContain('no se ofreció');
    expect(repo.data.appointments).toHaveLength(0);
  });

  it('con menos de 24 h la herramienta rechaza cancelar y el modelo escala: respuesta fija y bot pausado', async () => {
    const repo = createFixture({ appointments: [{ starts_at: hoursFromNow(10), ends_at: hoursFromNow(10.5) }] });
    const notify = vi.fn(async () => {});
    const fake = fakeAnthropic([
      [toolUse('cancelar_cita', { cita_id: 'appt-seed-1' })],
      [toolUse('escalar_a_recepcion', { categoria: 'policy', motivo: 'Quiere cancelar su cita de hoy (menos de 24 h)' })],
      [text('Ya avisé a la recepción.')],
    ]);
    const reply = await turn(repo, fake, 'cancela mi cita de hoy', { notify });

    expect(resultText(toolResults(fake.requests[1])[0])).toContain('menos de 24 horas');
    expect(reply).toBe(ESCALATION_REPLY.policy);
    expect(repo.data.appointments[0].status).toBe('scheduled');
    expect(repo.data.conversations[0]).toMatchObject({
      bot_paused: true,
      needs_attention: true,
      attention_category: 'policy',
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('por defecto avisa por email (Resend mockeado) al correo de la recepción', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', 'bot@demo.local');
    const resend = vi.fn(async () => new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }));
    vi.stubGlobal('fetch', resend);
    try {
      const repo = createFixture();
      const fake = fakeAnthropic([
        [toolUse('escalar_a_recepcion', { categoria: 'human_requested', motivo: 'Quiere hablar con la doctora' })],
        [text('')],
      ]);
      await turn(repo, fake, 'quiero hablar con una persona', { notify: undefined });
      expect(resend).toHaveBeenCalledTimes(1);
      const [url, init] = resend.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      expect(JSON.parse(String(init.body))).toMatchObject({ to: ['recepcion@demo.local'] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sin correo de recepción configurado no intenta enviar email', async () => {
    const resend = vi.fn();
    vi.stubGlobal('fetch', resend);
    try {
      const repo = createFixture({ receptionEmail: null });
      const fake = fakeAnthropic([[toolUse('escalar_a_recepcion', { categoria: 'other', motivo: 'Pregunta precios' })], [text('')]]);
      expect(await turn(repo, fake, '¿cuánto cuesta una limpieza?', { notify: undefined })).toBe(ESCALATION_REPLY.other);
      expect(resend).not.toHaveBeenCalled();
      expect(repo.data.conversations[0].needs_attention).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('urgencia: responde el aviso fijo que recomienda llamar o acudir a urgencias', async () => {
    const repo = createFixture();
    const fake = fakeAnthropic([
      [toolUse('escalar_a_recepcion', { categoria: 'urgent', motivo: 'Dolor fuerte e inflamación' })],
      [text('')],
    ]);
    const reply = await turn(repo, fake, 'me duele muchísimo la muela y se me hinchó la cara');
    expect(reply).toBe(ESCALATION_REPLY.urgent);
    expect(reply).toContain('urgencias');
  });

  it('dos turnos seguidos sin entender escalan como not_understood', async () => {
    const repo = createFixture();
    const one = await turn(repo, fakeAnthropic([[text('[no_entendi] Perdón, ¿me lo explicas de otra forma?')]]), 'asdf qwer');
    expect(one).toBe('Perdón, ¿me lo explicas de otra forma?');
    expect(parseBotState(repo.data.conversations[0].bot_state).not_understood).toBe(1);

    const two = await turn(repo, fakeAnthropic([[text('[no_entendi] ¿Podrías repetirlo?')]]), 'zxcv');
    expect(two).toBe(ESCALATION_REPLY.not_understood);
    expect(repo.data.conversations[0]).toMatchObject({ needs_attention: true, attention_category: 'not_understood' });
    expect(parseBotState(repo.data.conversations[0].bot_state).not_understood).toBe(0);
  });

  it('un turno entendido reinicia el contador', async () => {
    const repo = createFixture();
    await turn(repo, fakeAnthropic([[text('[no_entendi] ¿Cómo?')]]), 'jjj');
    await turn(repo, fakeAnthropic([[text('Claro, ¿para cuándo?')]]), 'quiero una cita');
    expect(parseBotState(repo.data.conversations[0].bot_state).not_understood).toBe(0);
    expect(repo.data.conversations[0].needs_attention).toBe(false);
  });

  it('sin texto final responde un mensaje de respaldo', async () => {
    const repo = createFixture();
    expect(await turn(repo, fakeAnthropic([[text('')]]), 'hola')).toBe(EMPTY_REPLY_FALLBACK);
  });

  it('usa CLAUDE_MODEL y CLAUDE_BOT_EFFORT si están definidos', async () => {
    vi.stubEnv('CLAUDE_MODEL', 'claude-sonnet-5-custom');
    vi.stubEnv('CLAUDE_BOT_EFFORT', 'medium');
    const fake = fakeAnthropic([[text('Hola')]]);
    await turn(createFixture(), fake, 'hola');
    expect(fake.requests[0]).toMatchObject({ model: 'claude-sonnet-5-custom', output_config: { effort: 'medium' } });
  });

  it('si la API falla, lanza (el canal responde el error genérico) y suelta el candado', async () => {
    const repo = createFixture();
    const fake = fakeAnthropic([]); // sin guion: la API responde 400
    repo.addMessage(CONVERSATION, 'patient', 'hola');
    await expect(handleMessage(CONVERSATION, 'hola', deps(repo, fake))).rejects.toThrow();
    expect(repo.data.conversations[0].lease).toBeNull();
  });

  it('con el bot pausado o si el último mensaje ya tiene respuesta, no llama a la API', async () => {
    const repo = createFixture();
    const fake = fakeAnthropic([[text('no debería llamarse')]]);
    repo.data.conversations[0].bot_paused = true;
    expect(await turn(repo, fake, 'hola')).toBe('');

    repo.data.conversations[0].bot_paused = false;
    repo.addMessage(CONVERSATION, 'bot', 'ya respondí');
    expect(await handleMessage(CONVERSATION, 'hola', deps(repo, fake))).toBe('');
    expect(fake.requests).toHaveLength(0);
  });
});

describe('historial', () => {
  it('paciente = user, bot = assistant y recepción = assistant con etiqueta; empieza con user', () => {
    const at = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();
    expect(
      toApiMessages([
        { direction: 'out', sender: 'bot', body: 'mensaje viejo del bot', created_at: at(0) },
        { direction: 'in', sender: 'patient', body: 'hola', created_at: at(1) },
        { direction: 'out', sender: 'staff', body: 'Te atiende Laura', created_at: at(2) },
        { direction: 'in', sender: 'patient', body: '  ', created_at: at(3) },
        { direction: 'in', sender: 'patient', body: 'gracias', created_at: at(4) },
      ]),
    ).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: '[Recepción] Te atiende Laura' },
      { role: 'user', content: 'gracias' },
    ]);
  });
});

describe('candado por conversación', () => {
  it('dos mensajes simultáneos: un turno a la vez y no se responde dos veces', async () => {
    const repo = createFixture();
    // Llegan dos mensajes casi juntos (el webhook ya guardó ambos).
    repo.addMessage(CONVERSATION, 'patient', 'hola');
    repo.addMessage(CONVERSATION, 'patient', 'quiero una cita');
    const fake = fakeAnthropic([[text('¡Hola! ¿Para qué día quieres tu cita?')], [text('respuesta duplicada')]], {
      delayMs: 50,
    });

    const run = (body: string) =>
      handleMessage(CONVERSATION, body, deps(repo, fake)).then((reply) => {
        if (reply) repo.addMessage(CONVERSATION, 'bot', reply);
        return reply;
      });
    const [a, b] = await Promise.all([run('hola'), run('quiero una cita')]);

    // El primero respondió a los dos mensajes; el segundo esperó el candado y,
    // como el último mensaje ya tenía respuesta, no volvió a llamar a Claude.
    expect([a, b].filter(Boolean)).toEqual(['¡Hola! ¿Para qué día quieres tu cita?']);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].messages).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'user', content: 'quiero una cita' },
    ]);
  });

  it('el segundo turno corre después del primero y ve su estado', async () => {
    const repo = createFixture();
    repo.addMessage(CONVERSATION, 'patient', 'quiero una cita');
    const fake = fakeAnthropic(
      [[toolUse('buscar_horarios', {})], [text('Opciones: ...')], [toolUse('buscar_horarios', {})], [text('Más opciones')]],
      { delayMs: 30 },
    );
    const first = handleMessage(CONVERSATION, 'quiero una cita', deps(repo, fake)).then((reply) => {
      repo.addMessage(CONVERSATION, 'bot', reply);
      // Llega otro mensaje después de la respuesta.
      repo.addMessage(CONVERSATION, 'patient', 'otras opciones');
    });
    const second = handleMessage(CONVERSATION, 'otras opciones', deps(repo, fake));
    await Promise.all([first, second]);

    // Sin traslape de llamadas: la tercera empezó después de que terminó la segunda.
    expect(fake.timeline).toHaveLength(4);
    expect(fake.timeline[2].start).toBeGreaterThanOrEqual(fake.timeline[1].end);
    // El segundo turno partió del estado del primero (H1-H3) y agregó H4-H6.
    expect(parseBotState(repo.data.conversations[0].bot_state).offered_slots.map((s) => s.id)).toEqual([
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
    ]);
  });

  it('el candado vence (proceso caído) y un token viejo no pisa el estado nuevo', async () => {
    let now = 0;
    const repo = createMemoryBotRepository(
      { conversations: [emptyConversation('c', 'clinic', 'p')] },
      { clock: () => now },
    );
    const first = await repo.acquireTurn('c', 90);
    expect(first.acquired).toBe(true);
    expect((await repo.acquireTurn('c', 90)).acquired).toBe(false);

    now += 91_000;
    const second = await repo.acquireTurn('c', 90);
    expect(second.acquired).toBe(true);
    if (!first.acquired || !second.acquired) throw new Error('inalcanzable');
    expect(await repo.releaseTurn('c', first.token, { offered_slots: [], slot_seq: 99, not_understood: 0 })).toBe(false);
    expect(await repo.releaseTurn('c', second.token, { offered_slots: [], slot_seq: 1, not_understood: 0 })).toBe(true);
    expect(repo.data.conversations[0].bot_state).toMatchObject({ slot_seq: 1 });
  });

  it('si no obtiene el turno a tiempo, no responde', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const repo = createFixture();
    await repo.acquireTurn(CONVERSATION, 90);
    const fake = fakeAnthropic([[text('no')]]);
    repo.addMessage(CONVERSATION, 'patient', 'hola');
    expect(await handleMessage(CONVERSATION, 'hola', deps(repo, fake, { waitForTurnMs: 300 }))).toBe('');
    expect(fake.requests).toHaveLength(0);
    error.mockRestore();
  });
});
