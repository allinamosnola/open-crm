# Verificación de planes y topes (Fase 4)

Fase 4 de 2026-10-01_1122_implementacion-planes-y-topes.md (plan de negocio, no incluido en la copia pública),
rama `feat/planes-y-topes` (Fases 1-3 y README ya en commits). Todo se probó contra Supabase local.
No se ejecutó `bot:dev`, Wechaty ni `eval:bot`, y no salió ningún mensaje real por Twilio ni ninguna llamada a Claude.
No se hicieron commits. Al terminar quedó aplicado `npx supabase db reset` (seed limpia).

## Resultado

Las reglas de seguridad y los topes se cumplen. Hallé y arreglé tres defectos (uno de seguridad, introducido en la Fase 1).
Quedan cuatro puntos que son decisiones de producto.

## Casos

| # | Caso | Resultado | Evidencia |
|---|---|---|---|
| 1 | `tsc`, `lint`, `vitest`, `db reset` | OK | tsc 0, eslint 0, 121/121 tests, reset sin errores (antes y después de los arreglos) |
| 2.1 | Usuario en dos consultorios de la misma cuenta solo ve el activo | OK | Owner de A también owner de una sede D. Sin elegir sede: `current_clinic_id` = A (la más antigua), 6 pacientes. Al elegir D: 1 paciente, 0 citas, 0 conversaciones; staff y clinics solo de D |
| 2.2 | `user_active_clinic` no deja elegir un consultorio ajeno | OK | update a B → `violates row-level security policy`; insert a nombre de otro usuario → mismo error; solo se ve la fila propia |
| 2.3 | Desactivar quita el acceso al instante | OK | Desactivado en D con la elección en D: en la misma sesión vuelve a A y `my_clinics` = 1; no puede volver a elegir D (RLS). Desactivado en todos los consultorios: 0 pacientes, staff y clinics; `my_clinics` y `my_entitlements` vacíos |
| 2.4 | Aislamiento entre A, B y C | OK | Con los 5 usuarios de la seed: 0 filas de otro consultorio en patients, appointments, conversations, messages, staff, clinical_notes, payments, treatment_plans y clinics. `my_clinics` y `my_entitlements` devuelven solo el consultorio propio |
| 2.5 | `accounts`, `account_entitlements` y `whatsapp_register_inbound` cerrados a la sesión | OK | authenticated: `permission denied` en los tres. anon: `permission denied` también en `my_clinics` y `my_entitlements` |
| 2.6 | Un owner mete a personal de otra cuenta | **Defecto, arreglado** | Antes del arreglo, el owner de A, con su sesión, pudo insertar en `staff` al owner de B (con `created_at` antiguo), y A pasó a ser el consultorio activo por defecto de B. Después del arreglo da 42501 (ver Defectos) |
| 2.7 | Funciones security definer | OK | Todas con `search_path=""`. Grants: `account_entitlements` y las funciones de trigger solo para service_role; `my_*`, `current_*` e `is_active_member` para authenticated, nunca para anon ni PUBLIC |
| 3.1 | Básico: 2.º doctor y 2.º consultorio | OK | `permite 1 doctor(es) y ya tiene 1` (hint `max_doctors`); `permite 1 consultorio(s)` (hint `max_clinics`) |
| 3.2 | Pro: 4.º doctor y 4.º consultorio | OK | 3 doctores y 3 consultorios entran; el 4.º de cada uno se rechaza. El mismo doctor en otra sede no suma |
| 3.3 | Plus sin tope | OK | 11 doctores y 10 consultorios en una cuenta Plus |
| 3.4 | Reactivar respeta el tope | OK | SQL (doctor y recepción). En el panel: «Activar» con 3/3 → toast «Tu plan Pro incluye 3 doctores. Sube a Plus para agregar más.» y la fila sigue `active=false` |
| 3.5 | 2.ª recepción por consultorio, en todos los planes | OK | Rechazada en Básico, Pro y Plus (hint `max_receptionists`); la 1.ª en otra sede sí entra |
| 3.6 | `whatsapp_from` sin bot / con `bot_addon` | OK | Sin bot: hint `bot_required`. Con `bot_addon`: se asigna. `create-clinic --plan basic --whatsapp-from` falla y deshace la cuenta y el usuario; con `--bot-addon` crea todo |
| 3.7 | Cambio de rol o de consultorio no salta el tope | OK | Recepción → dentista en Básico: rechazado. Recepción movida a una sede que ya tiene recepción: rechazada. Dentista movido a C (Básico): rechazado. Mover un consultorio a una cuenta Básico: rechazado |
| 3.8 | Dos altas concurrentes | OK | Dos sesiones psql: s2 esperó el `commit` de s1 (bloqueo `for update` de la cuenta) y luego falló con `max_doctors`. Lo mismo con consultorios (3/3) y recepción (1/1) |
| 3.9 | Bajar de plan conserva lo existente y `set-plan` avisa | OK | Pro con 3 doctores y 2 sedes → Básico: se conserva todo, el nombre se sigue pudiendo editar, las altas y reactivaciones se rechazan y `whatsapp_from` se conserva pero no se puede cambiar. `set-plan` avisa «excede el tope de consultorios (2 > 1)», «de doctores (3 > 1)» y del número conservado |
| 3.10 | Scripts con topes | OK | `clinic:create --account` suma la 2.ª y 3.ª sede de A y rechaza la 4.ª sin dejar restos; con Básico rechaza la 2.ª |
| 4.1 | `registerInbound` real sin bot | OK | C (Básico, con número heredado) → `ignored/bot_disabled`; pacientes, conversaciones y mensajes sin cambios (8/2/5) |
| 4.2 | Con bot | OK | A (Pro) → `stored`, `reply: 'bot'`; +1 paciente, +1 conversación, +1 mensaje |
| 4.3 | Duplicado y `unknown_clinic` | OK | Mismo SID → `duplicate` sin filas nuevas; número desconocido → `ignored/unknown_clinic` |
| 4.4 | Ruta HTTP `/api/whatsapp` con firma válida | OK | Firma hecha con `twilio.getExpectedTwilioSignature` y un token local falso. Firma inválida → 403. Sin bot → 200 con TwiML vacío y nada guardado. Con bot (conversación pausada para que no se responda) → 200 y el mensaje queda guardado. Duplicado y número desconocido → 200. 0 mensajes salientes |
| 5.1 | Básico | OK | Menú sin Conversaciones y sin sonido. `/conversaciones` muestra «Activa el bot de WhatsApp». En Plan, consultorios y doctores 1 de 1 con «Tope alcanzado». Al invitar, «Dentista (tope alcanzado)» aparece deshabilitado. En la pestaña Conversación del paciente: «Sube de plan para ver los mensajes del paciente aquí.» |
| 5.2 | Básico + Bot (`plan:set --bot-addon on`) | OK | Aparecen Conversaciones y «Sonido de avisos»; Plan muestra «Complemento Bot» y «Bot de WhatsApp activo»; la pestaña Conversación dice «Este paciente aún no ha escrito por WhatsApp.» |
| 5.3 | Pro + 2.ª sede + selector | OK | Plan 1 de 3; al invitar, «Recepción (tope alcanzado)». Tras `clinic:create` aparece el selector («Consultorio Sonrisas [activo] \| Sonrisas Sur»). Al cambiar sale el toast «Ahora trabajas en Sonrisas Sur», pacientes vacíos y Plan con 2 de 3. Al volver se recuperan los datos |
| 5.4 | Toast de error de `switchClinic` | OK | Con el menú abierto se desactivó la membresía de destino por SQL. El clic dio el toast «No tienes acceso a ese consultorio» y el consultorio no cambió; al recargar desaparece el selector |
| 5.5 | Solo lectura (`past_due`) | OK | Aparece el banner de solo lectura. «Invitar» queda deshabilitado con el título de solo lectura, así que el diálogo no se abre. El selector sigue funcionando: cambia a Sur (activa, sin banner) y vuelve |
| 5.6 | «Enviar invitación» con los dos roles en tope | OK | Pro con 3/3 doctores y 1/1 recepción: «Ya no puedes invitar a más personal», ambos roles bloqueados y el botón `disabled` con el título «Alcanzaste el tope de personal de tu plan» |
| 5.7 | Aviso de exceso (Pro → Básico con 3 doctores) | OK | Plan: «2 de 1 Excede el plan», «3 de 1 Excede el plan» y «Tienes más de lo que incluye tu plan…». Se ocultan Conversaciones y el sonido, y el diálogo de invitar bloquea todo |
| 5.8 | Recepción | OK | No ve Plan ni Personal; `/configuracion/plan` y `/configuracion/personal` dan 404 |
| 5.9 | `dueno.norte` | OK | Solo sus 2 pacientes; Plan Pro 1 de 3; un paciente de A por URL da 404 |
| 6 | Revisión de código | Ver abajo | Rutas de configuración con `role !== 'owner'` → `notFound()`; `updateClinicSettings`, `inviteStaff` y `setStaffActive` comprueban el owner en el servidor |

