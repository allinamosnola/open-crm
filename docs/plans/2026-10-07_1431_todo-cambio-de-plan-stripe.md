# Cambio de plan desde el panel (Stripe)

**Implementado el 2026-10-07 en `feat/stripe`** (tsc, eslint, build y vitest OK, 172 pruebas); falta probarlo en el navegador.
Antes TODO. Parte de [2026-10-07_1218_integracion-stripe.md](2026-10-07_1218_integracion-stripe.md). 

## Contexto (2026-10-07)
Con el sandbox se probó el pago de Pro de punta a punta (Checkout, webhook, plan y estado en la base). El portal de Stripe
no ofrece cambiar de plan: `subscription_update` está apagado en su configuración, y `/configuracion/plan` solo muestra
«Gestionar facturación» mientras haya suscripción.

## Decisión del usuario
Opción B: una acción propia «Cambiar plan» en el panel, no el cambio de plan del portal. Motivo: la suscripción tiene
varios ítems (base, Bot, consultorio extra) y el portal podría dejar cobrando el Bot de 899 al pasar a Pro o Plus, o el
ítem de consultorios extra. El portal queda solo para tarjeta, facturas y cancelación, con el cambio de plan apagado.

## Alcance propuesto
- Server action `changePlan({ plan, botAddon })`, solo owner, en `src/lib/stripe/actions.ts`:
  - lee la suscripción de la cuenta (`stripe_subscription_id`) y calcula los ítems finales con los `PRICE_KEYS`;
  - reemplaza el precio base, agrega o quita el ítem Bot (solo Básico), y fija la cantidad del ítem extra (solo Plus);
  - `subscriptions.update` con prorrateo inmediato al subir y crédito en la próxima factura al bajar;
  - no escribe `plan` ni `bot_addon`: lo sincroniza el webhook (`customer.subscription.updated`).
- UI en `BillingCard`: selector de plan y confirmación con la diferencia de precio; visible con suscripción vigente.
- Pruebas de vitest: ítems resultantes por cambio (Básico+Bot -> Pro quita el Bot; Plus -> Pro quita los extra; etc.).
- Probar en el sandbox con `stripe listen` (cuenta «Prueba Stripe» del seed local).

## Decisiones tomadas
- Permitir bajar de plan con exceso (p. ej. Pro con 3 doctores a Básico): lo existente se conserva y `/configuracion/plan`
  lo muestra como «Excede el plan»; los triggers solo bloquean altas nuevas (igual que el cambio manual con `set-plan.ts`).
- Prorrateo inmediato al subir; crédito en la próxima factura al bajar.

## Relacionado y aún pendiente
- Resincronizar la cantidad del ítem «consultorio extra» de Plus al crear o borrar consultorios (mismo ajuste de ítems).
- IVA: Stripe Tax calcula 0 (`not_collecting`) porque no hay registro fiscal en México; decisión fiscal del usuario.

## Implementación (2026-10-07)
- `desiredItems()` y `planItemChanges()` en `src/lib/stripe/subscription.ts` (lógica pura): calculan los cambios mínimos
  de ítems (precio base, Bot, consultorios extra); los ítems ajenos no se tocan.
- `changePlan()` en `src/lib/stripe/actions.ts`: solo owner, exige suscripción vigente, `proration_behavior: 'always_invoice'`
  y `payment_behavior: 'error_if_incomplete'` (si falla el cobro no cambia nada). No escribe `plan` ni `bot_addon`: el webhook.
- `BillingCard`: selector de plan con el actual marcado, confirmación con la diferencia de precio y refresco de la página.
- Corrida en seco contra la suscripción del sandbox (Básico + Bot): los cambios calculados para Básico, Pro y Plus son los esperados.
- No probado todavía: el cobro real de un cambio desde el navegador, ni bajar de plan con exceso de doctores o consultorios.
- Sigue pendiente: resincronizar el ítem de consultorios extra al crear o borrar consultorios (reutilizar `planItemChanges`).
