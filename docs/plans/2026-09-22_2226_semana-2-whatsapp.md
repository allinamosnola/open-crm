# MVP CRM dental — Plan Semana 2 (conexión a WhatsApp vía Twilio)

## Contexto
La Semana 1 dejó listos el CRM base, la autenticación, el panel y el bot movido a `src/lib/bot/`.
En la Semana 2 el bot recibe y envía mensajes reales por Twilio (sandbox), cada conversación queda
ligada a un paciente y la recepción ve y responde desde el panel. Wechaty sigue solo como canal de
desarrollo.

### Decisiones del usuario
| Tema | Decisión |
|---|---|
| Número | **Sandbox de Twilio** primero; el número propio se registra en paralelo (trámite con Meta, a cargo del usuario) |
| Número desconocido | Se crea un paciente **"por identificar"** (solo teléfono) y la recepción completa sus datos |
| Esquema | **Una conversación por paciente**, con el estado del bot en la misma fila |
| Bandeja | **Bandeja + responder** desde el panel; al responder la recepción, **se pausa el bot** para ese paciente |
| Respuesta del webhook | **El bot actual tal cual** (`handleMessage()`: Claude + horarios simulados) |
| Planes (recepción) | Solo lectura (confirmado; ya implementado) |

> **Depende de `2026-09-22_2233_semana-1b-multi-consultorio.md`.** Todas las tablas nuevas llevan `clinic_id` y FKs compuestas;
> el webhook resuelve el consultorio por `To` = `clinics.whatsapp_from`, y un número desconocido se descarta con un log.
> El teléfono del paciente es único por consultorio.

## Esquema (`supabase/migrations/<ts>_whatsapp.sql`)
- `patients`: `+ status patient_status['active','unidentified'] default 'active'`; `full_name` pasa a ser
  nullable, con el check `status = 'unidentified' OR full_name IS NOT NULL`. Al guardar el nombre
  desde el panel, el paciente pasa a `active`.
- `conversations(id, patient_id UNIQUE → patients, phone text, bot_state jsonb default '{}', bot_paused bool default false, last_message_at, unread_count int default 0, created_at)`
- `messages(id, conversation_id → conversations, direction msg_direction['in','out'], sender msg_sender['patient','bot','staff'], body text, twilio_sid text UNIQUE null, status text /* queued|sent|delivered|read|failed|received */, error_code text null, staff_id → staff null, created_at)`
- Índices en `messages(conversation_id, created_at)` y `conversations(last_message_at desc)`.
- RLS: el personal activo lee `conversations` y `messages`, inserta mensajes con `sender='staff'` y
  `staff_id = auth.uid()`, y actualiza `bot_paused`/`unread_count`. El webhook escribe con la
  **service role** desde el servidor (`src/lib/supabase/admin.ts`, `server-only`).
- Se activa Supabase Realtime en `messages` y `conversations` para que la bandeja se actualice sola.

## Backend
- `src/app/api/whatsapp/route.ts` (POST, webhook de Twilio):
  1. Valida la firma `X-Twilio-Signature` (SDK `twilio`, con `PUBLIC_BASE_URL` + ruta); si no es válida, responde 403.
  2. Es idempotente por `MessageSid`: los reintentos de Twilio no duplican mensajes.
  3. `From` → E.164 → busca el paciente por `phone`; si no existe, crea uno `unidentified` y su conversación.
  4. Guarda el mensaje entrante, incrementa `unread_count` y actualiza `last_message_at`.
  5. Responde 200 con TwiML vacío **de inmediato**. Con `after()` de Next, si `bot_paused = false`,
     ejecuta `handleMessage()` y envía la respuesta por la API REST de Twilio con `statusCallback`,
     y guarda el mensaje saliente (`sender='bot'`). Así se evita el timeout de 15 s de Twilio mientras Claude responde.
- `src/app/api/whatsapp/status/route.ts`: callback de estado (sent/delivered/read/failed + error_code), también con firma validada.
- `src/lib/whatsapp/{twilio.ts,phone.ts,inbound.ts,outbound.ts}`: cliente, normalización de números,
  lógica del webhook (testeable sin HTTP) y envío + registro del mensaje saliente.
