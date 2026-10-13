import { beforeEach, describe, expect, it, vi } from 'vitest';

const reported = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/observability', () => ({
  reportError: (_m: string, _e: unknown, ctx: { where: string }) => reported.push(ctx.where),
}));

import { handleStripeEvent } from '@/lib/stripe/sync';

import { createFakeAdmin } from '../stubs/fake-admin';

function subscription(keys: [string, number][] = [['citabot_pro', 1]], metadata: Record<string, string> = {}) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    metadata,
    items: {
      data: keys.map(([lookup_key, quantity]) => ({ price: { id: `price_${lookup_key}`, lookup_key }, quantity })),
    },
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_1',
    mode: 'subscription',
    subscription: 'sub_1',
    metadata: { source: 'landing' },
    customer_details: { email: 'Dra@Ejemplo.com ', name: 'Dra. Ana López' },
    custom_fields: [{ key: 'nombre_consultorio', text: { value: ' Sonrisas del Valle ' } }],
    ...overrides,
  };
}

const completed = (s: object) =>
  ({ id: 'evt_1', type: 'checkout.session.completed', data: { object: s } }) as never;

let fake: ReturnType<typeof createFakeAdmin>;
let rpcCalls: Record<string, unknown>[];
let sub: ReturnType<typeof subscription>;
const setSubscriptionAccount = vi.fn(async (_id: string, accountId: string) => ({
  ...sub,
  metadata: { account_id: accountId },
}));

function deps() {
  return {
    admin: Object.assign(fake.admin, {
      rpc: (_fn: string, args: Record<string, unknown>) => {
        rpcCalls.push(args);
        return Promise.resolve({ error: null });
      },
    }) as never,
    retrieveSubscription: async () => sub as never,
    setSubscriptionAccount: setSubscriptionAccount as never,
  };
}

beforeEach(() => {
  fake = createFakeAdmin();
  rpcCalls = [];
  reported.length = 0;
  sub = subscription();
  setSubscriptionAccount.mockClear();
});

describe('alta desde el Checkout de la landing', () => {
  it('crea la cuenta del plan pagado, invita al owner y sincroniza', async () => {
    expect(await handleStripeEvent(deps(), completed(session()))).toBe('synced');

    expect(fake.state.tables.accounts[0]).toMatchObject({
      name: 'Sonrisas del Valle',
      plan: 'pro',
      bot_addon: false,
      stripe_checkout_session_id: 'cs_1',
    });
    expect(fake.state.tables.clinics[0].slug).toMatch(/^sonrisas-del-valle-[a-z0-9]{4}$/);
    expect(fake.state.tables.staff[0]).toMatchObject({
      email: 'dra@ejemplo.com',
      full_name: 'Dra. Ana López',
      role: 'owner',
    });
    expect(fake.state.invites).toEqual(['dra@ejemplo.com']);

    const accountId = fake.state.tables.accounts[0].id;
    expect(setSubscriptionAccount).toHaveBeenCalledWith('sub_1', accountId);
    expect(rpcCalls).toEqual([
      expect.objectContaining({
        p_account_id: accountId,
        p_plan: 'pro',
        p_customer_id: 'cus_1',
        p_subscription_id: 'sub_1',
        p_clinic_status: 'active',
      }),
    ]);
  });

  it('Básico con Bot queda con bot_addon', async () => {
    sub = subscription([
      ['citabot_basic', 1],
      ['citabot_bot', 1],
    ]);
    await handleStripeEvent(deps(), completed(session()));
    expect(fake.state.tables.accounts[0]).toMatchObject({ plan: 'basic', bot_addon: true });
  });

  it('un reintento del mismo evento no duplica cuenta ni invitación', async () => {
    await handleStripeEvent(deps(), completed(session()));
    await handleStripeEvent(deps(), completed(session()));
    expect(fake.state.tables.accounts).toHaveLength(1);
    expect(fake.state.invites).toHaveLength(1);
    expect(rpcCalls).toHaveLength(2); // la sincronización sí se repite (es idempotente)
  });

  it('si falla a medias deshace todo y el reintento lo crea completo', async () => {
    fake.state.fail['staff.insert'] = { message: 'boom' };
    await expect(handleStripeEvent(deps(), completed(session()))).rejects.toThrow();
    expect(fake.state.tables.accounts).toHaveLength(0);
    expect(fake.state.authUsers.size).toBe(0);

    expect(await handleStripeEvent(deps(), completed(session()))).toBe('synced');
    expect(fake.state.tables.accounts).toHaveLength(1);
  });

  it('con el correo ya registrado reporta, no crea nada y no reintenta', async () => {
    fake.state.authUsers.set('dra@ejemplo.com', 'user_previo');
    expect(await handleStripeEvent(deps(), completed(session()))).toBe('ignored');
    expect(fake.state.tables.accounts).toHaveLength(0);
    expect(reported).toEqual(['stripe.provision.email_exists']);
    expect(rpcCalls).toHaveLength(0);
  });

  it('reintenta con otro slug si el sufijo choca', async () => {
    // Primer sufijo: 0.5 -> "i000", que ya existe; el segundo sale de 0.123456.
    fake.state.tables.clinics.push({ id: 'c0', slug: 'sonrisas-del-valle-i000' });
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValue(0.123456);
    expect(await handleStripeEvent(deps(), completed(session()))).toBe('synced');
    random.mockRestore();
    expect(fake.state.tables.accounts).toHaveLength(1);
    expect(fake.state.tables.clinics).toHaveLength(2);
    expect(fake.state.tables.clinics[1].slug).not.toBe('sonrisas-del-valle-i000');
  });

  it('falta el correo o el nombre del consultorio: lanza para que Stripe reintente', async () => {
    await expect(
      handleStripeEvent(deps(), completed(session({ customer_details: { email: null } }))),
    ).rejects.toThrow(/correo/);
    await expect(
      handleStripeEvent(deps(), completed(session({ custom_fields: [] }))),
    ).rejects.toThrow(/consultorio/);
    expect(fake.state.tables.accounts).toHaveLength(0);
  });

  it('un Checkout de una cuenta existente no da de alta nada', async () => {
    sub = subscription([['citabot_pro', 1]], { account_id: 'acc_1' });
    const existing = session({ metadata: { account_id: 'acc_1' } });
    await handleStripeEvent(deps(), completed(existing));
    expect(fake.state.tables.accounts).toHaveLength(0);
    expect(setSubscriptionAccount).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(1);
  });
});
