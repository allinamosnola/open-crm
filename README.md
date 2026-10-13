# CitaBot Dental

[![CI](https://github.com/allinamosnola/open-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/allinamosnola/open-crm/actions/workflows/ci.yml)

> English summary: [README.en.md](README.en.md)

SaaS para consultorios dentales: panel web (Next.js + Supabase) para agenda,
pacientes, planes de tratamiento, pagos y conversaciones de WhatsApp, más un bot
con Claude (API de Anthropic) que agenda, cancela y reagenda citas y pasa a la
recepción lo que no puede resolver.

- **Multi-consultorio**: esquema compartido con `clinic_id` en todas las tablas
  de negocio y Row Level Security. Cada usuario pertenece a un solo consultorio;
  los consultorios los da de alta el dueño del SaaS con un script.
- **Panel**: Next.js (App Router, TypeScript, Tailwind) con Supabase Auth
  (email/contraseña, sin registro público) y RLS.
- **WhatsApp**: Twilio (sandbox en desarrollo). El webhook guarda cada mensaje,
  liga la conversación a un paciente (o crea uno "por identificar") y responde
  con el bot; la recepción ve y responde desde el panel.
- **Bot**: agente con herramientas (Claude Sonnet 5) en `src/lib/bot/`; las
  reglas duras (horario, 24 h, huecos ofrecidos) las valida el código. No depende
  del canal: `npm run bot:chat` lo simula en la terminal y Wechaty
  (`scripts/wechaty-dev.ts`) queda solo como canal de desarrollo.

## Requisitos

- Node.js 20 o superior (el proyecto usa ES Modules)
- Docker (para correr Supabase en local con `npx supabase start`)
- Una API key de Anthropic (para el bot)
- Una cuenta de Twilio con el sandbox de WhatsApp y [ngrok](https://ngrok.com/)
  (para probar WhatsApp en local)

La CLI de Supabase se instala como dependencia de desarrollo; no hace falta
instalarla globalmente, se usa con `npx supabase …`.

## Instalación

```bash
npm install
cp .env.example .env   # completar las variables (ver abajo)
```

## Demo rápida (panel + WhatsApp)

**Antes de empezar**: Docker corriendo, `npm install` hecho, `ANTHROPIC_API_KEY`
y las credenciales de Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`) en `.env`,
y ngrok instalado. El seed ya asigna el número del sandbox (`+14155238886`) al
consultorio A, que es el que usa la demo.

**Terminal 1: base de datos y app**

```bash
npx supabase start      # imprime la URL y las llaves: cópialas a .env (ver "Panel web")
npx supabase db reset   # carga el esquema y el seed (borra los datos locales)
npm run dev             # http://localhost:3000
```

**Terminal 2: túnel público**

```bash
ngrok http 3000
```

**Configuración (cada vez que ngrok da una URL nueva, en el plan gratuito cambia al reiniciarlo)**

1. Copia la URL https de ngrok (sin `/` final) en `PUBLIC_BASE_URL` del `.env`.
2. Reinicia `npm run dev` (Terminal 1) para que lea el cambio.
3. En Twilio (*Messaging → Try it out → Send a WhatsApp message → Sandbox settings*),
   pon en **When a message comes in**: `https://<ngrok>/api/whatsapp` (POST).
4. Desde tu teléfono, únete al sandbox con el código `join <palabra>` de tu consola
   (al `+1 415 523 8886`). La sesión caduca a las 72 h.

**Guion de la demo**

1. Entra a http://localhost:3000 como `recepcion@demo.local` / `demo1234`
   (consultorio A) y abre la bandeja de conversaciones.
2. Desde el teléfono escribe "quiero una cita": el bot ofrece 3 horarios.
3. Elige uno; el bot pide tu nombre y agenda la cita.
4. En el panel aparece la conversación (con el paciente "por identificar" ya
   identificado) y la cita en la agenda, con el icono de WhatsApp.
5. Responde desde la bandeja: el bot queda pausado para ese paciente.
   Pulsa **Reanudar bot** (en la cabecera de la conversación) para que vuelva a contestar.

Si el bot no responde, revisa los logs de `npm run dev`. Un 403 en el webhook
indica que `PUBLIC_BASE_URL` no coincide con la URL de ngrok. Para probar el bot
sin Twilio, ver "Probar el bot sin WhatsApp".

## Panel web

```bash
npx supabase start      # levanta Postgres, Auth y la API en Docker; imprime URL y llaves
npx supabase db reset   # aplica supabase/migrations/* y supabase/seed.sql
npm run dev             # http://localhost:3000
```

Copia la **Project URL** y las **Authentication Keys** que imprime `supabase start`
a `.env`: la llave **Publishable** (`sb_publishable_...`) va en
`NEXT_PUBLIC_SUPABASE_ANON_KEY` y la **Secret** (`sb_secret_...`) en
`SUPABASE_SERVICE_ROLE_KEY`. Son los mismos roles que antes se llamaban "anon key"
y "service_role key"; la CLI solo cambió el formato y el nombre.

El seed crea tres consultorios, cada uno en su cuenta, para probar el aislamiento y los planes (contraseña `demo1234`):

| Consultorio                        | Correo                       | Rol                         |
| ---------------------------------- | ---------------------------- | --------------------------- |
| A "Consultorio Sonrisas" (sandbox) | `dentista@demo.local`        | owner (dentista y dueño)    |
| A                                  | `recepcion@demo.local`       | recepcionista               |
| B "Dental Norte"                   | `dueno.norte@demo.local`     | owner                       |
| B                                  | `recepcion.norte@demo.local` | recepcionista               |
| C "Consultorio Básico" (plan Básico, sin bot) | `dueno.basico@demo.local` | owner |

El consultorio A tiene el número del sandbox de Twilio (`+14155238886`) y un par
de conversaciones de ejemplo, una con un paciente "por identificar".

Otros scripts:

| Script                  | Qué hace                                                                    |
| ----------------------- | --------------------------------------------------------------------------- |
| `npm run build`         | Build de producción (necesita las variables `NEXT_PUBLIC_SUPABASE_*`).      |
| `npm run lint`          | ESLint.                                                                     |
| `npm test`              | Tests con vitest (webhook, bot y reglas; Twilio, Claude y la base mockeados). |
| `npm run bot:chat`      | Simulador de chat con el bot en la terminal (Supabase local; llama a Claude). |
| `npm run eval:bot`      | Eval del bot con el modelo real (cuesta dinero; pide confirmación).          |
| `npm run clinic:create` | Alta de un consultorio (ver abajo).                                         |
| `npm run plan:set`      | Cambia el plan o el complemento de bot de una cuenta (ver «Planes y topes»). |
| `npm run flag:set`      | Enciende o apaga un feature flag, global o por cuenta (ver «Feature flags»). |
| `npm run clinic:set-whatsapp` | Asigna, cambia o quita el número de WhatsApp de un consultorio (`--clinic <slug> [--whatsapp-from +52… \| --remove]`). |
| `npm run db:types`      | Regenera `src/types/database.ts` desde la base local (requiere Supabase corriendo). |

## Consultorios y personal

**Alta de un consultorio** (la hace el dueño del SaaS, con la service role):

```bash
npm run clinic:create -- --name "Consultorio Sonrisas" --slug sonrisas \
  --owner-email dueno@ejemplo.com --owner-name "Dra. Ana López" --plan pro \
  [--bot-addon] [--whatsapp-from +14155238886] [--timezone America/Mexico_City] \
  [--subscription trial|active]
```

Crea la cuenta (`--plan` es obligatorio; el complemento Bot es `--bot-addon`), la fila
en `clinics`, invita al owner por correo y crea su fila en `staff` con rol `owner`.
Para sumar otra sede a una cuenta existente se usa `--account <id>` en lugar de
`--plan`, `--bot-addon` y `--owner-name`: reutiliza al owner de la cuenta. Si algo falla, deshace lo creado. El número de WhatsApp y el
estado de la suscripción solo se cambian así (service role), nunca desde la app.

**Número de WhatsApp de un consultorio ya creado** (también con la service role):

```bash
npm run clinic:set-whatsapp -- --clinic sonrisas                                # muestra el número actual
npm run clinic:set-whatsapp -- --clinic sonrisas --whatsapp-from +52XXXXXXXXXX  # asigna o cambia
npm run clinic:set-whatsapp -- --clinic sonrisas --remove                       # lo quita
```

El plan de la cuenta debe incluir el bot (`bot_required` si no) y el número es único
entre consultorios. Debe coincidir con el remitente de Twilio ("To" del webhook), y
ese remitente tiene que apuntar a `https://<PUBLIC_BASE_URL>/api/whatsapp`.

Es una sola instancia para todos los consultorios (un deploy de Vercel, un proyecto
de Supabase, una cuenta de Resend con un solo `EMAIL_FROM`): lo único propio de cada
consultorio es su fila en `clinics`, su `reception_email` y su remitente de WhatsApp en Twilio.

Más sobre planes, topes y cómo probarlos en [Planes y topes](#planes-y-topes).

**Invitaciones**: el owner invita a dentistas y recepcionistas desde
`/configuracion/personal`. El correo de invitación usa la plantilla
`supabase/templates/invite.html` (configurada en `supabase/config.toml`), que
lleva a `/auth/confirm` → abre la sesión → `/auth/aceptar-invitacion` para
definir la contraseña. En local los correos se ven en el servidor de prueba de correo
(http://127.0.0.1:54324).

**Supabase en la nube**: `supabase/config.toml` solo rige el entorno local; en el
dashboard hay que repetir estos ajustes (o aplicarlos con `npx supabase config push`):

- *Authentication → Providers → Email*: proveedor **habilitado** (si no, el login
  falla con `email_provider_disabled`).
- *Authentication → Sign In / Providers*: **desactivar** "Allow new users to sign up"
  (las cuentas solo se crean por invitación o con `scripts/create-clinic.ts`).
- *Authentication → Email Templates → Invite user*: copiar la plantilla
  `supabase/templates/invite.html`.
- *Authentication → URL Configuration*: la URL de la app en *Site URL* y en
  *Redirect URLs*.

Desactivar a alguien (`active = false`) le quita el acceso de inmediato.

**Suscripción**: con `subscription_status` en `past_due` o `canceled` el
consultorio queda en solo lectura (la RLS rechaza las escrituras); si tiene bot, los
mensajes entrantes se siguen guardando y el bot responde un texto fijo sin IA
("Recibimos tu mensaje; el consultorio te contactará pronto").

## Planes y topes

Cada consultorio pertenece a una **cuenta** (`accounts`) con un plan. Los topes los
hace cumplir la base (triggers), no solo el panel, y la única fuente de verdad es la
función SQL `account_entitlements()`.

| | Básico | Básico + Bot | Pro | Plus |
|---|---|---|---|---|
| Consultorios | 1 | 1 | hasta 3 | ilimitados |
| Doctores (personas distintas por cuenta; el owner cuenta) | 1 | 1 | hasta 3 | ilimitados |
| Recepción | 1 por consultorio | 1 por consultorio | 1 por consultorio | 1 por consultorio |
| Bot de WhatsApp | no | sí (complemento) | sí | sí |

- Un usuario puede ser personal de varios consultorios de su cuenta y cambia de
  consultorio activo con el selector de la barra lateral (aparece con 2 o más).
- `/configuracion/plan` (solo owner) muestra el plan y el uso contra cada tope.
- **Sin bot** (`bot_enabled = false`): no se asigna `whatsapp_from` y el panel oculta
  Conversaciones y los ajustes del bot. Las acciones de la bandeja (responder,
  pausar el bot, marcar leído o resuelto) también se rechazan en el servidor.
- Bajar de plan no borra nada: solo se bloquean las altas nuevas y el panel avisa del exceso.
  El consultorio **conserva su número**. Los mensajes que lleguen a ese número **no se
  guardan** (ni paciente, ni conversación, ni mensaje) ni pasan por el bot. El paciente
  recibe un texto fijo (`BOT_DISABLED_REPLY` en `src/lib/bot/replies.ts`) **como mucho una
  vez cada 24 h** por número. Para el límite solo se guarda el consultorio, el teléfono y
  la fecha de la última respuesta (`whatsapp_disabled_replies`), nunca el texto.
- El cobro es con Stripe (ver [Cobro con Stripe](#cobro-con-stripe)). Las tarifas están en
  `un plan de negocio no incluido en la copia pública`.

**Cambiar el plan de una cuenta** (service role):

```bash
npm run plan:set -- --clinic basico                          # solo muestra plan, topes y uso
npm run plan:set -- --clinic basico --plan pro               # sube a Pro
npm run plan:set -- --clinic basico --plan basic --bot-addon on
npm run plan:set -- --account <account_id> --plan plus
```

**Feature flags** (tabla `feature_flags`, helper `isEnabled(flag, accountId)` en
`src/lib/flags.ts`). Toda función nueva se despliega apagada; se enciende por cuenta (o
global) sin redeploy. La excepción de la cuenta gana sobre el valor global:

```bash
npm run flag:set -- --flag pdf_documents                          # muestra los valores
npm run flag:set -- --flag pdf_documents --clinic sonrisas --on   # cuenta piloto
npm run flag:set -- --flag pdf_documents --on                     # global
npm run flag:set -- --flag pdf_documents --clinic sonrisas --clear
```

`pdf_documents` activa el **recibo de pago** y el **presupuesto del plan** en PDF
(`@react-pdf/renderer`), guardados en el bucket privado `receipts` de Supabase Storage bajo
`<clinic_id>/…` y descargados con una URL firmada de 60 s (`getPaymentReceiptUrl`, `getPlanBudgetUrl`).

**Probarlo en local** (`npx supabase start && npx supabase db reset`, luego `npm run dev`;
contraseña `demo1234`):

| Cuenta | Qué debería verse |
|---|---|
| `dueno.basico@demo.local` (Básico) | Sin Conversaciones; `/conversaciones` muestra «Activa el bot de WhatsApp»; en Plan, consultorios y doctores en 1 de 1; al invitar, el dentista aparece bloqueado; en un paciente, la pestaña Conversación pide subir de plan. |
| `dentista@demo.local` (Pro, Sonrisas) | Plan con «Bot de WhatsApp activo»; al invitar, la recepción sale en tope. |
| `recepcion@demo.local` | No ve «Plan»; `/configuracion/plan` da 404. |
| `dueno.norte@demo.local` (Pro, Dental Norte) | Solo ve los datos de su consultorio. |

Para ver el selector, suma una segunda sede a la cuenta de Sonrisas (id fijo en el seed) y
entra con `dentista@demo.local`:

```bash
npm run clinic:create -- --account ac000000-0000-0000-0000-00000000000a \
  --name "Sonrisas Sur" --slug sonrisas-sur
```

`npx supabase db reset` deja todo como al inicio.

## Cobro con Stripe

Una suscripción mensual en MXN por cuenta. Sus **ítems** fijan el plan: un precio base
(Básico, Pro o Plus), el complemento Bot (solo sobre Básico) y el consultorio extra de Plus
(cantidad = consultorios por encima de 5). Solo el owner contrata o cambia el plan, en
`/configuracion/plan`:

- **Contratar** abre Stripe Checkout (con Stripe Tax: los precios no incluyen IVA).
- **Desde la landing** (`PlanCheckoutForm`, `startPublicCheckout`) cualquiera paga sin cuenta previa: Checkout pide
  correo y nombre del consultorio, y el webhook (`checkout.session.completed` con `metadata.source = landing`) crea la
  cuenta, el consultorio y al owner, y le manda la invitación (`provisionFromCheckout`, idempotente por
  `accounts.stripe_checkout_session_id`). Si el correo ya es personal de una cuenta, no crea nada y avisa a Sentry
  (`stripe.provision.email_exists`): queda para reembolso o alta manual. Quien deje vencer la invitación usa
  «Olvidé mi contraseña» en `/login`. Plan: `docs/plans/2026-10-08_1746_checkout-directo-landing.md`.
- **Cambiar de plan** (`changePlan`) modifica los ítems de la suscripción con prorrateo
  inmediato; si falla el cobro no cambia nada.
- **Gestionar facturación** abre el Customer Portal (tarjeta, facturas, cancelar). El cambio
  de plan del portal debe quedar **apagado**: dejaría cobrando ítems que el plan ya incluye.

Las pantallas no escriben `plan` ni `bot_addon`: los escribe el webhook cuando Stripe lo
confirma, con `stripe_apply_subscription()` (solo `service_role`), que también pone el
`subscription_status` de todos los consultorios de la cuenta:

| Estado en Stripe | `subscription_status` |
|---|---|
| `active`, `trialing` | `active` |
| `past_due`, `unpaid`, `incomplete`, `paused` | `past_due` (solo lectura) |
| `canceled`, `incomplete_expired` | `canceled` (solo lectura) |

Cancelar no baja el plan a Básico: el consultorio queda en solo lectura con su plan anterior.

### Configurar Stripe

1. **Precios.** Crea en Stripe 5 precios **mensuales, en MXN, sin IVA incluido**, con estas
   `lookup_key` exactas (la lista vive en `PRICE_KEYS`, `src/lib/stripe/subscription.ts`). El
   código busca los precios por la llave, no por su id, así que sandbox y producción usan el mismo código.

   | `lookup_key` | Precio (MXN/mes) |
   |---|---|
   | `citabot_basic` | 699 |
   | `citabot_pro` | 2,990 |
   | `citabot_plus` | 5,990 |
   | `citabot_bot` | 899 |
   | `citabot_extra_clinic` | 999 |

   Verifícalos con `npm run stripe:check` (solo lee: comprueba llaves, mensualidad, moneda y
   que los montos coincidan con la landing, `src/lib/planes-publicos.ts`).
2. **Variables** `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` (ver la tabla de abajo). Mejor
   una llave restringida (`rk_`) que una secreta (`sk_`). Para desarrollo, usa un sandbox, no producción.
3. **Webhook.** En producción, registra `https://<tu-dominio>/api/stripe/webhook` con los eventos
   `checkout.session.completed` y `customer.subscription.created|updated|deleted`, y copia su secreto
   de firma. La ruta valida `Stripe-Signature` y es idempotente (`stripe_events`); el middleware la excluye.
4. **Stripe Tax.** Hace falta la dirección de la oficina principal (si no, Checkout falla con
   «valid head office address»). Para que se cobre el IVA, además un **registro fiscal** de México:
   sin él la factura sale con IVA 0 (`not_collecting`). Es una decisión fiscal, no técnica.
5. **Customer Portal** activado, con el cambio de suscripción apagado.

### Probar en local

Con un sandbox de Stripe (nunca la cuenta real) y el CLI (`npm i -g @stripe/cli`; npm puede pedir
aprobar su `postinstall`):

```bash
stripe listen --api-key "$STRIPE_SECRET_KEY" \
  --forward-to localhost:3000/api/stripe/webhook \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted
```

`stripe listen` imprime el `whsec_...` para `STRIPE_WEBHOOK_SECRET` (también lo da `stripe listen --print-secret`).
Si usas `stripe login`, su sesión caduca en horas; con `--api-key` no depende de ella. Para que Checkout te
devuelva a `localhost`, arranca con `PUBLIC_BASE_URL=http://localhost:3000 npm run dev` y abre la app por
`localhost` (no `127.0.0.1`: las cookies de sesión son distintas). Crea una cuenta de prueba con
`npm run clinic:create -- ... --plan basic` (el correo de invitación llega a Mailpit, `http://127.0.0.1:54324`),
contrata con la tarjeta `4242 4242 4242 4242` y mira `accounts` y `clinics.subscription_status`.

Pendiente: resincronizar el ítem de consultorios extra de Plus al crear o borrar consultorios, y los casos que
no se han probado (renovación fallida real y bajar de plan con exceso). Ver
`docs/plans/2026-10-07_1431_todo-cambio-de-plan-stripe.md`.

## Checklist de producción

Lo que hay que hacer una vez, antes de abrir la landing al público. El deploy en sí (Vercel, dominio, Twilio, Resend)
está en `docs/plans/2026-09-25_1525_deploy-produccion-y-sentry.md`. Marca cada punto al terminar.

**Base de datos (Supabase Cloud)**
- [ ] Aplicar las migraciones con `npx supabase db push` (nunca `db reset` ni el seed: trae usuarios demo). Hay dos
      nuevas del cobro: `20261007000001_stripe.sql` y `20261008000001_alta_desde_checkout.sql`.
- [ ] Authentication → Email: proveedor habilitado y registro abierto **desactivado** (`[auth] enable_signup = false`;
      ver «Supabase: auth.email provider» en las notas del proyecto).
- [ ] Plantillas de correo, pegando el HTML de `supabase/templates/`: *Invite user* = `invite.html` y *Reset password* =
      `recovery.html` (asunto «Define tu contraseña del CRM dental»). `config.toml` solo rige en local.
- [ ] URL Configuration: Site URL = el dominio de producción y Redirect URLs = `https://<dominio>/**`.
- [ ] SMTP propio (Resend) en Auth → SMTP Settings: las invitaciones y la recuperación dependen del correo.

**Stripe (modo live; sandbox y live son independientes)**
- [ ] Los 5 precios mensuales en MXN con sus `lookup_key` (`citabot_basic`, `citabot_pro`, `citabot_plus`, `citabot_bot`,
      `citabot_extra_clinic`) y `npm run stripe:check` con la llave live.
- [ ] Webhook: endpoint `https://<dominio>/api/stripe/webhook` con `checkout.session.completed` y
      `customer.subscription.created|updated|deleted`; copiar su `whsec_...` a `STRIPE_WEBHOOK_SECRET`.
      Sin él, el pago se cobra pero la cuenta no se crea.
- [ ] `STRIPE_SECRET_KEY` con una llave live, mejor restringida (`rk_live_...`).
- [ ] Customer Portal activado, con el cambio de suscripción **apagado**.
- [ ] Stripe Tax: dirección de la oficina principal y registro fiscal de México (sin él, la factura sale con IVA 0).
- [ ] Datos públicos del negocio en el Dashboard: nombre, logo y URL del aviso de privacidad (es lo que ve quien paga).
- [ ] Probar un pago real de poco monto con una tarjeta propia y reembolsarlo antes de anunciar la landing.

**Variables de entorno (Vercel, Production)**
- [ ] Todas las de la tabla de abajo, menos `DEV_CLINIC_ID`, `WECHATY_*` y `DEV_ALLOW_REMOTE_DB`.
- [ ] `PUBLIC_BASE_URL` y `NEXT_PUBLIC_SITE_URL` iguales al dominio real, sin `/` final (Twilio firma `PUBLIC_BASE_URL`;
      Stripe vuelve a esa URL tras pagar).
- [ ] `NEXT_PUBLIC_PRIVACY_URL` con el aviso de privacidad (se muestra junto al botón de pagar en Checkout).
- [ ] Las variables `NEXT_PUBLIC_*` van antes del primer build: se inyectan al compilar.

**Verificación después del deploy**
- [ ] `/` carga por HTTPS y los botones de tarifas abren Checkout con el monto correcto (699, 1,598, 2,990 y 5,990).
- [ ] Tras pagar: llega a `/contratar/gracias`, el webhook responde 200 en Stripe → Developers → Webhooks, la cuenta aparece
      con su plan y el owner recibe la invitación.
- [ ] El enlace de la invitación abre `/auth/aceptar-invitacion`, guarda la contraseña y entra al panel; «Olvidé mi
      contraseña» envía el correo de recuperación.
- [ ] Sentry recibe errores (`NEXT_PUBLIC_SENTRY_DSN`) y hay un aviso por email para issues nuevos
      (`stripe.provision.email_exists` pide acción manual).
- [ ] Twilio y Resend: lo del plan de deploy (número de WhatsApp, webhook `/api/whatsapp`, dominio del remitente).

## WhatsApp con Twilio (desarrollo)

1. En la consola de Twilio, activa el **sandbox de WhatsApp**
   (*Messaging → Try it out → Send a WhatsApp message*) y copia `TWILIO_ACCOUNT_SID`
   y `TWILIO_AUTH_TOKEN` a `.env`.
2. Levanta la app (`npm run dev`) y exponla con ngrok:

   ```bash
   ngrok http 3000
   ```

   Pon la URL https que imprime ngrok (sin `/` final) en `PUBLIC_BASE_URL` y
   reinicia `npm run dev`. Twilio firma esa URL: si no coincide, el webhook responde 403.
3. En la configuración del sandbox, en **When a message comes in**, pon
   `https://<ngrok>/api/whatsapp` (método POST). El callback de estado
   (`/api/whatsapp/status`) lo manda la app en cada envío; no hay que configurarlo.
4. Desde un teléfono, únete al sandbox (envía `join <palabra>` al `+1 415 523 8886`)
   y escribe "quiero una cita".

Resultado esperado: el bot ofrece de inmediato 3 horarios reales del consultorio
A; al elegir uno te pide tu nombre (eres un paciente "por identificar"), lo guarda
y agenda la cita (aparece en la agenda con el icono de WhatsApp). Cuando la recepción responde desde la bandeja,
el bot queda pausado para ese paciente.

Notas:

- El webhook identifica el consultorio por el número `To` (`clinics.whatsapp_from`);
  si ningún consultorio lo tiene, descarta el mensaje con un log.
- Es idempotente por `MessageSid`: los reintentos de Twilio no duplican mensajes.
- Responde a Twilio de inmediato con TwiML vacío; el bot corre después con
  `after()` y su respuesta sale por la API REST.
- Fuera de la ventana de 24 h de WhatsApp, los mensajes libres fallan (error
  63016): se guardan como `failed` y el panel lo indica.
- Si llega solo multimedia (foto, audio), se guarda y el bot pide que escriba el
  mensaje, sin llamar a Claude.
- Los celulares de México llegan como `+521…`: el paciente se guarda y se busca
  como `+52` + 10 dígitos (`normalize_phone`), y se responde al `From` original.

## Probar el bot sin WhatsApp: simulador en la terminal

```bash
npx supabase start && npx supabase db reset
npm run bot:chat -- [--phone +5215500000001]
```

Hablas con el agente como si fueras un paciente, con un teléfono ficticio. Usa
la misma lógica que el webhook (guarda mensajes, agenda en la base, escala) contra
Supabase local, y no toca WhatsApp ni Twilio. Requiere `ANTHROPIC_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (la llave **Secret** que imprime `supabase start`) y
`DEV_CLINIC_ID`: **cada mensaje llama a Claude y cuesta tokens**. `/media`
simula una foto sin texto; `/salir` termina.

**`DEV_CLINIC_ID`**: es el consultorio con el que habla el simulador. Con el seed,
el consultorio A ("Sonrisas": tiene horario, correo de recepción y el número del
sandbox de Twilio) es:

```
DEV_CLINIC_ID=f0000000-0000-0000-0000-00000000000a
```

El consultorio B ("Dental Norte") es `f0000000-0000-0000-0000-00000000000b`. Para
otro consultorio, consulta su id en Studio (http://127.0.0.1:54323) → SQL Editor:

```sql
select id, name, slug from public.clinics;
```

El script se niega a correr si la URL de Supabase no es local, salvo que se
defina `DEV_ALLOW_REMOTE_DB=true`.

## Eval del bot (cuesta dinero)

```bash
npm run eval:bot            # imprime el costo estimado y pide confirmación
npm run eval:bot -- --yes   # sin confirmación
```

~30 conversaciones en español (`scripts/eval/cases.ts`: agendar, fechas
relativas, cancelar con más y menos de 24 h, urgencias, pedir una persona,
preguntas fuera de agenda, paciente nuevo e intentos de manipulación) contra el
modelo real. Las herramientas corren sobre datos en memoria; se revisa qué
herramienta se llamó, si escaló y el cumplimiento de la política. Estimado:
~$1.2 USD por corrida (tope teórico ~$4).

## Bot de WhatsApp con Wechaty (solo desarrollo)

```bash
npm run bot:dev
```

Se conecta a una cuenta real de WhatsApp: úsalo solo con la cuenta de quien
lo corre. Requiere Supabase local y `DEV_CLINIC_ID`: guarda los mensajes y
responde con el mismo agente que el webhook. Al iniciar muestra un código QR en
la terminal; escanéalo desde WhatsApp (**Dispositivos vinculados → Vincular un
dispositivo**). La sesión queda guardada localmente.

## Variables de entorno

| Variable                        | Descripción                                                                 | Default                   |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | URL de la API de Supabase.                                                  | —                         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key de Supabase (pública; la seguridad la aplica RLS).                 | —                         |
| `SUPABASE_SERVICE_ROLE_KEY`     | Service role (se salta la RLS). Solo servidor: webhook, invitaciones y `create-clinic`. | —              |
| `TWILIO_ACCOUNT_SID`            | Account SID de Twilio.                                                      | —                         |
| `TWILIO_AUTH_TOKEN`             | Auth Token de Twilio; también valida la firma de los webhooks.              | —                         |
| `TWILIO_WHATSAPP_FROM`          | Número del sandbox (referencia). El número de cada consultorio es `clinics.whatsapp_from`. | `whatsapp:+14155238886` |
| `PUBLIC_BASE_URL`               | URL pública de la app sin `/` final (ngrok en desarrollo).                  | —                         |
| `STRIPE_SECRET_KEY`             | Llave de Stripe (`rk_`/`sk_`; `_test_` en sandbox). Solo servidor. Checkout, portal y lectura de precios. | — |
| `STRIPE_WEBHOOK_SECRET`         | Secreto de firma (`whsec_...`) del webhook `/api/stripe/webhook`.           | —                         |
| `NEXT_PUBLIC_PRIVACY_URL`       | URL del aviso de privacidad; se enlaza en el Checkout de la landing (sin ella no se muestra). | — |
| `NEXT_PUBLIC_SITE_URL`          | URL pública de la landing (canonical, sitemap, robots).                     | `https://citabot.maoli.ws` |
| `ANTHROPIC_API_KEY`             | API key de Anthropic (webhook, `bot:chat` y `eval:bot`).                    | —                         |
| `CLAUDE_MODEL`                  | Modelo del agente.                                                          | `claude-sonnet-5`         |
| `CLAUDE_BOT_EFFORT`             | Esfuerzo del modelo (`low`, `medium`, `high`, `xhigh`, `max`).              | `low`                     |
| `RESEND_API_KEY`                | API key de Resend para avisar por email a la recepción al escalar.          | — (sin email)             |
| `EMAIL_FROM`                    | Remitente de esos avisos (dominio verificado en Resend).                    | —                         |
| `DEV_CLINIC_ID`                 | Consultorio de `bot:chat` y `bot:dev` (solo desarrollo). Con el seed: `f0000000-0000-0000-0000-00000000000a`. | —                         |
| `WECHATY_PUPPET`                | Puppet de Wechaty a utilizar (solo desarrollo).                             | `wechaty-puppet-whatsapp` |
| `WECHATY_PUPPET_HEADLESS`       | `false` para ver la ventana de Chrome (útil para depurar el login con QR). | `true`                    |

## Estructura

```
/
├─ src/
│  ├─ app/                     # páginas del panel (App Router)
│  │  ├─ api/whatsapp/         # webhook de Twilio (route.ts) y callback de estado (status/)
│  │  ├─ api/stripe/webhook/   # webhook de Stripe (firma, idempotencia, sincroniza el plan)
│  │  └─ auth/confirm/         # enlace de invitación -> sesión
│  ├─ lib/
│  │  ├─ supabase/             # clientes: server.ts, client.ts, middleware.ts, admin.ts (service role)
│  │  ├─ db/                   # capa de datos: lecturas + server actions (zod)
│  │  ├─ whatsapp/             # Twilio, números, webhook (inbound), envío (outbound)
│  │  ├─ stripe/               # precios (lookup_key), Checkout/cambio de plan/portal, sincronización
│  │  ├─ notify/email.ts       # avisos por email (Resend)
│  │  └─ bot/                  # agente, herramientas, huecos y prompt (independiente del canal)
│  ├─ types/database.ts        # tipos de la base (formato de `supabase gen types`)
│  └─ middleware.ts            # refresca la sesión y redirige a /login
├─ scripts/
│  ├─ create-clinic.ts         # alta de consultorios y cuentas (service role)
│  ├─ set-plan.ts              # cambia plan y complemento de bot (npm run plan:set)
│  ├─ set-flag.ts              # feature flags globales o por cuenta (npm run flag:set)
│  ├─ check-stripe-prices.ts   # verifica los precios de Stripe (npm run stripe:check)
│  ├─ bot-chat.ts              # simulador de chat en la terminal (npm run bot:chat)
│  ├─ eval-bot.ts, eval/       # eval del bot con el modelo real (npm run eval:bot)
│  ├─ lib/dev-channel.ts       # canal de desarrollo compartido (bot:chat y Wechaty)
│  └─ wechaty-dev.ts           # canal Wechaty para desarrollo
├─ tests/                      # vitest
└─ supabase/
   ├─ config.toml
   ├─ migrations/              # esquema, RLS, WhatsApp y bot con IA
   ├─ templates/invite.html    # correo de invitación
   └─ seed.sql                 # datos de ejemplo (3 consultorios, 3 cuentas)
```

## Base de datos

Esquema en `supabase/migrations/`:

- `clinics` (consultorio: nombre, slug, zona horaria, número de WhatsApp,
  estado de la suscripción, horario de atención por día, duración de cita por
  defecto y correo de la recepción) y `staff` (personal ligado a `auth.users` y a un
  consultorio; rol `owner`, `dentist` o `receptionist`).
- Tablas de negocio, todas con `clinic_id`: `patients`, `treatments` (catálogo),
  `treatment_plans` → `treatment_plan_items`, `appointments`, `payments`,
  `clinical_notes`, `conversations` y `messages`.
- `clinic_id` tiene default `current_clinic_id()`: la app no lo manda y nadie
  puede escribir en otro consultorio.
- Las referencias entre tablas son llaves foráneas compuestas
  (`(patient_id, clinic_id) → patients(id, clinic_id)`, etc.): no se puede ligar
  una cita, pago o nota a un registro de otro consultorio aunque se conozca su id.
- El teléfono del paciente es único por consultorio; el nombre del tratamiento también.
- Pacientes "por identificar" (`status = 'unidentified'`): los crea el webhook
  solo con el teléfono; al guardar el nombre desde el panel pasan a `active`.
- `conversations`: una por paciente, con el estado del bot (`bot_state`),
  `bot_paused`, `unread_count`, `last_message_at` y la marca "requiere atención"
  (`needs_attention`, `attention_category`, `attention_reason`, `escalated_at`)
  cuando el bot escala a la recepción. `messages`: entrantes y
  salientes (paciente, bot, recepción) con `twilio_sid` único y estado de entrega.
  Ambas publicadas en Supabase Realtime.
- Vista `patient_balances`: total (items no cancelados), pagado y saldo por plan;
  los pagos sin plan aparecen en una fila con `plan_id` nulo.
- `appointments` tiene una restricción de exclusión (`btree_gist`) que impide
  que un dentista tenga dos citas no canceladas traslapadas; la capa de datos
  traduce ese error a "El dentista ya tiene una cita en ese horario".

Permisos (RLS), siempre dentro del consultorio del usuario:

- Todo el personal activo: alta, edición y consulta de pacientes, citas y
  pagos; lectura del catálogo, planes, saldos y personal; bandeja de WhatsApp
  (leer, responder, pausar el bot, marcar como leído).
- `dentist` y `owner`: escritura de catálogo, planes e items, y cualquier acceso
  a las notas clínicas (la recepción no las ve). El owner cuenta como dentista.
- `owner`: administra el personal (con su sesión no puede sumar a personal de
  otra cuenta ni cambiar el usuario de una fila de `staff`) y edita nombre, zona horaria, horario,
  duración de cita y correo de la recepción del consultorio.
- Cualquier persona del personal marca una conversación como resuelta
  (`needs_attention = false`) y reanuda el bot.
- Suscripción `past_due` o `canceled`: solo lectura.
- El webhook escribe con la service role, a través de las funciones
  `whatsapp_register_inbound` y `whatsapp_update_status` (solo `service_role`).
  El bot usa además `bot_acquire_turn` / `bot_release_turn`, un candado por
  conversación para que dos mensajes simultáneos no pisen `bot_state`.

## Tests

```bash
npm test
```

Prueban el webhook y el callback de estado de punta a punta (firma real de
Twilio, idempotencia, bot pausado, paciente "por identificar", +52/+521,
respuestas fijas), el cálculo de huecos (horario partido, citas existentes,
anticipación, horizonte, zona horaria, dentista habitual), las reglas de las
herramientas (24 h, huecos ofrecidos, nombre antes de agendar, escalamiento y
email), el loop del agente con el Tool Runner real y el candado por
conversación. Los de Stripe (`tests/stripe/`) cubren el webhook con firma real del SDK, la
idempotencia, el mapeo de ítems y estados, y `changePlan`. Twilio, Anthropic (fetch simulado),
Resend, Stripe y la base de datos van mockeados: no se hace ninguna llamada de red.

vitest tiene dos proyectos: `server` (los anteriores, entorno Node) y `components`
(`tests/components/*.test.tsx`, Testing Library + jsdom) para los formularios del panel y la
landing: validación, errores del servidor, estados pendientes y modo solo lectura, con las
server actions y Supabase mockeados. Uno solo: `npx vitest run --project components`.

Pruebas de punta a punta (Playwright, carpeta `e2e/`) contra la app compilada y Supabase local
con la seed. `playwright.config.ts` compila y arranca la app en el puerto 3100 y lee las llaves
de `npx supabase status`; el servidor de pruebas no recibe llaves de Stripe, Twilio REST,
Anthropic ni Resend, así que no sale nada a internet:

```bash
npx supabase start && npx supabase db reset   # base con la seed
npx playwright install chromium               # una sola vez
npm run e2e
```

Cubren login y aislamiento entre consultorios, alta de paciente y cita desde la agenda, la
bandeja con el webhook de Twilio simulado (firma válida, firma inválida, reintento con el mismo
`MessageSid`), el bloqueo de la bandeja en el plan Básico y el checkout de la landing hasta donde
llega sin Stripe (error recuperable, página de gracias, webhook sin firma).

Pruebas SQL (pgTAP) contra la base local, en `supabase/tests/` (requieren
`npx supabase start` y la seed de `npx supabase db reset`; corren en una
transacción y no dejan cambios):

```bash
npx supabase test db
```

## Registro de errores (Sentry)

Los errores atrapados (webhook, bot, herramientas, Twilio, Resend, base de
datos) se reportan con `reportError` (`src/lib/observability.ts`), que hace
`console.error` y además manda el error a Sentry con tags de contexto (`where`,
`clinic_id`). Los no atrapados los captura `onRequestError`
(`src/instrumentation.ts`) y `global-error.tsx`/`(panel)/error.tsx` en el
cliente. **Sin `NEXT_PUBLIC_SENTRY_DSN` el SDK no envía nada**: en local y en
tests solo queda el `console.error`.

Los mensajes de WhatsApp y los datos de pacientes son información de salud, así
que la configuración (`src/lib/sentry/options.ts`) evita mandar nada de eso:

- `sendDefaultPii: false`, sin Session Replay.
- `beforeSend` (función `scrubEvent`) quita `request.data`, `cookies`,
  `headers`, `query_string` y el usuario, y enmascara teléfonos y correos
  dentro del mensaje del error y sus breadcrumbs (`[tel]` / `[email]`), por si
  Twilio o Postgres los incluyen.
- `reportError` nunca recibe teléfonos, nombres ni texto de mensajes en
  `extra`; de los errores de Supabase (objetos planos) solo se manda el
  código (`error.code`), no el mensaje completo.

### Configuración

```
NEXT_PUBLIC_SENTRY_DSN=   # DSN del proyecto en sentry.io; se inyecta en el build
SENTRY_ORG=               # org y proyecto de Sentry, y un auth token de "Project: Write"
SENTRY_PROJECT=           # (solo para subir source maps en el build; en Vercel,
SENTRY_AUTH_TOKEN=        #  marcar la variable solo para "Build")
```

Sin `SENTRY_AUTH_TOKEN` el build sigue igual, solo omite la subida de source
maps (los stacks de Sentry quedan minificados).

### Qué revisar en Sentry (Issues)

- Que aparezca el error, con su tag `where` (y `clinic_id` si aplica) y el
  stack legible (requiere el auth token en el build de esa versión).
- Que **no** traiga `request.data`, `cookies`, `headers` ni usuario, y que la
  URL no lleve query string.
- Si el mensaje del error incluía un teléfono o correo, que se vea como
  `[tel]` / `[email]` y no el dato real.
- Configura en Sentry (Alerts) un aviso por email para issues nuevos: hoy no
  hay nada que lo haga automáticamente.

## Arquitectura del bot

El bot separa la **capa de canal** de la **capa de negocio**: el webhook de
Twilio, el simulador `bot:chat` y Wechaty llaman al mismo `handleMessage()`.

```
WhatsApp ──► Twilio ──► /api/whatsapp ──► src/lib/whatsapp/inbound.ts ──┐
Terminal ──► scripts/bot-chat.ts ─────────► scripts/lib/dev-channel.ts ─┤
WhatsApp ──► scripts/wechaty-dev.ts ──────► scripts/lib/dev-channel.ts ─┘
                                                     │
          respuestas fijas (suscripción inactiva, solo multimedia) ◄───┤
                                                     ▼
                         src/lib/bot/agent.ts (handleMessage) ──► Claude (Tool Runner)
                                                     │
                                  tools.ts ──► repository.ts ──► Supabase (service role)
```

- `agent.ts`: por cada mensaje toma el candado de la conversación, arma el
  contexto (últimos 20 mensajes; paciente = user, bot/recepción = assistant),
  corre el loop de herramientas con `client.beta.messages.toolRunner()` y
  `betaZodTool`, y guarda `bot_state`. Modelo `CLAUDE_MODEL` (default
  `claude-sonnet-5`, thinking adaptativo por defecto) con `output_config.effort`
  bajo. El system prompt tiene una parte fija cacheada (prompt caching) y una
  variable (consultorio, fecha y hora local, horario, paciente y sus citas).
- `tools.ts`: `buscar_horarios`, `agendar_cita`, `mis_citas`, `cancelar_cita`,
  `reagendar_cita`, `guardar_nombre` y `escalar_a_recepcion`. Si una regla falla,
  la herramienta devuelve un error explicativo al modelo.
- `slots.ts`: huecos dentro del horario del consultorio y con la duración por
  defecto, sin traslapes por dentista, con 2 h de anticipación y 14 días de
  horizonte, prefiriendo al dentista habitual (el de la última cita).
- Escalamiento: pausa el bot, marca "requiere atención", avisa por email
  (Resend) y responde al paciente un texto fijo (`replies.ts`). Casos: pide una
  persona, urgencia, cancelar/reagendar con menos de 24 h, dos turnos seguidos
  sin entender, y temas fuera de agenda.
- `repository-supabase.ts` (service role) y `memory-repository.ts` (tests y eval)
  implementan la misma interfaz `BotRepository`.

## Limitaciones conocidas

- El bot no responde preguntas generales (precios, ubicación, formas de pago):
  las escala a la recepción. No hay días festivos ni vacaciones, solo el horario semanal.
- Fuera de la ventana de 24 h solo se podrá escribir con plantillas (pendiente).
- `wechaty-puppet-whatsapp` usa WhatsApp Web no oficial; solo se usa en desarrollo.
- El bot calcula los huecos libres por consultorio. Si un doctor trabaja en dos sedes,
  podría ofrecer en una un horario que ya tiene ocupado en la otra. La base lo rechaza
  al agendar (`appointments_no_overlap`), pero el paciente ya vio ese horario como libre.
- El tope de 1 recepcionista por consultorio está escrito en dos funciones SQL: el
  trigger `staff_enforce_plan_limits` y `my_entitlements`. Si cambia, hay que cambiarlo en las dos.
- Stripe: las cuentas existentes y el alta de cuentas nuevas siguen siendo manuales (`clinic:create`,
  `plan:set`). `set-plan.ts` cambia el plan en la base pero **no** la suscripción de Stripe: en una
  cuenta que ya paga con Stripe, el siguiente evento del webhook lo sobrescribe.
