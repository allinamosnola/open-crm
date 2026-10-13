import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  url: 'https://checkout.stripe.com/c/pay/cs_1' as string | null,
  failPrices: false,
}));

vi.mock('@/lib/observability', () => ({ reportError: () => {} }));
vi.mock('next/navigation', () => ({
  // Igual que Next: redirect() lanza para cortar la ejecución.
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { redirectTo: url });
  },
}));
vi.mock('@/lib/site', () => ({
  PRIVACY_URL: 'https://ejemplo.com/privacidad',
  appUrl: () => 'https://citabot.test',
}));
vi.mock('@/lib/stripe/config', () => ({
  getPlanPrices: async () => {
    if (state.failPrices) throw new Error('sin precios');
    return {
      basic: { id: 'price_basic' },
      pro: { id: 'price_pro' },
      plus: { id: 'price_plus' },
      bot: { id: 'price_bot' },
      extraClinic: { id: 'price_extra' },
    };
  },
  getStripe: () => ({
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          state.created.push(params);
          return { url: state.url };
        },
      },
    },
  }),
}));

import { startPublicCheckout } from '@/lib/stripe/public-checkout';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

async function run(fields: Record<string, string>) {
  try {
    return await startPublicCheckout(null, form(fields));
  } catch (error) {
    return { redirectTo: (error as { redirectTo?: string }).redirectTo ?? String(error) };
  }
}

beforeEach(() => {
  state.created = [];
  state.url = 'https://checkout.stripe.com/c/pay/cs_1';
  state.failPrices = false;
});

describe('startPublicCheckout', () => {
  it('crea la sesión sin cuenta y redirige a Stripe', async () => {
    expect(await run({ plan: 'pro' })).toEqual({ redirectTo: 'https://checkout.stripe.com/c/pay/cs_1' });
    expect(state.created[0]).toMatchObject({
      mode: 'subscription',
      line_items: [{ price: 'price_pro', quantity: 1 }],
      metadata: { source: 'landing' },
      subscription_data: { metadata: { source: 'landing' } },
      success_url: 'https://citabot.test/contratar/gracias',
      cancel_url: 'https://citabot.test/#tarifas',
      automatic_tax: { enabled: true },
    });
    expect(state.created[0]).not.toHaveProperty('client_reference_id');
    expect(state.created[0].custom_fields).toMatchObject([{ key: 'nombre_consultorio', type: 'text' }]);
    expect(JSON.stringify(state.created[0].custom_text)).toContain('https://ejemplo.com/privacidad');
  });

  it('Básico con la casilla del Bot agrega el ítem Bot', async () => {
    await run({ plan: 'basic', botAddon: 'on' });
    expect(state.created[0].line_items).toEqual([
      { price: 'price_basic', quantity: 1 },
      { price: 'price_bot', quantity: 1 },
    ]);
  });

  it('rechaza un plan inválido, el Bot fuera de Básico y el campo trampa', async () => {
    expect(await run({ plan: 'oro' })).toEqual({ error: 'Plan inválido' });
    expect(await run({ plan: 'pro', botAddon: 'on' })).toEqual({
      error: 'El complemento Bot solo aplica al plan Básico',
    });
    expect(await run({ plan: 'pro', sitio_web: 'http://spam' })).toHaveProperty('error');
    expect(state.created).toHaveLength(0);
  });

  it('si Stripe falla devuelve un error en lugar de redirigir', async () => {
    state.failPrices = true;
    expect(await run({ plan: 'pro' })).toEqual({ error: 'No se pudo abrir el pago. Intenta de nuevo.' });
    state.failPrices = false;
    state.url = null;
    expect(await run({ plan: 'pro' })).toHaveProperty('error');
  });
});
