import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  me: null as unknown,
  account: null as unknown,
  clinicsUsed: 1,
  subItems: [] as { id: string; price: { lookup_key: string | null }; quantity: number }[],
  update: vi.fn(),
  retrieve: vi.fn(),
}));

vi.mock('@/lib/observability', () => ({ reportError: () => {} }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/db/staff', () => ({ getCurrentStaff: async () => m.me }));
vi.mock('@/lib/db/account', () => ({
  getEntitlements: async () => ({ clinics_used: m.clinicsUsed }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, single: async () => ({ data: m.account, error: null }) };
      return q;
    },
  }),
}));
vi.mock('@/lib/stripe/config', () => ({
  getStripe: () => ({ subscriptions: { retrieve: m.retrieve, update: m.update } }),
  getPlanPrices: async () => ({
    basic: { id: 'p_basic', amount: 699, currency: 'mxn' },
    pro: { id: 'p_pro', amount: 2990, currency: 'mxn' },
    plus: { id: 'p_plus', amount: 5990, currency: 'mxn' },
    bot: { id: 'p_bot', amount: 899, currency: 'mxn' },
    extraClinic: { id: 'p_extra', amount: 999, currency: 'mxn' },
  }),
}));

import { changePlan } from '@/lib/stripe/actions';

const owner = { role: 'owner', clinic: { account: { account_id: 'acc_1' } } };

beforeEach(() => {
  m.me = owner;
  m.account = { id: 'acc_1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', billing_status: 'active' };
  m.clinicsUsed = 1;
  m.subItems = [{ id: 'si_1', price: { lookup_key: 'citabot_basic' }, quantity: 1 }];
  m.update.mockReset().mockResolvedValue({});
  m.retrieve.mockReset().mockImplementation(async () => ({ id: 'sub_1', items: { data: m.subItems } }));
});

describe('changePlan', () => {
  it('solo el owner puede cambiar el plan', async () => {
    m.me = { ...owner, role: 'dentist' };
    const result = await changePlan({ plan: 'pro' });
    expect(result.ok).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('rechaza una cuenta sin suscripción vigente', async () => {
    m.account = { id: 'acc_1', stripe_subscription_id: 'sub_1', billing_status: 'canceled' };
    expect((await changePlan({ plan: 'pro' })).ok).toBe(false);
    m.account = { id: 'acc_1', stripe_subscription_id: null, billing_status: null };
    expect((await changePlan({ plan: 'pro' })).ok).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('rechaza el Bot fuera de Básico y los planes inválidos', async () => {
    expect((await changePlan({ plan: 'pro', botAddon: true })).ok).toBe(false);
    expect((await changePlan({ plan: 'gratis' as never })).ok).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('no hace nada si ya tiene ese plan', async () => {
    const result = await changePlan({ plan: 'basic' });
    expect(result).toMatchObject({ ok: false, error: 'Tu cuenta ya tiene ese plan' });
    expect(m.update).not.toHaveBeenCalled();
  });

  it('agrega el Bot con prorrateo inmediato y sin dejar el cambio a medias si falla el cobro', async () => {
    const result = await changePlan({ plan: 'basic', botAddon: true });
    expect(result.ok).toBe(true);
    expect(m.update).toHaveBeenCalledWith('sub_1', {
      items: [{ price: 'p_bot', quantity: 1 }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'error_if_incomplete',
    });
  });

  it('Básico + Bot -> Pro cambia el precio y quita el Bot', async () => {
    m.subItems.push({ id: 'si_2', price: { lookup_key: 'citabot_bot' }, quantity: 1 });
    await changePlan({ plan: 'pro' });
    expect(m.update.mock.calls[0][1].items).toEqual([
      { id: 'si_1', price: 'p_pro' },
      { id: 'si_2', deleted: true },
    ]);
  });

  it('Plus usa los consultorios actuales para los extras', async () => {
    m.clinicsUsed = 7;
    await changePlan({ plan: 'plus' });
    expect(m.update.mock.calls[0][1].items).toEqual([
      { id: 'si_1', price: 'p_plus' },
      { price: 'p_extra', quantity: 2 },
    ]);
  });

  it('devuelve un error legible si Stripe rechaza el cambio', async () => {
    m.update.mockRejectedValue(new Error('card_declined'));
    const result = await changePlan({ plan: 'pro' });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/No se pudo cambiar el plan/);
  });
});
