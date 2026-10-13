# Seguridad de CitaBot Dental

Resumen de cómo se protegen los datos (expedientes dentales: datos de salud) y qué revisar antes
de cada cambio. Complementa las migraciones en `supabase/migrations/` y los pgTAP en
`supabase/tests/`, que son la fuente de verdad.

## Modelo de acceso (mínimo privilegio)

| Actor | Credencial | Qué puede hacer |
|---|---|---|
| Visitante | `anon` | Landing y login. Sin acceso a tablas del CRM (RLS + `revoke`). |
| Personal (owner, dentist, receptionist) | Sesión de Supabase Auth → rol `authenticated` | Solo su **consultorio activo** (`current_clinic_id()`), por RLS en cada tabla. Escritura solo con suscripción `trial`/`active`. |
| Servidor (webhooks, jobs, acciones ya autorizadas) | `SUPABASE_SERVICE_ROLE_KEY` → `service_role` | Salta la RLS. Solo en `src/lib/supabase/admin.ts` (con `server-only`) y en los scripts del dueño del SaaS. |
| Dueño del SaaS | Service role desde `scripts/` | Alta de consultorios, planes, números de WhatsApp y feature flags. No existe un rol «superadmin» en la app. |

Reglas por rol dentro del consultorio (RLS, `20260922000002_rls.sql` y siguientes):

- Todo el personal: pacientes, citas y pagos (CRUD); lectura de catálogo, planes, saldos, personal
  y de los PDF del bucket `receipts`.
- `dentist` y `owner`: escritura de catálogo y planes; **solo ellos** ven notas clínicas.
- `owner`: administra al personal, ajustes del consultorio y es el **único que lee la bitácora**
  (`audit_log`).
- Registro público desactivado (`[auth] enable_signup = false`): el personal entra por invitación.

Dónde se usa la service role (revisar que cada uso esté autorizado antes en código):

- `src/app/api/whatsapp/*`: webhook de Twilio, tras validar `X-Twilio-Signature`.
- `src/app/api/stripe/webhook`: tras validar la firma de Stripe (`STRIPE_WEBHOOK_SECRET`).
- `src/lib/db/conversations.ts`: envío por Twilio y registro del estado, después de que la RLS
  aceptó el mensaje con la sesión del usuario.
- `src/lib/db/staff.ts`: invitar personal, después de comprobar que quien llama es owner.
- `src/lib/stripe/actions.ts`: sincronizar la suscripción de la cuenta del usuario.
- `src/lib/flags.ts`: leer feature flags (`feature_enabled` solo la ejecuta el servidor).

Funciones `security definer`: todas con `set search_path = ''`, nombres calificados y `revoke
execute ... from public, anon` (y de `authenticated` cuando no son para la sesión). Las que sí
usa la sesión (`my_entitlements`, `my_clinics`, `my_feature_enabled`) están acotadas a `auth.uid()`.

## Bitácora de auditoría

`audit_log` (`20261101000003_audit_log.sql`), alimentada por triggers en `patients`,
`clinical_notes`, `payments` y `staff`:

- **Quién**: `actor_id` (`auth.uid()`; null si fue la service role) y `actor_role`.
- **Qué**: tabla, id del registro, acción (`insert`/`update`/`delete`) y, en updates, los
  **nombres** de las columnas que cambiaron. Nunca los valores: el texto de una nota clínica o un
  teléfono no se duplican en la bitácora.
- **Cuándo**: `created_at`. **Dónde**: `clinic_id`.
- **Solo inserción**: sin `update`/`delete`/`truncate` para ningún rol de la API (tampoco la
  service role) y un trigger que los rechaza aunque alguien recupere el privilegio.
- Lectura: solo el owner de su consultorio (`listAuditLog` en `src/lib/db/audit.ts`).

## Archivos (Supabase Storage)

- Bucket `receipts` **privado** (solo PDF, 5 MB). Ruta `<clinic_id>/payments|plans/<id>.pdf`; las
  políticas de `storage.objects` exigen que la primera carpeta sea el consultorio activo.
- Descarga solo con URL firmada de 60 s, creada con la sesión del usuario. Sin políticas de
  borrado para el personal.
- Detrás del feature flag `pdf_documents` (apagado por defecto).

## Secretos

- Variables en `.env` (ignorado por git; plantilla sin valores en `.env.example`) y en Vercel.
  Solo las `NEXT_PUBLIC_*` llegan al navegador: URL de Supabase, llave `anon`, DSN de Sentry y URL
  de privacidad. **Nunca** prefijar con `NEXT_PUBLIC_` una llave secreta.
- Secretos del servidor: `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_AUTH_TOKEN`, `ANTHROPIC_API_KEY`,
  `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SENTRY_AUTH_TOKEN`. Los módulos
  que los leen importan `server-only` (falla el build si un Client Component los importa), salvo
  el agente del bot (`src/lib/bot/agent.ts`), que también corre en scripts y solo lo importan el
  webhook y los scripts; el SDK de Anthropic lee `ANTHROPIC_API_KEY` en el servidor.
- Los clientes de terceros se crean al primer uso: el build no necesita secretos.
- La sesión de WhatsApp de desarrollo (`*.memory-card.json`, `.wwebjs_auth/`) está en `.gitignore`.
- Rotación: si un secreto se filtra, rotarlo en el proveedor primero y después en Vercel; la llave
  de service role se rota desde el panel de Supabase (invalida la anterior).
- Escaneo de secretos en CI (gitleaks): a cargo del flujo de CI (`.github/`).

## Datos de salud en logs y errores

- `reportError` (`src/lib/observability.ts`) envía a Sentry solo contexto técnico (`where`,
  `clinic_id`, `attempt`, códigos); nunca teléfonos, nombres ni texto de mensajes.
- `scrubEvent` (`src/lib/sentry/options.ts`) borra body, headers, cookies y usuario, y enmascara
  teléfonos y correos en los mensajes de error.

## Integraciones

- Twilio: firma `X-Twilio-Signature` validada contra `PUBLIC_BASE_URL`; idempotencia por
  `MessageSid`. Envíos con reintentos solo cuando no hay riesgo de duplicar (ver `src/lib/retry.ts`).
- Stripe: firma del webhook e idempotencia por `event.id` (`stripe_events`).
- Resend: `Idempotency-Key` estable entre reintentos.
- Anthropic: el bot no ejecuta acciones fuera de sus herramientas; las reglas (24 h, horario,
  escalamiento) se validan en código, no en el prompt.

## Cabeceras HTTP

`next.config.ts`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictiva. HSTS lo pone
Vercel. Pendiente: Content-Security-Policy (hay que probarla con FullCalendar y Sentry).

## Lista de revisión para cambios

1. ¿Tabla nueva? `enable row level security`, `revoke` a `anon`/`authenticated` lo que no deban
   tener, políticas con `clinic_id = (select current_clinic_id())` y un pgTAP con dos consultorios.
2. ¿Función `security definer`? `set search_path = ''` y `revoke execute` explícito.
3. ¿Uso nuevo de la service role? Autorizar antes en código y anotarlo arriba.
4. ¿Datos clínicos nuevos? Agregar el trigger `audit_row_change` a la tabla.
5. ¿Secreto nuevo? `.env.example` sin valor, solo en servidor, módulo con `server-only`.
6. ¿Función nueva visible? Desplegarla detrás de un feature flag apagado.
