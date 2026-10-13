'use server';

import { z } from 'zod';

import { getEntitlements } from '@/lib/db/account';
import { getCurrentStaff } from '@/lib/db/staff';
import type { ActionResult } from '@/lib/db/types';
import { reportError } from '@/lib/observability';
import { appUrl } from '@/lib/site';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { getPlanPrices, getStripe } from './config';
import {
  PRICE_KEYS,
  desiredItems,
  extraClinicsFor,
  planItemChanges,
  type PriceKey,
} from './subscription';

// Checkout y portal de facturación. Solo el owner de la cuenta. Las escrituras
// de plan y estado no se hacen aquí: las hace el webhook cuando Stripe confirma
// (src/lib/stripe/sync.ts).

const checkoutSchema = z.object({
  plan: z.enum(['basic', 'pro', 'plus']),
  // El complemento Bot solo existe sobre Básico (Pro y Plus ya lo incluyen).
  botAddon: z.boolean().default(false),
});
export type CheckoutInput = z.input<typeof checkoutSchema>;

// Cuenta del owner de la sesión con sus datos de Stripe; null si no es owner.
async function getOwnerBilling() {
  const me = await getCurrentStaff();
  if (!me || me.role !== 'owner') return null;
  const accountId = me.clinic.account.account_id;
  const { data, error } = await createAdminClient()
    .from('accounts')
    .select('id, stripe_customer_id, stripe_subscription_id, billing_status')
    .eq('id', accountId)
    .single();
  if (error) throw new Error(`No se pudo leer la cuenta: ${error.message}`);
  return data;
}

function priceIdFor(prices: Awaited<ReturnType<typeof getPlanPrices>>, key: string): string {
  const name = (Object.keys(PRICE_KEYS) as PriceKey[]).find((k) => PRICE_KEYS[k] === key)!;
  return prices[name].id;
}

const NOT_OWNER = 'Solo el dueño de la cuenta puede administrar el plan y la facturación';

// Abre Stripe Checkout para contratar un plan. Devuelve la URL a la que mandar
// al usuario. Si la cuenta ya tiene una suscripción vigente se usa el portal.
export async function startCheckout(input: CheckoutInput): Promise<ActionResult<{ url: string }>> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Plan inválido' };
  const { plan, botAddon } = parsed.data;
  if (botAddon && plan !== 'basic') {
    return { ok: false, error: 'El complemento Bot solo aplica al plan Básico' };
  }

  const account = await getOwnerBilling();
  if (!account) return { ok: false, error: NOT_OWNER };
  if (
    account.stripe_subscription_id &&
    account.billing_status &&
    !['canceled', 'incomplete_expired'].includes(account.billing_status)
  ) {
    return { ok: false, error: 'Tu cuenta ya tiene una suscripción. Cámbiala desde «Gestionar facturación».' };
  }

  try {
    const prices = await getPlanPrices();
    const lineItems = [{ price: prices[plan].id, quantity: 1 }];
    if (botAddon) lineItems.push({ price: prices.bot.id, quantity: 1 });
    if (plan === 'plus') {
      const ent = await getEntitlements();
      const extra = extraClinicsFor(ent?.clinics_used ?? 0);
      if (extra > 0) lineItems.push({ price: prices.extraClinic.id, quantity: extra });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      // Etiqueta para comparar este flujo de Checkout en el Dashboard.
      integration_identifier: 'citabot-planes-kqzvmtrb',
      line_items: lineItems,
      // Precios sin IVA: Stripe Tax suma el impuesto (requiere dirección).
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      client_reference_id: account.id,
      metadata: { account_id: account.id },
      subscription_data: { metadata: { account_id: account.id } },
      success_url: `${appUrl()}/configuracion/plan?checkout=ok`,
      cancel_url: `${appUrl()}/configuracion/plan?checkout=cancelado`,
      ...(account.stripe_customer_id
        ? { customer: account.stripe_customer_id, customer_update: { address: 'auto', name: 'auto' } }
        : { customer_email: user?.email ?? undefined }),
    });
    if (!session.url) throw new Error('Stripe no devolvió la URL de Checkout');
    return { ok: true, data: { url: session.url } };
  } catch (error) {
    reportError('Error al crear la sesión de Checkout:', error, { where: 'stripe.startCheckout' });
    return { ok: false, error: 'No se pudo abrir el pago. Intenta de nuevo.' };
  }
}

