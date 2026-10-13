# Integración de Stripe (cobro de suscripciones)

Conecta el cobro con los planes de 2026-10-01_1122_implementacion-planes-y-topes.md (plan de negocio, no incluido en la copia pública)
y las tarifas de 2026-10-01_1112_tarifas-basica-pro-plus-v2.md (plan de negocio, no incluido en la copia pública).
Rama: `feat/stripe`.

## Decisiones del usuario (2026-10-07)
- **Flujo:** Stripe Checkout (modo suscripción) + Customer Portal. Sin UI de pago propia.
- **Cobro extra:** una suscripción por cuenta con ítems: plan base + ítem Bot (solo Básico) + ítem
  «consultorio extra» con cantidad (Plus, desde el 6.º, +999).
- **Prueba y mora:** sin periodo de prueba; `past_due`, `unpaid`, `canceled` e `incomplete_expired` = suscripción inactiva.
- **Impuestos:** precios MXN sin IVA, Stripe Tax suma el 16 %.

## Pendiente de decidir
1. Cuentas actuales (Sonrisas, Dental Norte, Pro manual): ¿siguen manuales o pasan a Checkout?
2. Alta de cuentas nuevas: manual con `create-clinic.ts` (supuesto) o autoservicio desde la landing.
3. Productos y precios en Stripe: ¿por script con la CLI en modo test o desde el dashboard?

## Fase 1: datos
Migración nueva.
- `accounts`: `stripe_customer_id`, `stripe_subscription_id`, `extra_clinics`, `billing_status`.
- Tabla `stripe_events` (`event_id` PK) para idempotencia del webhook. RLS activa y sin políticas (solo service role).
- `subscription_status` se queda en `clinics` (la RLS depende de él); el webhook lo propaga a todos los consultorios
  de la cuenta. Verificar los valores del enum antes de mapear.
- `accounts` no es escribible desde la app: solo el webhook (service role) cambia `plan` y `bot_addon`.

## Fase 2: servidor
Leer antes `node_modules/next/dist/docs/` (route handlers y server actions; CLAUDE.md avisa de cambios).
- Dependencia `stripe`; variables `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`.
- `src/lib/stripe/` (`server-only`): cliente, catálogo de precios, `syncSubscription()` (ítems → `plan`, `bot_addon`,
  `extra_clinics`, estado de los consultorios).
- `POST /api/stripe/webhook`: firma sobre el cuerpo crudo, registro en `stripe_events` antes de procesar.
  Eventos: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`,
  `invoice.payment_failed`.
- Precios por `lookup_key` (no por id): `getPlanPrices()` los lee de Stripe con caché de 1 h; los montos de `/configuracion/plan` salen de ahí (la landing sigue con `PRECIOS`).
- Server actions solo para owner: `startCheckout(plan, botAddon)` (MXN, `automatic_tax`, `account_id` en `metadata`) y
  `openBillingPortal()`.
- Plus: cantidad del ítem extra = `max(0, consultorios - 5)`, resincronizada al crear o borrar consultorios (idempotente).
- Middleware: `/api/stripe/webhook` pública (hoy todo va a `/login`).

## Fase 3: panel
- `/configuracion/plan`: Contratar, Cambiar plan, Gestionar facturación y estado de pago.
- La landing manda a `/login` con el plan elegido (sin Checkout anónimo).

## Fase 4: verificación
- vitest: firma inválida, evento duplicado, mapeo de estados, de ítems a plan y bot, y consultorio extra.
- `stripe listen` en modo test; tsc, lint y vitest limpios.
- Nunca correr `bot:dev`/Wechaty.

## Riesgos
- El webhook es el único camino que escribe plan y estado: si falla la firma o se pierde un evento, la cuenta se desalinea.
  Mitigación: idempotencia y reconciliación manual con `scripts/set-plan.ts`.
- Suscripción por cuenta contra estado por consultorio (ya anotado en el plan de topes): el webhook actualiza todas las sedes.

## Avance (2026-10-07)
Fases 1 a 3 implementadas en `feat/stripe`; tsc, eslint, build y vitest (153 pruebas) OK. Cambios respecto al plan:
- El webhook relee la suscripción en Stripe en cada evento (no confía en el payload) y ignora `invoice.*`:
  `customer.subscription.updated` ya trae el impago.
- El enum `subscription_status` no cambió: `unpaid`/`incomplete`/`paused` -> `past_due`; `incomplete_expired` -> `canceled`.
- Una suscripción vieja cancelada no cancela la cuenta si ya tiene otra.
- `src/types/database.ts` editado a mano (conserva los ajustes manuales).

Pendiente antes de producción:
1. Crear en Stripe los 5 precios mensuales en MXN con estos `lookup_key` (`PRICE_KEYS`): `citabot_basic` 699, `citabot_pro` 2,990, `citabot_plus` 5,990, `citabot_bot` 899, `citabot_extra_clinic` 999; configurar el Customer Portal. Ya no hay variables `STRIPE_PRICE_*`.
2. Stripe Tax: confirmar el registro fiscal activo en México; sin él `automatic_tax` no cobra IVA.
3. Consultorio extra de Plus: resincronizar la cantidad del ítem al crear o borrar consultorios (hoy solo se calcula en Checkout).
4. Prueba de punta a punta con `stripe listen` en un sandbox (no se ha hecho).
5. Decisiones abiertas: cuentas actuales, alta de cuentas nuevas y quién crea los productos.
