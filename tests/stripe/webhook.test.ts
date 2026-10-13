import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Base de datos en memoria (stripe_events, accounts, rpc) y Stripe mockeado
// salvo la verificación de la firma, que usa el SDK real (sin red).
// ---------------------------------------------------------------------------
const SECRET = 'whsec_test';

const state = vi.hoisted(() => ({
  events: new Map<string, { processed_at: string | null }>(),
  account: { stripe_subscription_id: null as string | null },
  rpcCalls: [] as Record<string, unknown>[],
  rpcError: null as { message: string } | null,
  subscription: null as unknown,
}));

vi.mock('@sentry/nextjs', () => ({ flush: async () => true, captureException: () => {} }));
vi.mock('@/lib/observability', () => ({ reportError: () => {} }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === 'stripe_events') {
        let eventId = '';
        const q = {
          upsert(row: { event_id: string }) {
            if (!state.events.has(row.event_id)) state.events.set(row.event_id, { processed_at: null });
            return Promise.resolve({ error: null });
          },
          select: () => q,
          update(values: { processed_at: string }) {
            return {
              eq(_c: string, id: string) {
                state.events.get(id)!.processed_at = values.processed_at;
                return Promise.resolve({ error: null });
              },
            };
          },
          eq(_c: string, id: string) {
            eventId = id;
            return q;
          },
          single: () => Promise.resolve({ data: state.events.get(eventId), error: null }),
        };
        return q;
      }
      // accounts
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: () => Promise.resolve({ data: state.account, error: null }),
      };
      return q;
    },
    rpc(_fn: string, args: Record<string, unknown>) {
      state.rpcCalls.push(args);
      return Promise.resolve({ error: state.rpcError });
    },
  }),
}));
vi.mock('@/lib/stripe/config', () => ({
  getStripe: () => ({
    webhooks: new Stripe('sk_test_x').webhooks,
    subscriptions: { retrieve: async () => state.subscription },
  }),
  getWebhookSecret: () => SECRET,
}));

import { POST } from '@/app/api/stripe/webhook/route';

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    metadata: { account_id: 'acc_1' },
    items: { data: [{ price: { id: 'price_x', lookup_key: 'citabot_pro' }, quantity: 1 }] },
    ...overrides,
  };
}

function signed(event: object, secret = SECRET) {
  const payload = JSON.stringify(event);
  const header = new Stripe('sk_test_x').webhooks.generateTestHeaderString({ payload, secret });
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': header },
    body: payload,
  });
}

const updated = (id = 'evt_1') => ({
  id,
  object: 'event',
  type: 'customer.subscription.updated',
  data: { object: { id: 'sub_1' } },
});

beforeEach(() => {
  state.events.clear();
  state.account = { stripe_subscription_id: null };
  state.rpcCalls = [];
  state.rpcError = null;
  state.subscription = subscription();
});

describe('POST /api/stripe/webhook', () => {
  it('rechaza una petición sin firma o con firma inválida', async () => {
    const noSig = new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: '{}' });
    expect((await POST(noSig)).status).toBe(400);
    expect((await POST(signed(updated(), 'whsec_otro'))).status).toBe(400);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('aplica la suscripción y marca el evento como procesado', async () => {
    const res = await POST(signed(updated()));
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toEqual([
      {
        p_account_id: 'acc_1',
        p_plan: 'pro',
        p_bot_addon: false,
        p_extra_clinics: 0,
        p_customer_id: 'cus_1',
        p_subscription_id: 'sub_1',
        p_billing_status: 'active',
        p_clinic_status: 'active',
      },
    ]);
    expect(state.events.get('evt_1')?.processed_at).not.toBeNull();
  });

  it('no repite un evento ya procesado', async () => {
    await POST(signed(updated()));
    await POST(signed(updated()));
    expect(state.rpcCalls).toHaveLength(1);
  });

  it('responde 500 y deja el evento pendiente si falla la base, para que Stripe reintente', async () => {
    state.rpcError = { message: 'boom' };
    expect((await POST(signed(updated()))).status).toBe(500);
    expect(state.events.get('evt_1')?.processed_at).toBeNull();

    state.rpcError = null;
    expect((await POST(signed(updated()))).status).toBe(200);
    expect(state.rpcCalls).toHaveLength(2);
  });

  it('el impago deja los consultorios en past_due', async () => {
    state.subscription = subscription({ status: 'past_due' });
    await POST(signed(updated()));
    expect(state.rpcCalls[0]).toMatchObject({ p_clinic_status: 'past_due', p_billing_status: 'past_due' });
  });

  it('una suscripción vieja cancelada no cancela la cuenta que ya tiene otra', async () => {
    state.account = { stripe_subscription_id: 'sub_nueva' };
    state.subscription = subscription({ status: 'canceled' });
    expect((await POST(signed(updated()))).status).toBe(200);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('ignora una suscripción sin cuenta y los eventos que no usa', async () => {
    state.subscription = subscription({ metadata: {} });
    state.account = null as never;
    expect((await POST(signed(updated('evt_a')))).status).toBe(200);
    const other = { id: 'evt_b', object: 'event', type: 'invoice.paid', data: { object: {} } };
    expect((await POST(signed(other))).status).toBe(200);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('checkout.session.completed sincroniza la suscripción de la sesión', async () => {
    const event = {
      id: 'evt_c',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription: 'sub_1' } },
    };
    expect((await POST(signed(event))).status).toBe(200);
    expect(state.rpcCalls).toHaveLength(1);
  });
});