Capturas revisadas: `/tmp/f4/shots/*.png` (temporales, fuera del repo).

## Defectos hallados y arreglados

1. **Seguridad (regresión de la Fase 1): un owner podía sumar a su consultorio a personal de otra cuenta.**
   Al pasar `staff` a PK `(id, clinic_id)`, la sesión `authenticated` (que tiene INSERT/UPDATE en todas las columnas
   de `staff`) podía insertar una fila con el `id` de un usuario de otra cuenta, o cambiar el `id` de una fila existente.
   Con un `created_at` antiguo, el consultorio del atacante pasaba a ser el consultorio activo por defecto de la víctima.
   Para explotarlo había que conocer el UUID de la víctima. No exponía los datos de la víctima, pero sí la metía en un consultorio ajeno.
   - `supabase/migrations/20261001000004_staff_sin_personal_ajeno.sql`: `staff_guard_owner_rules` rechaza, solo para
     `authenticated`, el insert de un usuario que ya es personal de otra cuenta y el cambio de `staff.id`.
     Usa la función nueva `staff_in_other_account(user, clinic)` (security definer, `search_path` vacío, sin anon).
     La service role (scripts e `inviteStaff`) no cambia.
   - Prueba: `supabase/tests/staff_personal_ajeno.test.sql` (pgTAP, `npx supabase test db`: 4/4).
   - `src/types/database.ts`: se añadió a mano solo la entrada de la función. `npm run db:types` borraría los ajustes
     a mano del archivo (nulabilidad de `max_*` y `__InternalSupabase`).
   - `README.md`: una línea en Permisos y cómo correr `npx supabase test db` en Tests.
