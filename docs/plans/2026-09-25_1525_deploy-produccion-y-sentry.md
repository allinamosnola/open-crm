# Deploy de MyCRM en consultorio.maoli.ws (Vercel + Supabase Cloud)

## Context
El CRM (Next.js 16 + Supabase + Twilio + Claude + Resend) solo corre en local. Se quiere publicar
en `https://consultorio.maoli.ws`. Decisiones: hosting en **Vercel**, y **aún no existe** el proyecto
Supabase en la nube. El bot de Wechaty (`bot:dev`) es solo desarrollo y NO se despliega (nunca ejecutar
el bot real; ver memoria). La producción usa Twilio.

## Paso 0 (previo al deploy): Sentry para registro de errores
Decisiones: alcance servidor + cliente + bot; scrubbing estricto (datos de salud); cuenta Sentry por crear.

Hallazgo clave: hoy casi todos los errores se atrapan y solo hacen `console.error` (webhook `src/app/api/whatsapp/route.ts`,
`src/lib/whatsapp/inbound.ts`, `src/lib/bot/agent.ts` y `tools.ts`, `src/lib/whatsapp/twilio.ts`, `src/lib/notify/email.ts`,
`src/lib/db/errors.ts`, `staff.ts`, `conversations.ts`). Sentry NO los vería solo con instalarlo, así que hay que reportarlos explícitamente.

### 0.1 Tú
Crear cuenta y proyecto Next.js en sentry.io (plan Developer basta) y pasarme/cargar: DSN, org, project slug y un Auth Token (source maps).

### 0.2 Yo (código)
1. Antes de instalar: `npm view @sentry/nextjs peerDependencies` para confirmar soporte de Next 16.3 y React 19.2; leer `node_modules/next/dist/docs` de instrumentation (ya revisado: `register` + `onRequestError`).
2. `npm i @sentry/nextjs`.
3. Archivos nuevos:
   - `src/instrumentation.ts`: `register()` carga la config de servidor/edge según `NEXT_RUNTIME`; `export const onRequestError = Sentry.captureRequestError`.
   - `src/instrumentation-client.ts`: `Sentry.init` del navegador (DSN público, sin Session Replay) + `onRouterTransitionStart`.
   - `sentry.server.config.ts` y `sentry.edge.config.ts`.
   - `src/lib/observability.ts`: `reportError(error, { where, clinicId?, extra? })` = `console.error` + `Sentry.captureException` con tags (`where`, `clinic_id`); nunca recibe teléfonos ni texto de mensajes.
   - `src/app/global-error.tsx`; y `captureException` en `src/app/(panel)/error.tsx` existente.
4. Config compartida de scrubbing: `sendDefaultPii: false`, `beforeSend` que borra `request.data`, `cookies`, `headers` y query strings; `tracesSampleRate` bajo (0.1), sin profiling; ignora errores esperados (ZodError de validación, RLS 42501, enlace de invitación vencido).
5. `next.config.ts`: `withSentryConfig` (org/project, subida de source maps con `SENTRY_AUTH_TOKEN`, `hideSourceMaps`, `silent` fuera de CI).
6. Sustituir `console.error` por `reportError` en los ~15 puntos listados (conservando los mensajes en español). En el `after()` del webhook, `await Sentry.flush(2000)` al final: en Vercel la función termina y podría perder el evento.
7. `.env.example`: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (solo build). Sin DSN el SDK queda inactivo (dev/tests no envían nada).
8. Tests vitest: `reportError` llama a Sentry con tags y sin PII; `beforeSend` elimina body/headers; los tests existentes del webhook/bot siguen verdes (mock de `@sentry/nextjs` en `tests/`).

### 0.3 Verificación de Sentry
`npm run build`, `npm run lint`, `npm test`. Con el DSN en `.env` local, una ruta temporal que lance un error → aparece en Sentry con stack legible y sin body/headers → borrar la ruta. No usar el bot real ni Twilio. Configurar en Sentry una alerta por email para issues nuevos.

### 0.4 Vercel
Añadir al paso 2 las variables de Sentry (`SENTRY_AUTH_TOKEN` marcada solo para Build). Alternativa: integración oficial Sentry–Vercel, que las carga sola.

## Pasos de deploy

### 1. Supabase Cloud
1. Crear proyecto en supabase.com (región cercana a México, p. ej. us-east / us-west). Guardar la contraseña de la BD.
2. Enlazar y aplicar migraciones (NO `db reset` ni `seed.sql`: el seed trae usuarios demo `demo1234`):
   `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`