// Cambia el plan o el complemento Bot de una suscripción vigente. Modifica los
// ítems de la suscripción (precio base, Bot, consultorios extra) con prorrateo
// inmediato: al subir se cobra la diferencia ya; al bajar queda como saldo a
// favor para la próxima factura. Si el cobro falla no se cambia nada. No escribe
// plan ni bot_addon: los sincroniza el webhook cuando Stripe confirma.
export async function changePlan(input: CheckoutInput): Promise<ActionResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Plan inválido' };
  const { plan, botAddon } = parsed.data;
  if (botAddon && plan !== 'basic') {
    return { ok: false, error: 'El complemento Bot solo aplica al plan Básico' };
  }

  const account = await getOwnerBilling();
  if (!account) return { ok: false, error: NOT_OWNER };
  if (
    !account.stripe_subscription_id ||
    ['canceled', 'incomplete_expired'].includes(account.billing_status ?? '')
  ) {
    return { ok: false, error: 'Tu cuenta no tiene una suscripción vigente. Contrata un plan.' };
  }

  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(account.stripe_subscription_id);
    const ent = await getEntitlements();
    const prices = await getPlanPrices();

    const changes = planItemChanges(
      subscription.items.data.map((item) => ({
        id: item.id,
        lookupKey: item.price.lookup_key,
        quantity: item.quantity ?? 1,
      })),
      desiredItems(plan, botAddon, ent?.clinics_used ?? 0),
      Object.fromEntries(Object.values(PRICE_KEYS).map((key) => [key, priceIdFor(prices, key)])),
    );
    if (changes.length === 0) return { ok: false, error: 'Tu cuenta ya tiene ese plan' };

    await stripe.subscriptions.update(subscription.id, {
      items: changes,
      proration_behavior: 'always_invoice',
      // Si el cobro de la diferencia falla, la suscripción no cambia.
      payment_behavior: 'error_if_incomplete',
    });
    return { ok: true, data: undefined };
  } catch (error) {
    reportError('Error al cambiar de plan:', error, { where: 'stripe.changePlan' });
    return {
      ok: false,
      error: 'No se pudo cambiar el plan. Revisa tu método de pago o intenta de nuevo.',
    };
  }
}

// Abre el portal de facturación de Stripe (tarjeta, facturas, cambio de plan,
// cancelación). Devuelve la URL.
export async function openBillingPortal(): Promise<ActionResult<{ url: string }>> {
  const account = await getOwnerBilling();
  if (!account) return { ok: false, error: NOT_OWNER };
  if (!account.stripe_customer_id) {
    return { ok: false, error: 'Tu cuenta todavía no tiene una suscripción en Stripe' };
  }
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: account.stripe_customer_id,
      return_url: `${appUrl()}/configuracion/plan`,
    });
    return { ok: true, data: { url: session.url } };
  } catch (error) {
    reportError('Error al abrir el portal de facturación:', error, { where: 'stripe.openBillingPortal' });
    return { ok: false, error: 'No se pudo abrir la facturación. Intenta de nuevo.' };
  }
}

// Estado de cobro de la cuenta para /configuracion/plan. null si no es owner.
export async function getBillingSummary(): Promise<{
  hasCustomer: boolean;
  billingStatus: string | null;
  subscribed: boolean;
} | null> {
  const account = await getOwnerBilling();
  if (!account) return null;
  return {
    hasCustomer: Boolean(account.stripe_customer_id),
    billingStatus: account.billing_status,
    subscribed:
      Boolean(account.stripe_subscription_id) &&
      !['canceled', 'incomplete_expired'].includes(account.billing_status ?? ''),
  };
}
