import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BOT_REQUIRED_TO_MANAGE, BOT_REQUIRED_TO_REPLY } from '@/lib/db/plan-limits';

// Server actions de la bandeja (src/lib/db/conversations.ts) con un plan sin
// bot: deben rechazarse en el servidor sin escribir en la base ni llamar a
// Twilio, aunque el panel ya oculte la bandeja.

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  botEnabled: true,
  // Operaciones que llegaron a la base: `${tabla}.${operación}`.
  writes: [] as string[],
  reads: [] as string[],
  deliverMessage: vi.fn<(supabase: unknown, params: Record<string, unknown>) => Promise<unknown>>(async () => ({
    sid: 'SMout1',
    status: 'queued',
    errorCode: null,
  })),
  redeliverFailedMessage: vi.fn<(supabase: unknown, params: Record<string, unknown>) => Promise<unknown>>(),
  // Mensaje que devuelve la lectura de messages (reintento manual).
  message: null as Row | null,
}));

const CONVERSATION = {
  id: 'conversation-1',
  patient_id: 'patient-1',
  phone: '+5215588887777',
  bot_paused: false,
  clinic: { whatsapp_from: '+14155238886' },
};

// Cliente con la sesión: my_entitlements() + una consulta encadenable mínima.
function createServerFake() {
  class Query implements PromiseLike<{ data: unknown; error: null }> {
    private op: 'select' | 'insert' | 'update' = 'select';
    private payload: Row = {};
    constructor(private table: string) {}
    select() {
      return this;
    }
    insert(payload: Row) {
      this.op = 'insert';
      this.payload = payload;
      return this;
    }
    update(payload: Row) {
      this.op = 'update';
      this.payload = payload;
      return this;
    }
    eq() {
      return this;
    }
    maybeSingle() {
      return this;
    }
    single() {
      return this;
    }
    private exec() {
      if (this.op === 'select') {
        state.reads.push(`${this.table}.select`);
        if (this.table === 'messages') return { data: state.message, error: null };
        return { data: this.table === 'conversations' ? CONVERSATION : null, error: null };
      }
      state.writes.push(`${this.table}.${this.op}`);
      if (this.table === 'messages') return { data: { id: 'message-1' }, error: null };
      return { data: { ...CONVERSATION, ...this.payload }, error: null };
    }
    then<A, B>(
      onfulfilled?: ((value: { data: unknown; error: null }) => A | PromiseLike<A>) | null,
      onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
    }
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-laura' } }, error: null }) },
    from: (table: string) => new Query(table),
    async rpc(fn: string) {
      if (fn !== 'my_entitlements') throw new Error(`rpc no simulada: ${fn}`);
      return { data: [{ clinic_id: 'clinic-a', bot_enabled: state.botEnabled }], error: null };
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => createServerFake() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/whatsapp/outbound', () => ({
  deliverMessage: state.deliverMessage,
  redeliverFailedMessage: state.redeliverFailedMessage,
}));

const { markRead, markResolved, retryFailedMessage, sendStaffMessage, setBotPaused } = await import(
  '@/lib/db/conversations'
);

beforeEach(() => {
  state.botEnabled = true;
  state.writes = [];
  state.reads = [];
  state.deliverMessage.mockClear();
  state.redeliverFailedMessage.mockReset().mockResolvedValue({ sid: 'SMretry', status: 'queued', errorCode: null });
  state.message = null;
});

