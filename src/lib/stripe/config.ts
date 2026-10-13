import 'server-only';

import Stripe from 'stripe';

import { PRICE_KEYS, type PriceKey } from './subscription';

let client: Stripe | undefined;

// Cliente de Stripe con la llave secreta. Solo servidor.
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Falta STRIPE_SECRET_KEY');
  client ??= new Stripe(key);
  return client;
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('Falta STRIPE_WEBHOOK_SECRET');
  return secret;
}

export type PlanPrice = {
  id: string;
  // Monto en la unidad mayor de la moneda (pesos, no centavos).
  amount: number;
  currency: string;
};
export type PlanPrices = Record<PriceKey, PlanPrice>;

const CACHE_MS = 60 * 60 * 1000;
let cache: { at: number; prices: PlanPrices } | undefined;

// Precios vigentes en Stripe, resueltos por lookup_key (PRICE_KEYS). Caché de
// una hora por instancia: el monto mostrado sale de la misma fuente que el
// cobro. Lanza si falta alguno o no es mensual con monto fijo.
export async function getPlanPrices(): Promise<PlanPrices> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.prices;

  const keys = Object.values(PRICE_KEYS);
  const { data } = await getStripe().prices.list({ lookup_keys: keys, active: true, limit: keys.length });

  const prices = {} as PlanPrices;
  for (const [name, key] of Object.entries(PRICE_KEYS) as [PriceKey, string][]) {
    const price = data.find((p) => p.lookup_key === key);
    if (!price) throw new Error(`Falta en Stripe el precio con lookup_key ${key}`);
    if (price.unit_amount === null || price.recurring?.interval !== 'month') {
      throw new Error(`El precio ${key} debe ser mensual y de monto fijo`);
    }
    prices[name] = {
      id: price.id,
      amount: price.unit_amount / 100,
      currency: price.currency,
    };
  }
  cache = { at: Date.now(), prices };
  return prices;
}
