# Checkout directo desde la landing (autoservicio)

Parte de [2026-10-07_1218_integracion-stripe.md](2026-10-07_1218_integracion-stripe.md) (decisión abierta 2: alta de
cuentas nuevas) y de [2026-10-01_1155_landing-citabot.md](2026-10-01_1155_landing-citabot.md). Estado: **Fases 1, 2 y 3 hechas el 2026-10-08** (tsc, eslint, build, vitest y pgTAP OK; pago de los 4 planes probado en el sandbox). Falta lo de producción (sección «Pendiente fuera del código»).
Rama sugerida: `feat/checkout-landing` (sale de `feat/stripe` o de `main` cuando el PR #14 se mergee).

## Contexto
Hoy los botones de `src/components/marketing/pricing-cards.tsx` abren WhatsApp (`CONTACTO.whatsappUrl`) y el alta es manual
con `scripts/create-clinic.ts`. `startCheckout()` (`src/lib/stripe/actions.ts`) exige un owner con sesión y una cuenta ya
creada, así que un visitante no puede pagar. `syncSubscription()` (`src/lib/stripe/sync.ts`) ya sabe aplicar plan y estado
a una cuenta; lo que falta es **crear la cuenta después del pago**.

## Decisión del usuario (2026-10-08)
Checkout directo: Stripe cobra primero; el webhook crea cuenta, consultorio y owner, y manda la invitación. Sin pantalla de
registro previa. Las cuentas manuales y `create-clinic.ts` siguen funcionando.

## Decisiones tomadas (2026-10-08)
1. **Aviso de privacidad:** existe. Se enlaza en Checkout con `custom_text.submit.message` (texto con enlace al aviso, junto
   al botón de pagar) y en la URL de privacidad de los datos públicos del negocio en el Dashboard de Stripe. No se exige
   aceptar términos (`consent_collection.terms_of_service` queda fuera); si más adelante hay términos de servicio, se suma.
2. **Correo ya registrado:** se reporta a Sentry y se resuelve a mano (reembolso o alta manual); sin automatizar.
3. **Invitación vencida:** se agrega «Olvidé mi contraseña» en `/login` (alcance nuevo, fase 2). Sirve también a quien
   deje vencer la invitación de 1 h: pide el enlace de recuperación con su correo. El vencimiento no se cambia.
4. **WhatsApp:** no hay enlace secundario junto a cada botón de pago; basta el botón de WhatsApp que ya está al final de la
   landing.

## Flujo
1. Landing: cada tarifa es un `<form>` con un botón que invoca la server action `startPublicCheckout({ plan, botAddon })`.
   Básico lleva una casilla «Añadir bot de WhatsApp (+$899)»; Pro y Plus no (ya lo incluyen). Sin sesión ni cuenta.
2. La acción crea una Checkout Session (`mode: subscription`, mismos `lookup_key` y `integration_identifier` que
   `startCheckout`) y redirige (303) a Stripe. Sin `client_reference_id` ni `account_id`.
   - `metadata` y `subscription_data.metadata`: `source: 'landing'`, `plan`, `bot_addon`.
   - `custom_text.submit.message`: «Al pagar aceptas el [aviso de privacidad](URL)».
   - `custom_fields`: `nombre_consultorio` (texto, obligatorio). El correo y el nombre del dueño salen de
     `customer_details` (Checkout ya los pide); `billing_address_collection: 'required'` y `automatic_tax` igual que hoy.
   - `success_url`: `/contratar/gracias?session_id={CHECKOUT_SESSION_ID}`; `cancel_url`: `/#tarifas`.
3. Webhook `checkout.session.completed` con `metadata.source === 'landing'`: `provisionFromCheckout()` crea todo y luego
   llama a `syncSubscription()` (que fija plan, estado y `stripe_*`).
4. El owner recibe la invitación de Supabase (`/auth/aceptar-invitacion`), define contraseña y entra al panel.
5. `/contratar/gracias`: página estática de «Pago recibido, revisa tu correo para activar tu cuenta» (no lee la sesión de
   Stripe; no hace falta, y así no expone datos). Enlace a `/login` (con «Olvidé mi contraseña») por si la invitación vence o no llega.

## Datos (migración nueva)
- `accounts.stripe_checkout_session_id text unique`: llave de idempotencia del alta (se inserta primero; un reintento del
  webhook la encuentra y reanuda). Solo la escribe la service role.
- Sin tablas nuevas. `stripe_events` ya da idempotencia por evento; esta columna da idempotencia por alta.

## Servidor
Leer antes `node_modules/next/dist/docs/01-app/` (server actions, formularios `07-mutating-data.md`, route handlers,
`proxy`/middleware; CLAUDE.md avisa de cambios incompatibles).
- `src/lib/provisioning/` (`server-only`): extraer de `scripts/create-clinic.ts` la lógica «cuenta nueva» (cuenta →
  consultorio → invitar → staff owner, con deshacer). El script pasa a importarla; sin cambio de comportamiento.
- `provisionFromCheckout(deps, session)`: pasos idempotentes, cada uno comprueba si ya existe.
  1. Cuenta por `stripe_checkout_session_id`; si no existe, la crea con `plan`/`bot_addon` de la metadata.
  2. Consultorio: `name` = campo personalizado; `slug` = nombre en minúsculas sin acentos + sufijo corto aleatorio
     (único; reintenta en conflicto). Zona horaria por defecto de la tabla.
  3. Owner: `inviteUserByEmail(email, { data: { full_name } })` + fila en `staff`.
  4. `stripe.subscriptions.update(id, { metadata: { account_id } })` para que los eventos siguientes encuentren la cuenta.
  5. `syncSubscription()`.
- `handleStripeEvent` enruta `checkout.session.completed` de la landing a `provisionFromCheckout`; el resto sigue igual.
- «Olvidé mi contraseña»: enlace en `/login` a una pantalla que pide el correo y llama a
  `supabase.auth.resetPasswordForEmail` con redirección a `/auth/confirm` y de ahí a `/auth/aceptar-invitacion` (que ya
  define la contraseña con la sesión abierta). Respuesta siempre genérica («si el correo existe, te llegó un enlace») para
  no revelar qué correos tienen cuenta. Agregar la ruta a `additional_redirect_urls` de Supabase si hace falta.
  Revisar que `/auth/confirm` acepte el tipo `recovery` además de `invite`.
- Middleware: `/contratar` y la acción son públicas (`/` ya lo es; revisar el matcher). Limitar el abuso: la acción solo crea
  sesiones de Stripe (sin cobro hasta que el visitante pague), pero poner límite por IP o un honeypot para no llenar el
  Dashboard de sesiones.

## Casos límite
- **Correo ya registrado** (otro dueño o alguien que ya tiene cuenta): `inviteUserByEmail` falla. No se crea nada, se reporta
  a Sentry con el id de la sesión y el pago queda en Stripe para reembolso o alta manual (decisión 2).
- **Falla a medias** (p. ej. Supabase caído): el webhook responde 500, Stripe reintenta y los pasos idempotentes reanudan.
- **Invitación vencida** (`otp_expiry` = 1 h en `supabase/config.toml`): el dueño usa «Olvidé mi contraseña» en `/login`
  (decisión 3). Como ya existe su usuario en Supabase Auth, el enlace de recuperación funciona igual que para cualquiera.
- **Plus**: entra con 0 consultorios extra; los extras se cobran después con el ítem existente (sigue pendiente la
  resincronización del ítem al crear sedes).
- **IVA**: depende del registro fiscal en Stripe Tax; sin él el cobro sale con IVA 0 (ya anotado en el plan de Stripe).

## Pruebas
- vitest: `provisionFromCheckout` con mocks (alta completa; reintento tras fallar en cada paso sin duplicar; correo
  existente; slug repetido), la acción (plan inválido, bot solo con Básico) y el ruteo del evento por `source`.
- vitest: la acción de recuperación responde igual con correo existente y no existente.
- pgTAP: la columna única de `stripe_checkout_session_id`.
- Sandbox con `stripe listen`: pagar Básico, Básico + Bot, Pro y Plus con `4242 4242 4242 4242`; revisar `accounts`,
  `clinics`, `staff` y el correo en Mailpit (`http://127.0.0.1:54324`). Reenviar el mismo evento y comprobar que no duplica.
- Nunca con la cuenta real de Stripe ni de WhatsApp.

## Fases
1. Extraer el alta a `src/lib/provisioning/` + migración + `provisionFromCheckout` + ruteo en el webhook, con pruebas.
2. `startPublicCheckout` + formularios en `pricing-cards.tsx` + `/contratar/gracias` + middleware + «Olvidé mi contraseña».
3. Verificación en el sandbox y en el navegador; actualizar README (sección de Stripe y de alta de cuentas).

## Fase 1 implementada (2026-10-08)
- Migración `20261008000001_alta_desde_checkout.sql` (aplicada solo en la base local) y `src/types/database.ts`.
- `src/lib/provisioning/account.ts`: `createAccountWithOwner()`, `insertClinic()`, `buildSlug()` y `ProvisioningError`
  (códigos `email_exists`, `slug_taken`, `duplicate_session`). `scripts/create-clinic.ts` ya los usa, sin cambio de salida.
- `src/lib/stripe/provision.ts`: `provisionFromCheckout()` e `isLandingCheckout()`. `handleStripeEvent` enruta
  `checkout.session.completed` con `metadata.source = 'landing'` y sin `account_id`; `SyncDeps` ganó
  `setSubscriptionAccount` (el webhook lo cumple con `subscriptions.update` de la metadata).
- Pruebas: `tests/provisioning/account.test.ts`, `tests/stripe/provision.test.ts` (base en memoria en
  `tests/stubs/fake-admin.ts`) y `supabase/tests/alta_checkout.test.sql`. Además se probó contra la base local real
  (alta, sesión repetida, correo repetido y limpieza).

### Diferencias con lo planeado
- **Deshacer en lugar de reanudar.** Si un paso falla, se borra lo creado (como en el script) y el reintento de Stripe
  empieza de cero; la llave `stripe_checkout_session_id` evita duplicar cuando el alta sí terminó. Una caída del proceso
  justo entre pasos podría dejar una cuenta sin owner; es una ventana mínima y no se cubre.
- **Correo repetido se revisa en `staff` antes de crear nada.** `inviteUserByEmail` solo devuelve `email_exists` si el
  usuario ya confirmó; a uno invitado que no ha entrado le reenvía la invitación y habría quedado ligado a dos cuentas
  (se vio en la prueba con la base real). Por eso se consulta `staff.email` primero.
- El plan sale de los ítems cobrados (`resolveSubscription`), no de la metadata; la metadata solo marca `source`.

## Fase 2 implementada (2026-10-08)
- `src/lib/stripe/public-checkout.ts`: server action `startPublicCheckout` (pública; plan y casilla del Bot; campo trampa
  `sitio_web` contra bots; sesión con `metadata.source = 'landing'`, campo `nombre_consultorio`, enlace al aviso de
  privacidad y `automatic_tax`). Redirige a Stripe con `redirect()`.
- `src/components/marketing/plan-checkout-form.tsx` (cliente, `useActionState`) reemplaza los enlaces a WhatsApp en
  `pricing-cards.tsx`; Básico lleva la casilla «Añadir bot». El botón de WhatsApp del final de la landing no cambia.
- `/contratar/gracias` (estática, `noindex`) y `/contratar` pública en el middleware.
- «Olvidé mi contraseña»: enlace en el login, página `/login/recuperar` y plantilla `supabase/templates/recovery.html`
  (en `config.toml`) que pasa por `/auth/confirm?type=recovery` y manda a `/auth/aceptar-invitacion`. Respuesta genérica.
  Probado contra Supabase local: un dueño invitado que nunca entró recibe el correo de recuperación, verifica el token,
  define la contraseña e inicia sesión; un correo inexistente no recibe nada ni da error.
- `appUrl()` y `PRIVACY_URL` (`NEXT_PUBLIC_PRIVACY_URL`) pasaron a `src/lib/site.ts`.
- Pruebas: `tests/stripe/public-checkout.test.ts`.
- Sin límite por IP (solo el campo trampa): si se llena el Dashboard de sesiones sin pagar, agregarlo.

## Fase 3: prueba de punta a punta (2026-10-08)
Sandbox de Stripe (`sk_test`, «Entorno de prueba»), `npm run dev` con `PUBLIC_BASE_URL=http://localhost:3000`, `stripe listen --api-key`
y Supabase local. Landing abierta en Chrome por `127.0.0.1` (en `localhost` había otra sesión). Tarjeta `4242 4242 4242 4242`.

| Plan | Total en Checkout | Resultado en la base |
|---|---|---|
| Pro | MXN 2,990 | cuenta `pro`, sin bot, consultorio `active`, owner invitado |
| Básico + bot | MXN 1,598 (dos líneas) | `basic` con `bot_addon` |
| Básico | MXN 699 | `basic`, sin bot |
| Plus | MXN 5,990 | `plus`, `extra_clinics` 0 |

- Cada pago llegó a `/contratar/gracias`; el webhook respondió 200 a `customer.subscription.created`, `checkout.session.completed` y
  `customer.subscription.updated`; la cuenta quedó con ids de Stripe, `billing_status` `active` y la llave de sesión.
- Reenviar `checkout.session.completed` (`stripe events resend`) respondió 200 y no creó cuentas, staff ni correos nuevos (5 -> 5 cuentas).
- Cada owner recibió «Invitación al CRM dental» en Mailpit; el enlace abre `/auth/aceptar-invitacion` con sesión.
- Los datos de prueba se borraron (base local) y las 4 suscripciones se cancelaron en el sandbox.

### Hallazgos
- **Guardar la contraseña, verificado por `localhost`:** por `127.0.0.1` el formulario de `/auth/aceptar-invitacion` recargaba sin
  enviarse (en desarrollo el JS no hidrata en ese origen: Next bloquea sus recursos de desarrollo, `allowedDevOrigins`). Con una
  invitación nueva por `localhost` funcionó: «Contraseña guardada», entró a la agenda como la dueña y `/configuracion/plan` mostró
  Plan Pro. Cuenta de prueba borrada y sesión cerrada.
- **Desarrollo solo:** `/auth/confirm` redirige a `localhost:3000` aunque se entre por `127.0.0.1`, así que la sesión recién abierta
  queda en el otro origen. En producción hay un solo dominio.
- **Marca en Checkout:** la cuenta de Stripe del sandbox se muestra como «SportMetrixAI» y el comercio como «citabot_test». Antes de
  producción, poner en el Dashboard el nombre público y el logo de CitaBot (el `logo.png` ya está en `public/`).
- El enlace al aviso de privacidad no aparece porque `NEXT_PUBLIC_PRIVACY_URL` está vacío (esperado).
- Impuesto MXN 0.00 (sin registro fiscal en Stripe Tax; ya conocido).
- Los clics en los botones antes de que la página hidrate no hacen nada (en desarrollo tardó unos segundos); en producción el
  formulario sin JS no envía el plan, así que conviene un `<noscript>` o aceptar el fallo (decisión menor, no se cambió).

## Pendiente fuera del código
- URL del aviso de privacidad: ponerla en el Dashboard de Stripe (datos públicos del negocio) y en `custom_text`.
- Aplicar la migración en producción antes de desplegar la Fase 2.
- `NEXT_PUBLIC_PRIVACY_URL` en el entorno de producción (y la URL de privacidad en el Dashboard de Stripe).
- Pegar la plantilla de recuperación (`supabase/templates/recovery.html`, asunto «Define tu contraseña del CRM dental») en el
  dashboard de Supabase de producción; `config.toml` solo rige el entorno local.
- Webhook de producción registrado (ya pendiente del plan de Stripe): sin él nadie recibe su cuenta tras pagar.
