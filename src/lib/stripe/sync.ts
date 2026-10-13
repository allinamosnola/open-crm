import 'server-only';

import type Stripe from 'stripe';

import type { AdminClient } from '@/lib/supabase/admin';

import { isLandingCheckout, provisionFromCheckout } from './provision';
import { clinicStatusFor, resolveSubscription } from './subscription';

export type SyncDeps = {
  admin: AdminClient;
  // Siempre se lee la suscripción de Stripe en lugar de fiarse del payload del
  // evento: los eventos pueden llegar desordenados y así el estado final es el
  // actual aunque llegue primero uno viejo.
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
  // Liga la suscripción a la cuenta recién creada (metadata.account_id) y devuelve
  // la suscripción actualizada. Solo se usa en el alta desde la landing.
  setSubscriptionAccount: (subscriptionId: string, accountId: string) => Promise<Stripe.Subscription>;
};

export type SyncOutcome = 'synced' | 'ignored';

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

// Cuenta a la que pertenece la suscripción: metadata.account_id (lo pone
// startCheckout) o, si falta, el cliente de Stripe ya ligado a una cuenta.
async function findAccountId(
  admin: AdminClient,
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.account_id;
  if (fromMetadata) return fromMetadata;
  const customerId = idOf(subscription.customer);
  if (!customerId) return null;
  const { data, error } = await admin
    .from('accounts')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo buscar la cuenta del cliente: ${error.message}`);
  return data?.id ?? null;
}

export async function syncSubscription(
  deps: SyncDeps,
  subscription: Stripe.Subscription,
): Promise<SyncOutcome> {
  const { admin } = deps;

  const accountId = await findAccountId(admin, subscription);
  if (!accountId) return 'ignored'; // suscripción ajena a una cuenta de la app

  const customerId = idOf(subscription.customer);
  if (!customerId) throw new Error(`La suscripción ${subscription.id} no tiene cliente`);

  const clinicStatus = clinicStatusFor(subscription.status);

  // Una suscripción vieja que se cancela después de que la cuenta pasó a otra
  // (cambio de suscripción) no debe cancelar la cuenta.
  if (clinicStatus === 'canceled') {
    const { data: account, error } = await admin
      .from('accounts')
      .select('stripe_subscription_id')
      .eq('id', accountId)
      .maybeSingle();
    if (error) throw new Error(`No se pudo leer la cuenta: ${error.message}`);
    if (account?.stripe_subscription_id && account.stripe_subscription_id !== subscription.id) {
      return 'ignored';
    }
  }

  const resolved = resolveSubscription(
    subscription.items.data.map((item) => ({
      lookupKey: item.price.lookup_key,
      quantity: item.quantity ?? 1,
    })),
  );

  const { error } = await admin.rpc('stripe_apply_subscription', {
    p_account_id: accountId,
    p_plan: resolved.plan,
    p_bot_addon: resolved.botAddon,
    p_extra_clinics: resolved.extraClinics,
    p_customer_id: customerId,
    p_subscription_id: subscription.id,
    p_billing_status: subscription.status,
    p_clinic_status: clinicStatus,
  });
  if (error) throw new Error(`No se pudo aplicar la suscripción: ${error.message}`);
  return 'synced';
}

// Despacha un evento verificado. Los eventos que no afectan al plan se ignoran
// (invoice.* no hace falta: customer.subscription.updated ya trae el cambio de
// estado por impago).
export async function handleStripeEvent(deps: SyncDeps, event: Stripe.Event): Promise<SyncOutcome> {
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    const { id } = event.data.object as Stripe.Subscription;
    return syncSubscription(deps, await deps.retrieveSubscription(id));
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const subscriptionId = idOf(session.subscription);
    if (session.mode !== 'subscription' || !subscriptionId) return 'ignored';
    const subscription = await deps.retrieveSubscription(subscriptionId);
    if (isLandingCheckout(session)) {
      const accountId = await provisionFromCheckout(deps.admin, session, subscription);
      if (!accountId) return 'ignored';
      return syncSubscription(deps, await deps.setSubscriptionAccount(subscription.id, accountId));
    }
    return syncSubscription(deps, subscription);
  }

  return 'ignored';
}
