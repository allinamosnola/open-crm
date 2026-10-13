-- Alta de cuentas desde el Checkout de la landing
-- (docs/plans/2026-10-08_1746_checkout-directo-landing.md, Fase 1).
-- El webhook crea la cuenta cuando Stripe confirma el pago. Si Stripe reintenta el
-- evento (o llegan dos a la vez), esta llave única impide crear la cuenta dos veces:
-- el segundo intento choca con 23505 y reutiliza la cuenta existente.
-- accounts no es accesible para anon/authenticated: solo la service role la escribe.

alter table public.accounts
  add column stripe_checkout_session_id text unique;
