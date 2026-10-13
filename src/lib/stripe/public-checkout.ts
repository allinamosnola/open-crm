'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { reportError } from '@/lib/observability';
import { PRIVACY_URL, appUrl } from '@/lib/site';

import { getPlanPrices, getStripe } from './config';
import { CLINIC_NAME_FIELD, LANDING_SOURCE } from './provision';

// Checkout de la landing: sin sesión ni cuenta. Stripe cobra primero y el webhook
// crea la cuenta (src/lib/stripe/provision.ts). Pública: cualquiera puede llamarla,
// pero solo crea una sesión de Stripe, que no cobra nada hasta que la persona paga.

const schema = z.object({
  plan: z.enum(['basic', 'pro', 'plus']),
  // El complemento Bot solo existe sobre Básico (Pro y Plus ya lo incluyen).
  botAddon: z.boolean(),
});

export type PublicCheckoutState = { error: string } | null;

export async function startPublicCheckout(
  _previous: PublicCheckoutState,
  formData: FormData,
): Promise<PublicCheckoutState> {
  // Campo trampa oculto en el formulario: solo lo llenan los bots.
  if (String(formData.get('sitio_web') ?? '') !== '') return { error: 'No se pudo abrir el pago.' };

  const parsed = schema.safeParse({
    plan: formData.get('plan'),
    botAddon: formData.get('botAddon') === 'on',
  });
  if (!parsed.success) return { error: 'Plan inválido' };
  const { plan, botAddon } = parsed.data;
  if (botAddon && plan !== 'basic') {
    return { error: 'El complemento Bot solo aplica al plan Básico' };
  }

  let url: string;
  try {
    const prices = await getPlanPrices();
    const lineItems = [{ price: prices[plan].id, quantity: 1 }];
    if (botAddon) lineItems.push({ price: prices.bot.id, quantity: 1 });

    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      // Etiqueta para comparar este flujo de Checkout en el Dashboard.
      integration_identifier: 'citabot-planes-kqzvmtrb',
      locale: 'es-419',
      line_items: lineItems,
      // Precios sin IVA: Stripe Tax suma el impuesto (requiere dirección).
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      custom_fields: [
        {
          key: CLINIC_NAME_FIELD,
          label: { type: 'custom', custom: 'Nombre del consultorio' },
          type: 'text',
          text: { minimum_length: 2, maximum_length: 80 },
        },
      ],
      ...(PRIVACY_URL
        ? {
            custom_text: {
              submit: { message: `Al pagar aceptas el [aviso de privacidad](${PRIVACY_URL}).` },
            },
          }
        : {}),
      // Sin account_id: la cuenta no existe todavía. `source` hace que el webhook la cree.
      metadata: { source: LANDING_SOURCE },
      subscription_data: { metadata: { source: LANDING_SOURCE } },
      success_url: `${appUrl()}/contratar/gracias`,
      cancel_url: `${appUrl()}/#tarifas`,
    });
    if (!session.url) throw new Error('Stripe no devolvió la URL de Checkout');
    url = session.url;
  } catch (error) {
    reportError('Error al crear el Checkout de la landing:', error, {
      where: 'stripe.startPublicCheckout',
    });
    return { error: 'No se pudo abrir el pago. Intenta de nuevo.' };
  }
  // Fuera del try: redirect() lanza una excepción de control de Next.
  redirect(url);
}