3. Dashboard → Authentication (repetir lo que solo rige en local, según README):
   - Email provider **habilitado**.
   - **Desactivar** "Allow new users to sign up" (va en [auth], no en [auth.email]; ver memoria).
   - Plantilla *Invite user* = `supabase/templates/invite.html`.
   - URL Configuration: Site URL `https://consultorio.maoli.ws`; Redirect URLs `https://consultorio.maoli.ws/**`.
4. Anotar: Project URL, publishable key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), secret key (`SUPABASE_SERVICE_ROLE_KEY`).
5. SMTP propio (Resend) en Auth → SMTP Settings: el SMTP por defecto de Supabase está muy limitado y las invitaciones dependen del correo.

### 2. Vercel
1. Importar el repo `allinamosnola/dental-saas` (branch `main`); framework Next.js autodetectado, sin `vercel.json`.
2. Variables de entorno (Production), según `.env.example`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`,
   `PUBLIC_BASE_URL=https://consultorio.maoli.ws` (sin "/" final; Twilio firma esta URL, si no coincide el webhook da 403),
   `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_BOT_EFFORT`, `RESEND_API_KEY`, `EMAIL_FROM`.
   NO poner `DEV_CLINIC_ID`, `WECHATY_*` ni `DEV_ALLOW_REMOTE_DB`.
3. `NEXT_PUBLIC_*` se inyectan en build: definirlas antes del primer deploy.
4. Plan: `src/app/api/whatsapp/route.ts` usa `after()` con `maxDuration = 60`; cabe en Hobby, pero Hobby es no comercial → usar **Pro** para un consultorio real.

### 3. Dominio
1. Vercel → Settings → Domains → agregar `consultorio.maoli.ws`.
2. En el DNS de maoli.ws: `CNAME consultorio → cname.vercel-dns.com` (o el valor exacto que muestre Vercel). Si Cloudflare: proxy apagado (DNS only).
3. Esperar propagación y certificado HTTPS automático.

### 4. Twilio (producción)
- El sandbox es solo pruebas; para producción registrar un remitente de WhatsApp Business (número propio) en Twilio.
- *When a message comes in*: `https://consultorio.maoli.ws/api/whatsapp` (POST). El status callback lo manda la app.
- Asignar el número al consultorio: `clinics.whatsapp_from` vía `npm run clinic:create -- --whatsapp-from +52...` (el webhook identifica el consultorio por `To`).
- Para un consultorio ya creado (o para cambiar/quitar el número): `npm run clinic:set-whatsapp -- --clinic <slug> --whatsapp-from +52...` (o `--remove`; sin opciones muestra el número actual). Requiere que el plan incluya el bot y que el número no lo tenga otro consultorio.
- Es una sola instancia (Vercel, Supabase y Resend compartidos); por consultorio solo se contrata un remitente de WhatsApp en Twilio, todos con el mismo webhook.

### 5. Resend
Verificar el dominio del remitente (`EMAIL_FROM`) en Resend; sin esto no salen avisos de escalamiento.
Un solo dominio y un solo `EMAIL_FROM` para todos los consultorios; el destinatario de cada uno es su `reception_email` (se captura en la configuración del consultorio en el panel; vacío = no se envía correo).

### 6. Alta del primer consultorio
Apuntando `.env` local a producción solo para este comando (el script exige `DEV_ALLOW_REMOTE_DB` solo en el bot; `clinic:create` usa service role):
`npm run clinic:create -- --name "..." --slug ... --owner-email ... --owner-name "..." --whatsapp-from +52... --subscription active`
El owner recibe la invitación por correo → `/auth/confirm` → define contraseña.

### 7. Docs
Tras aprobar, copiar este plan a `docs/plans/2026-09-24_HHMM_deploy-produccion.md` y registrar en `docs/plans/README.md` (regla de CLAUDE.md: timestamp, sin sobrescribir).

## Riesgos
- `PUBLIC_BASE_URL` distinta a la URL real → webhook 403.
- `db push` desde el seed o `db reset` contra prod → borra datos/crea usuarios demo. Solo `db push`.
- Fuera de la ventana de 24 h de WhatsApp los mensajes libres fallan (63016); para producción real se requieren plantillas aprobadas.
- Migraciones futuras: `supabase db push` antes de cada deploy que las requiera.

## Verificación
1. `npm run build` y `npm test` en local antes de subir.
2. `https://consultorio.maoli.ws` carga con HTTPS y redirige a login; `/signup` no permite registro.
3. Login del owner tras aceptar la invitación; RLS: un usuario solo ve su consultorio.
4. Mensaje de WhatsApp real → aparece en la bandeja, el bot responde (revisar logs en Vercel y firma Twilio sin 403).
5. Escalar una conversación → llega el email de recepción.
