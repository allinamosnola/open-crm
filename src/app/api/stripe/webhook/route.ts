import * as Sentry from '@sentry/nextjs';

import { reportError } from '@/lib/observability';
import { getStripe, getWebhookSecret } from '@/lib/stripe/config';
import { handleStripeEvent } from '@/lib/stripe/sync';
import { createAdminClient } from '@/lib/supabase/admin';

// Webhook de Stripe. El matcher de src/middleware.ts excluye /api/stripe: aquí no
// hay sesión de usuario, la autenticación es la firma Stripe-Signature.

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('Falta la firma', { status: 400 });

  // La firma se calcula sobre el cuerpo crudo: no usar request.json().
  const payload = await request.text();
  const stripe = getStripe();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, getWebhookSecret());
  } catch {
    return new Response('Firma inválida', { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotencia: el evento se registra antes de procesarlo. Si ya se procesó,
  // se responde 200; si quedó a medias (processed_at null), se reintenta.
  const { error: insertError } = await admin
    .from('stripe_events')
    .upsert({ event_id: event.id, type: event.type }, { onConflict: 'event_id', ignoreDuplicates: true });
  if (insertError) {
    reportError('Error registrando el evento de Stripe:', insertError, { where: 'stripe.webhook.claim' });
    return new Response('Error interno', { status: 500 });
  }
  const { data: stored, error: readError } = await admin
    .from('stripe_events')
    .select('processed_at')
    .eq('event_id', event.id)
    .single();
  if (readError) {
    reportError('Error leyendo el evento de Stripe:', readError, { where: 'stripe.webhook.read' });
    return new Response('Error interno', { status: 500 });
  }
  if (stored.processed_at) return new Response('OK', { status: 200 });

  try {
    await handleStripeEvent(
      {
        admin,
        retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
        setSubscriptionAccount: (id, accountId) =>
          stripe.subscriptions.update(id, { metadata: { account_id: accountId } }),
      },
      event,
    );
    const { error: doneError } = await admin
      .from('stripe_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('event_id', event.id);
    if (doneError) throw doneError;
  } catch (error) {
    // 500 => Stripe reintenta; aplicar la suscripción es idempotente.
    reportError('Error procesando el evento de Stripe:', error, {
      where: 'stripe.webhook.handle',
      extra: { eventType: event.type },
    });
    await Sentry.flush(2000);
    return new Response('Error interno', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