describe('sendStaffMessage', () => {
  it('sin bot en el plan se rechaza sin guardar nada ni llamar a Twilio', async () => {
    state.botEnabled = false;
    const result = await sendStaffMessage({ conversation_id: '00000000-0000-4000-8000-000000000001', body: 'Hola' });
    expect(result).toEqual({ ok: false, error: BOT_REQUIRED_TO_REPLY });
    expect(result.ok === false && result.error).toBe(
      'Tu plan no incluye WhatsApp. Sube de plan para responder mensajes.',
    );
    expect(state.writes).toEqual([]);
    expect(state.reads).toEqual([]);
    expect(state.deliverMessage).not.toHaveBeenCalled();
  });

  it('con bot en el plan guarda, pausa el bot y envía', async () => {
    const result = await sendStaffMessage({ conversation_id: '00000000-0000-4000-8000-000000000001', body: 'Hola' });
    expect(result).toEqual({ ok: true, data: { id: 'message-1', status: 'queued' } });
    expect(state.writes).toEqual(['messages.insert', 'conversations.update']);
    expect(state.deliverMessage).toHaveBeenCalledTimes(1);
    expect(state.deliverMessage.mock.calls[0][1]).toMatchObject({
      messageId: 'message-1',
      from: '+14155238886',
      to: '+5215588887777',
      body: 'Hola',
    });
  });
});

describe('otras acciones de la bandeja', () => {
  const actions = {
    markRead: () => markRead('conversation-1'),
    setBotPaused: () => setBotPaused('conversation-1', false),
    markResolved: () => markResolved('conversation-1', { resumeBot: true }),
  };

  for (const [name, run] of Object.entries(actions)) {
    it(`${name}: sin bot se rechaza sin escribir; con bot escribe`, async () => {
      state.botEnabled = false;
      expect(await run()).toEqual({ ok: false, error: BOT_REQUIRED_TO_MANAGE });
      expect(state.writes).toEqual([]);

      state.botEnabled = true;
      expect((await run()).ok).toBe(true);
      expect(state.writes).toEqual(['conversations.update']);
    });
  }
});

describe('retryFailedMessage', () => {
  const MESSAGE_ID = '00000000-0000-4000-8000-0000000000aa';
  const failed = (extra: Row = {}) => ({
    id: MESSAGE_ID,
    direction: 'out',
    status: 'failed',
    body: 'Te esperamos mañana',
    conversation: CONVERSATION,
    ...extra,
  });

  it('reenvía un mensaje saliente fallido con el número del consultorio', async () => {
    state.message = failed();
    const result = await retryFailedMessage(MESSAGE_ID);
    expect(result).toEqual({ ok: true, data: { id: MESSAGE_ID, status: 'queued' } });
    expect(state.redeliverFailedMessage.mock.calls[0][1]).toEqual({
      messageId: MESSAGE_ID,
      from: '+14155238886',
      to: '+5215588887777',
      body: 'Te esperamos mañana',
    });
  });

  it('rechaza mensajes que no fallaron o entrantes, y ids inválidos', async () => {
    state.message = failed({ status: 'delivered' });
    expect((await retryFailedMessage(MESSAGE_ID)).ok).toBe(false);
    state.message = failed({ direction: 'in' });
    expect((await retryFailedMessage(MESSAGE_ID)).ok).toBe(false);
    state.message = null;
    expect(await retryFailedMessage(MESSAGE_ID)).toEqual({ ok: false, error: 'El mensaje no existe' });
    expect(await retryFailedMessage('x')).toEqual({ ok: false, error: 'Mensaje inválido' });
    expect(state.redeliverFailedMessage).not.toHaveBeenCalled();
  });

  it('si otro reintento ya lo tomó, no reenvía dos veces', async () => {
    state.message = failed();
    state.redeliverFailedMessage.mockResolvedValue(null);
    expect(await retryFailedMessage(MESSAGE_ID)).toEqual({ ok: false, error: 'El mensaje ya se está reenviando' });
  });

  it('si vuelve a fallar devuelve el error de Twilio para mostrarlo', async () => {
    state.message = failed();
    state.redeliverFailedMessage.mockResolvedValue({ sid: null, status: 'failed', errorCode: '63016' });
    const result = await retryFailedMessage(MESSAGE_ID);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/24 h/);
  });

  it('sin bot en el plan se rechaza sin leer ni reenviar', async () => {
    state.botEnabled = false;
    state.message = failed();
    expect(await retryFailedMessage(MESSAGE_ID)).toEqual({ ok: false, error: BOT_REQUIRED_TO_REPLY });
    expect(state.reads).toEqual([]);
    expect(state.redeliverFailedMessage).not.toHaveBeenCalled();
  });
});
