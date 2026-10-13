// Traduce una suscripción de Stripe al plan de la cuenta. Lógica pura, sin
// 'server-only' ni llamadas a Stripe: se prueba con vitest.
//
// Una suscripción por cuenta con ítems: un precio base (Básico, Pro o Plus), el
// complemento Bot (solo tiene sentido con Básico) y el consultorio extra de Plus
// (cantidad = consultorios por encima de los 5 incluidos).
//
// Cada precio se identifica por su lookup_key en Stripe (no por su id): los ids
// cambian entre sandbox y producción, las llaves no. Hay que crearlos en Stripe
// con exactamente estas llaves.

import type { AccountPlan, SubscriptionStatus } from '@/lib/db/types';

export const PRICE_KEYS = {
  basic: 'citabot_basic',
  pro: 'citabot_pro',
  plus: 'citabot_plus',
  bot: 'citabot_bot',
  extraClinic: 'citabot_extra_clinic',
} as const;

export type PriceKey = keyof typeof PRICE_KEYS;

export type SubscriptionItemInput = { lookupKey: string | null; quantity: number };

export type ResolvedSubscription = {
  plan: AccountPlan;
  botAddon: boolean;
  extraClinics: number;
};

// Plus incluye 5 consultorios; del 6.º en adelante se cobra el ítem extra.
export const PLUS_INCLUDED_CLINICS = 5;

export function extraClinicsFor(clinicCount: number): number {
  return Math.max(0, clinicCount - PLUS_INCLUDED_CLINICS);
}

// Plan, complemento y consultorios extra a partir de los ítems. Lanza si no hay
// exactamente un precio base: es un estado que el webhook no debe adivinar (el
// 500 hace que Stripe reintente y quede en Sentry).
export function resolveSubscription(items: SubscriptionItemInput[]): ResolvedSubscription {
  const baseKeys: string[] = [PRICE_KEYS.basic, PRICE_KEYS.pro, PRICE_KEYS.plus];
  const bases = items.filter((i) => i.lookupKey !== null && baseKeys.includes(i.lookupKey));
  if (bases.length !== 1) {
    throw new Error(`La suscripción debe tener exactamente un precio base y tiene ${bases.length}`);
  }
  const base = bases[0].lookupKey;
  const plan: AccountPlan =
    base === PRICE_KEYS.pro ? 'pro' : base === PRICE_KEYS.plus ? 'plus' : 'basic';

  const hasBot = items.some((i) => i.lookupKey === PRICE_KEYS.bot && i.quantity > 0);
  const extra = items.find((i) => i.lookupKey === PRICE_KEYS.extraClinic);

  return {
    plan,
    // Pro y Plus ya incluyen el bot: el complemento solo se registra en Básico.
    botAddon: plan === 'basic' && hasBot,
    extraClinics: plan === 'plus' ? Math.max(0, extra?.quantity ?? 0) : 0,
  };
}

// Estado de Stripe -> subscription_status de los consultorios (el enum solo
// tiene trial | active | past_due | canceled). Todo lo que no está al corriente
// deja el consultorio en solo lectura.
export function clinicStatusFor(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case 'active':
    case 'trialing': // no se ofrece prueba, pero si Stripe la reporta cuenta como activa
      return 'active';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      // past_due, unpaid, incomplete, paused y estados nuevos que Stripe agregue.
      return 'past_due';
  }
}

// ---------------------------------------------------------------------------
// Cambio de plan: ítems que debe tener la suscripción y cambios para llegar ahí.
// ---------------------------------------------------------------------------

export type DesiredItem = { key: string; quantity: number };

// Ítems que corresponden a un plan (y complemento) para una cuenta con
// clinicCount consultorios. Pro y Plus ya incluyen el bot: no llevan el ítem Bot.
export function desiredItems(
  plan: AccountPlan,
  botAddon: boolean,
  clinicCount: number,
): DesiredItem[] {
  const items: DesiredItem[] = [{ key: PRICE_KEYS[plan], quantity: 1 }];
  if (plan === 'basic' && botAddon) items.push({ key: PRICE_KEYS.bot, quantity: 1 });
  if (plan === 'plus') {
    const extra = extraClinicsFor(clinicCount);
    if (extra > 0) items.push({ key: PRICE_KEYS.extraClinic, quantity: extra });
  }
  return items;
}

export type CurrentItem = { id: string; lookupKey: string | null; quantity: number };

// Forma que acepta subscriptions.update en `items`.
export type ItemChange =
  | { id: string; price?: string; quantity?: number; deleted?: true }
  | { price: string; quantity: number };

// Cambios mínimos para pasar de los ítems actuales a los deseados. priceIds: id
// de Stripe por lookup_key. Los ítems ajenos (sin una de nuestras llaves) no se
// tocan. Devuelve [] si ya está como se pide.
export function planItemChanges(
  current: CurrentItem[],
  desired: DesiredItem[],
  priceIds: Record<string, string>,
): ItemChange[] {
  const baseKeys: string[] = [PRICE_KEYS.basic, PRICE_KEYS.pro, PRICE_KEYS.plus];
  const currentBases = current.filter((c) => c.lookupKey !== null && baseKeys.includes(c.lookupKey));
  const wantedBase = desired.find((d) => baseKeys.includes(d.key));
  if (currentBases.length !== 1 || !wantedBase) {
    throw new Error('La suscripción debe tener exactamente un precio base');
  }

  const changes: ItemChange[] = [];
  if (currentBases[0].lookupKey !== wantedBase.key) {
    changes.push({ id: currentBases[0].id, price: priceIds[wantedBase.key] });
  }

  for (const key of [PRICE_KEYS.bot, PRICE_KEYS.extraClinic]) {
    const have = current.find((c) => c.lookupKey === key);
    const want = desired.find((d) => d.key === key);
    if (have && !want) changes.push({ id: have.id, deleted: true });
    else if (!have && want) changes.push({ price: priceIds[key], quantity: want.quantity });
    else if (have && want && have.quantity !== want.quantity) {
      changes.push({ id: have.id, quantity: want.quantity });
    }
  }
  return changes;
}
