import 'server-only';

import type Stripe from 'stripe';

import { reportError } from '@/lib/observability';
import {
  ProvisioningError,
  buildSlug,
  createAccountWithOwner,
} from '@/lib/provisioning/account';
import type { AdminClient } from '@/lib/supabase/admin';

import { resolveSubscription } from './subscription';

// Alta de la cuenta de alguien que pagó desde la landing (docs/plans/
// 2026-10-08_1746_checkout-directo-landing.md). La sesión de Checkout se crea sin
// cuenta (startPublicCheckout, Fase 2) con metadata.source = 'landing'; aquí, ya
// pagada, se crean cuenta, consultorio y owner invitado.

export const LANDING_SOURCE = 'landing';
// Clave del campo personalizado de Checkout con el nombre del consultorio.
export const CLINIC_NAME_FIELD = 'nombre_consultorio';

export function isLandingCheckout(session: Stripe.Checkout.Session): boolean {
  return session.metadata?.source === LANDING_SOURCE && !session.metadata?.account_id;
}

const MAX_SLUG_ATTEMPTS = 5;

async function findAccountBySession(admin: AdminClient, sessionId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('accounts')
    .select('id')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo buscar la cuenta de la sesión: ${error.message}`);
  return data?.id ?? null;
}

// Devuelve el id de la cuenta de la sesión: la crea si no existe (idempotente por
// stripe_checkout_session_id) o null si no se pudo dar de alta y requiere atención
// manual (el correo ya tiene usuario). Lanza ante fallas transitorias para que
// Stripe reintente el evento.
export async function provisionFromCheckout(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const existing = await findAccountBySession(admin, session.id);
  if (existing) return existing;

  const email = session.customer_details?.email?.trim().toLowerCase();
  if (!email) throw new Error(`La sesión ${session.id} no trae correo del cliente`);
  const clinicName = session.custom_fields
    ?.find((field) => field.key === CLINIC_NAME_FIELD)
    ?.text?.value?.trim();
  if (!clinicName) throw new Error(`La sesión ${session.id} no trae el nombre del consultorio`);

  // El plan sale de los ítems cobrados, no de la metadata: es lo que de verdad se pagó.
  const resolved = resolveSubscription(
    subscription.items.data.map((item) => ({
      lookupKey: item.price.lookup_key,
      quantity: item.quantity ?? 1,
    })),
  );
  const ownerName = session.customer_details?.name?.trim() || email;

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    try {
      const created = await createAccountWithOwner(admin, {
        name: clinicName,
        slug: buildSlug(clinicName),
        plan: resolved.plan,
        botAddon: resolved.botAddon,
        ownerEmail: email,
        ownerName,
        // 'trial' solo hasta que syncSubscription aplique el estado real.
        subscriptionStatus: 'trial',
        stripeCheckoutSessionId: session.id,
      });
      return created.accountId;
    } catch (error) {
      if (!(error instanceof ProvisioningError)) throw error;
      if (error.code === 'slug_taken') continue;
      if (error.code === 'duplicate_session') {
        // Otro intento del webhook la creó entre la búsqueda y el insert.
        const accountId = await findAccountBySession(admin, session.id);
        if (accountId) return accountId;
      }
      if (error.code === 'email_exists') {
        // Ya pagó pero el correo tiene usuario: no se automatiza; queda para reembolso
        // o alta manual. Sin datos personales en el reporte, solo ids de Stripe.
        reportError('Pago desde la landing con un correo ya registrado:', error, {
          where: 'stripe.provision.email_exists',
          extra: { checkoutSession: session.id, subscription: subscription.id },
        });
        return null;
      }
      throw error;
    }
  }
  throw new Error(`No se encontró un slug libre para la sesión ${session.id}`);
}
