# MVP CRM dental — Plan Semana 1b (multi-consultorio / SaaS)

## Contexto
La Semana 1 se construyó para **un solo consultorio**. El usuario aclaró que la app será un **SaaS**,
así que antes de la Semana 2 hay que convertir el esquema, la RLS y el panel a multi-consultorio.
Como la base todavía no tiene datos reales, el cambio se hace ahora; con clientes en producción
sería una migración riesgosa.

### Decisiones del usuario
| Tema | Decisión |
|---|---|
| Aislamiento | **Esquema compartido con `clinic_id` + RLS** |
| Membresía | **Un consultorio por usuario** (`clinic_id` en `staff`) |
| Alta de consultorios | **Manual** (lo hace el dueño del SaaS con un script); el owner invita a su personal |
| Roles | **owner** (todo lo del dentista + personal y suscripción), **dentist**, **receptionist** |

## Esquema
- **Nueva tabla** `clinics(id, name, slug unique, timezone default 'America/Mexico_City', whatsapp_from text unique null /* número de Twilio del consultorio */, subscription_status['trial','active','past_due','canceled'] default 'trial', created_at)`.
- **`staff`**:
  - agrega `clinic_id not null → clinics`;
  - `staff_role` suma `owner`;
  - agrega `email`, para mostrar e invitar.
- **Columna `clinic_id not null` en todas las tablas de negocio:** `patients`, `treatments`, `treatment_plans`,
  `treatment_plan_items`, `appointments`, `payments`, `clinical_notes` (y en la Semana 2, `conversations` y `messages`).
  - Tiene default `public.current_clinic_id()`, así la app no la manda y un usuario no puede escribir en otro consultorio.
- **Integridad entre consultorios:** llaves foráneas compuestas, por ejemplo `appointments(patient_id, clinic_id) → patients(id, clinic_id)`,
  y lo mismo para dentista, plan, item, tratamiento, pago y nota. Así se impide ligar una cita a un paciente de otro
  consultorio aunque se conozca su id: RLS por sí sola no lo evita en el `insert`.
- **Unicidad por consultorio:** `patients` pasa a `unique (clinic_id, phone)`; `treatments` agrega `unique (clinic_id, name)`.
- **Índices:** se agrega `clinic_id` como primera columna en los índices existentes. La restricción contra traslapes no cambia, porque el dentista ya pertenece a un solo consultorio.

## RLS
- **Funciones de apoyo** (`security definer`, `search_path` fijo, `stable`):
  - `current_clinic_id()`
  - `current_staff_role()`
  - `clinic_is_active()`: `trial` o `active`
- **Todas las políticas** exigen `clinic_id = (select current_clinic_id())` más la regla de rol vigente:
  - todo el personal hace CRUD de pacientes, citas y pagos;
  - la recepción solo lee planes y catálogo;
  - las notas clínicas son solo para `dentist` y `owner`.
- **Suscripción:** las políticas de escritura exigen además `clinic_is_active()`. Con la suscripción vencida, el consultorio queda en solo lectura.
- **Personal:** `owner` administra `staff` de su consultorio; el resto solo lo lee.
- **`clinics`:** el personal lee su propia fila y `owner` actualiza `name` y `timezone`. El resto de columnas (número de WhatsApp y suscripción) solo las cambia la plataforma con la service role.
- **Administración del SaaS:** se hace **fuera de la app**, con scripts que usan la service role. No existe un rol "superadmin" dentro de la RLS.

## Alta y personal
- `scripts/create-clinic.ts` (lo ejecuta el dueño del SaaS, con la service role):
  - crea el consultorio;
  - invita al owner por correo con `auth.admin.inviteUserByEmail`;
  - crea su fila en `staff`.
- Página `/configuracion/personal`, solo para owner:
  - lista del personal;
  - "Invitar" (correo, nombre, rol dentist o receptionist) con una server action que usa el cliente admin **después de comprobar que quien llama es owner**;
  - desactivar a alguien pone `active = false`, y RLS le quita el acceso de inmediato.
- Página `/auth/aceptar-invitacion`: quien recibe la invitación define su contraseña.
- `supabase/config.toml` sigue con `enable_signup = false`.
- Si la suscripción no está activa, el panel muestra un aviso y deshabilita las acciones de escritura.

## Cambios en el panel
- La barra lateral muestra el nombre del consultorio. El enlace "Personal" solo aparece para owner.
- En la agenda, el filtro y la asignación de dentistas incluyen a los owners (el owner cuenta como dentista).
- No cambian las rutas: el consultorio sale de la sesión y no de la URL, porque cada usuario tiene uno solo.

## Estrategia de migración
Las migraciones de la Semana 1 no se han aplicado en ningún entorno. Se **reescriben en su lugar**
(schema + RLS) en vez de apilar una migración de conversión. El seed pasa a tener **2 consultorios**
(A: owner dentista + recepcionista; B: owner + recepcionista) para probar el aislamiento.

## Delegación
1. **Backend:** esquema, RLS, seed de 2 consultorios, tipos, `current_clinic_id` en la capa de datos, el cliente admin
   (`server-only`), el script `create-clinic` y las server actions de personal.
2. **Frontend:** nombre del consultorio, página de personal, aceptar invitación, estado de suscripción y owners en el filtro de dentistas.

## Verificación
1. PGlite: los usuarios de A no ven **ninguna** fila de B en ninguna tabla. Insertar una cita en A con un
   `patient_id` de B falla por FK compuesta. Poner el `clinic_id` de B en un insert falla por RLS. Con suscripción `canceled` se puede leer y no escribir.
2. Recepcionista: sigue sin ver notas y no puede administrar personal. Owner: invita y desactiva, y el usuario desactivado ya no lee nada.
3. `tsc`, `lint` y `build` sin errores.

## Después: la Semana 2 se ajusta
- `conversations` y `messages` llevan `clinic_id`.
- El webhook identifica el consultorio por el número `To` (`clinics.whatsapp_from`); si el número no está registrado, se descarta con un log.
- En desarrollo, el consultorio A usa el número del sandbox de Twilio.