- **Estado del bot fuera de la memoria:** `src/lib/bot/session.ts` pasa a ser una interfaz
  `SessionStore` (get/set/clear async) con dos implementaciones: `memory` (Wechaty dev) y `supabase`
  (`conversations.bot_state`). `handleMessage(userId, text, store)` conserva la misma lógica;
  `scripts/wechaty-dev.ts` usa la de memoria.
- `src/lib/db/conversations.ts`: `listConversations()`, `getConversation(patientId)`, `listMessages(conversationId)`,
  `markRead(id)`, `sendStaffMessage(conversationId, body)` (envía por Twilio, guarda con `sender='staff'` y
  pone `bot_paused = true`) y `setBotPaused(id, paused)`.
- El envío fuera de la ventana de 24 h de WhatsApp falla (Twilio 63016): se guarda como `failed` y
  el panel muestra "Fuera de la ventana de 24 h: el paciente debe escribir primero". Las plantillas
  llegan con los recordatorios (Semana 5).
- Dependencias: `twilio` y `vitest` (dev). Variables nuevas: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_WHATSAPP_FROM` (`whatsapp:+14155238886` en el sandbox), `SUPABASE_SERVICE_ROLE_KEY` y `PUBLIC_BASE_URL`.
- Middleware: ya excluye `/api/whatsapp` (también cubre `/status`); se revisa que así sea.

## Frontend
- `/conversaciones`: a la izquierda la lista (paciente o teléfono, último mensaje, no leídos,
  "Por identificar", "Bot pausado"); a la derecha el hilo con burbujas por remitente (paciente, bot,
  recepción), estado de entrega y caja de respuesta. Hay un botón "Pausar/Reanudar bot" y se actualiza con Realtime.
- En la ficha del paciente, nueva pestaña **Conversación** con el mismo hilo.
- La barra lateral muestra el total de no leídos en "Conversaciones".
- En la lista y la ficha de pacientes, el badge "Por identificar" y un aviso para completar el nombre.
  El formulario de datos permite guardar el nombre, y al hacerlo el paciente pasa a `active`.

## Punto a confirmar
- Como el bot va **tal cual**, en la Semana 2 **no le pide el nombre** al paciente nuevo: lo completa la
  recepción. Pedir el nombre es un cambio al diseño del bot (decisión 4), así que se propone para la Semana 3-4.

## Delegación
1. **Backend:** migración + RLS + Realtime, cliente admin, `SessionStore`, webhook y status, capa `whatsapp` y `db/conversations`, tipos y tests con vitest.
2. **Frontend** (después del backend): bandeja, pestaña Conversación, badges y conteo de no leídos.
Sigue en pie la prohibición de ejecutar el bot de Wechaty.

## Verificación
1. PGlite: la migración se aplica sobre la de la Semana 1; la RLS de `messages` y `conversations` funciona por rol; el check de `unidentified` funciona.
2. vitest: un webhook con firma válida crea el paciente `unidentified` y la conversación y guarda el mensaje;
   uno con firma inválida da 403; un `MessageSid` repetido no duplica; con el bot pausado no se envía nada;
   el status callback actualiza el estado. El cliente de Twilio y Claude van mockeados.
3. `tsc`, `lint` y `build` sin errores.
4. **Prueba real (el usuario):**
   - Configurar el sandbox de Twilio y exponer la app local con `ngrok http 3000`.
   - En el sandbox, apuntar "When a message comes in" a `https://<ngrok>/api/whatsapp`.
   - Desde un teléfono de prueba, unirse al sandbox y escribir "quiero una cita".
   - Resultado esperado: responde el bot, el paciente "por identificar" aparece en el panel, y la recepción
     responde desde la bandeja y el bot queda pausado.

## Cierre de la Semana 2 → decisiones para la Semana 3-4
- Modelo de Claude (tamaño/costo) y diseño del prompt y las intenciones, incluido pedir el nombre al paciente nuevo.
- Reglas de escalamiento a la recepción y cómo se notifica.
- Política de cancelación y reagendado.
- Reglas de disponibilidad real: horario del consultorio, duración de cita por defecto y dentista asignado.