2. **Texto obsoleto en `scripts/set-plan.ts`:** con un número conservado sin bot decía «los mensajes se guardan y el bot no
   responde». Desde 32366ab se descartan. Ahora dice «sus mensajes entrantes se descartan (no se guardan ni se responden)».
3. **Literal «1 recepcionista» duplicado en la app:** `src/app/(panel)/configuracion/plan/page.tsx` tenía fijo
   «Todos los planes incluyen 1 por consultorio». Ahora usa `ent.max_receptionists_per_clinic` (sale de `my_entitlements`).

Después de los arreglos: tsc 0, lint 0, vitest 121/121, pgTAP 4/4, `db reset` limpio.

## Sin arreglar (decisiones de producto o de datos)

1. **Un consultorio que baja de plan y conserva su `whatsapp_from` todavía puede enviar mensajes del personal.**
   `sendStaffMessage` (`src/lib/db/conversations.ts`) no revisa `bot_enabled`. El panel oculta la bandeja, pero la server
   action sigue enviando por Twilio si alguien la llama. Hay que decidir si al bajar de plan se quita el número
   (`set-plan`) o si se bloquea el envío.
2. **Al bajar de plan se conserva `whatsapp_from`** y los mensajes entrantes se descartan sin aviso al paciente.
   `set-plan` ya avisa. Falta decidir si se borra el número o se manda una respuesta fija.
3. **Citas traslapadas entre sedes:** `appointments_no_overlap` no incluye `clinic_id`. Un doctor que trabaja en dos sedes
   no puede tener citas traslapadas (está documentado en la migración). El bot calcula los huecos por consultorio, así
   que podría ofrecer en una sede un horario ocupado en otra, y el insert fallaría. No lo reproduje.
4. **El límite de recepción (1) vive en dos sitios de SQL:** el trigger `staff_enforce_plan_limits` (con `exists` y el
   texto «máximo 1») y el `1` literal de `my_entitlements`. La app ya no lo repite. Unificarlo (p. ej. una columna en
   `account_entitlements`) cambia el contrato de la Fase 1.
5. Detalles menores: la página de Plan dice «Plan de la cuenta de Sonrisas Sur» (usa el nombre del consultorio activo,
   no el de la cuenta). `staff_in_other_account` responde sí o no para cualquier par de UUID que conozca un usuario
   con sesión, sin revelar más.

## Lo que no se pudo verificar

- **Respuesta real del bot por la ruta HTTP:** no se dejó correr `after()` → Claude → Twilio. Costaría dinero y podría
  mandar un WhatsApp real. El caso «con bot» por HTTP se probó con la conversación pausada. El camino «stored + reply»
  sí está cubierto por `registerInbound` real y por los tests de vitest.
- **Firma con el token real de Twilio:** se usó un token falso local en un servidor aparte, porque Next.js no pisa las
  variables ya definidas en el entorno. No se probó contra Twilio.
- **Servidor de desarrollo:** ya había un `next dev` en :3000 (PID 9943, desde este repo, iniciado a las 12:56) que no
  inicié yo, y Next 16 no permite un segundo `next dev` en el mismo directorio. Usé una copia clonada del árbol de trabajo
  en `/tmp/f4/app` en :3100 con credenciales falsas. La detuve y la borré; el de :3000 sigue corriendo.
- El correo de invitación de `prueba.wa@demo.local` (prueba de `create-clinic`) quedó en Mailpit local. El usuario se
  borró con el `db reset`.
