# Fase 2 — E2E con Playwright

Fecha: 2026-10-13 12:38 · Rama: `feat/e2e` (parte de `feat/component-tests`) · Plan padre: [2026-10-12_1748_brecha-puesto-valsnapp.md](2026-10-12_1748_brecha-puesto-valsnapp.md)

## Alcance

- `@playwright/test` (solo Chromium), `playwright.config.ts`, carpeta `e2e/` y `npm run e2e`.
- El config compila y arranca la app (`next build && next start -p 3100`), toma las llaves de
  `npx supabase status -o json` (o de `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`;
  `E2E_SUPABASE_WORKDIR` para otra copia de `supabase/`) y fija zona horaria `America/Mexico_City`.
- Sin red externa: el servidor de pruebas recibe vacías `STRIPE_*`, `TWILIO_ACCOUNT_SID`,
  `ANTHROPIC_API_KEY`, `RESEND_API_KEY` y el DSN de Sentry; `TWILIO_AUTH_TOKEN` es un valor de prueba.
- Job `e2e` en `.github/workflows/ci.yml`: `supabase start` (migraciones + seed), Chromium con
  dependencias, `npm run e2e`, reporte HTML y trazas como artefacto, `supabase stop`.

## Flujos (12 pruebas en 5 archivos)

| Archivo | Qué cubre |
| --- | --- |
| `auth-isolation.spec.ts` | redirección sin sesión, contraseña incorrecta, A no ve pacientes de B ni por URL (404) y viceversa |
| `patients-appointments.spec.ts` | la recepción valida y registra un paciente, agenda una cita desde «Nueva cita» (buscador, fecha, hora) y la ve en la ficha; limpia sus datos al final |
| `conversations.spec.ts` | webhook de Twilio con firma inválida → 403; con firma válida → 200 TwiML, reintento con el mismo `MessageSid` sin duplicar, mensaje visible en el hilo de la recepción |
| `plan-basic.spec.ts` | Básico sin bot: sin «Conversaciones» en el menú, la URL directa muestra la invitación y lleva a «Plan Básico»; Pro sí ve la bandeja |
| `checkout.spec.ts` | tarifas (complemento Bot solo en Básico), envío → error recuperable sin Stripe, página `/contratar/gracias`, webhook de Stripe sin firma → 400 |

La firma de Twilio se calcula con `twilio.getExpectedTwilioSignature` sobre `PUBLIC_BASE_URL + ruta`,
igual que la valida `isValidTwilioRequest` (`src/lib/whatsapp/twilio.ts`, que no se puede importar
fuera de Next por `server-only`). El mensaje se manda a la conversación de María (bot pausado en la
seed) para que no se invoque a Claude ni a la API de Twilio.

## Verificación

- Local (Supabase CLI 2.117 en Docker, copia de `supabase/` con otro `project_id` para no tocar el
  volumen del repo privado): `npm run e2e` → 12/12 en verde dos veces seguidas; la limpieza deja la
  base sin datos `E2E*`.
- `npx playwright test --list`, `npx tsc --noEmit`, `npx eslint`, `npx vitest run` y `actionlint` en verde.
- No verificado: el job `e2e` en GitHub Actions (no hay remoto).

## Límites y pendientes

- Checkout de Stripe: no se llega a la sesión de Checkout ni al alta por webhook en E2E. Para eso
  hace falta una llave de prueba con `stripe listen`, o que `src/lib/stripe/config.ts` acepte un host
  alternativo (p. ej. `stripe-mock`); es del carril de backend y queda propuesto. El webhook con
  firma real del SDK y el alta ya están en `tests/stripe` (vitest).
- En Docker Desktop (macOS) apareció una vez `JWT issued at future` (reloj de la VM adelantado);
  no afectó el resultado. En CI la base y la app comparten reloj.
