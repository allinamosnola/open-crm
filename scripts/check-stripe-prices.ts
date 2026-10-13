// Verifica que Stripe tenga los 5 precios de PRICE_KEYS (lookup_key, mensuales,
// monto fijo) y los compara con las tarifas de la landing (PRECIOS). Solo lee:
// no crea ni cambia nada. Usa STRIPE_SECRET_KEY de .env.
//
// Uso: npm run stripe:check

import 'dotenv/config';

import { PRECIOS } from '../src/lib/planes-publicos';
import { getPlanPrices } from '../src/lib/stripe/config';
import { PRICE_KEYS, type PriceKey } from '../src/lib/stripe/subscription';

const EXPECTED: Record<PriceKey, number> = {
  basic: PRECIOS.basica,
  pro: PRECIOS.pro,
  plus: PRECIOS.plus,
  bot: PRECIOS.complementoBot,
  extraClinic: PRECIOS.plusConsultorioExtra,
};

async function main() {
  const prices = await getPlanPrices();
  let ok = true;
  for (const name of Object.keys(PRICE_KEYS) as PriceKey[]) {
    const p = prices[name];
    const issues: string[] = [];
    if (p.currency !== 'mxn') issues.push(`moneda ${p.currency.toUpperCase()} (debe ser MXN)`);
    if (p.amount !== EXPECTED[name]) issues.push(`monto ${p.amount} (la landing dice ${EXPECTED[name]})`);
    if (issues.length) ok = false;
    console.log(
      `${issues.length ? '✗' : '✓'} ${PRICE_KEYS[name].padEnd(22)} ${p.id}  ${p.amount} ${p.currency.toUpperCase()}${issues.length ? '  <- ' + issues.join('; ') : ''}`,
    );
  }
  if (!ok) process.exit(1);
  console.log('\nLos 5 precios están bien.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
