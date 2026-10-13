-- Datos de ejemplo para desarrollo local (se aplica con `npx supabase db reset`).
-- Tres cuentas (plan) con un consultorio cada una, para probar el aislamiento
-- entre tenants y los topes por plan.
-- Usuarios (contraseña: demo1234):
--   Cuenta A, plan Pro: consultorio "Sonrisas" (número del sandbox de Twilio: +14155238886)
--     dentista@demo.local         -> owner (dentista y dueño)
--     recepcion@demo.local        -> recepcionista
--   Cuenta B, plan Pro: consultorio "Dental Norte" (sin número de WhatsApp)
--     dueno.norte@demo.local      -> owner
--     recepcion.norte@demo.local  -> recepcionista
--   Cuenta C, plan Básico sin bot: consultorio "Consultorio Básico" (sin número,
--   sin datos de negocio; sirve para probar los topes de Básico)
--     dueno.basico@demo.local     -> owner
-- Las citas se calculan relativas a la semana actual (hora de Ciudad de México).
-- La seed corre sin sesión (auth.uid() es null), así que clinic_id va explícito.

-- ---------------------------------------------------------------------------
-- Cuentas (plan y complemento de bot)
-- ---------------------------------------------------------------------------
insert into public.accounts (id, name, plan, bot_addon) values
  ('ac000000-0000-0000-0000-00000000000a', 'Consultorio Sonrisas', 'pro', false),
  ('ac000000-0000-0000-0000-00000000000b', 'Dental Norte', 'pro', false),
  ('ac000000-0000-0000-0000-00000000000c', 'Consultorio Básico', 'basic', false);

-- ---------------------------------------------------------------------------
-- Consultorios
-- ---------------------------------------------------------------------------
-- Horario de atención (lo usa el bot para proponer citas) y correo de la
-- recepción para los avisos de escalamiento.
insert into public.clinics (
  id, account_id, name, slug, whatsapp_from, subscription_status,
  business_hours, default_appointment_minutes, reception_email
) values
  ('f0000000-0000-0000-0000-00000000000a', 'ac000000-0000-0000-0000-00000000000a',
   'Consultorio Sonrisas', 'sonrisas', '+14155238886', 'active',
   '{"mon": [["09:00", "14:00"], ["16:00", "20:00"]], "tue": [["09:00", "14:00"], ["16:00", "20:00"]],
     "wed": [["09:00", "14:00"], ["16:00", "20:00"]], "thu": [["09:00", "14:00"], ["16:00", "20:00"]],
     "fri": [["09:00", "14:00"], ["16:00", "20:00"]], "sat": [["09:00", "13:00"]]}',
   30, 'recepcion@demo.local'),
  ('f0000000-0000-0000-0000-00000000000b', 'ac000000-0000-0000-0000-00000000000b',
   'Dental Norte', 'dental-norte', null, 'trial',
   '{"mon": [["10:00", "18:00"]], "tue": [["10:00", "18:00"]], "wed": [["10:00", "18:00"]],
     "thu": [["10:00", "18:00"]], "fri": [["10:00", "18:00"]]}',
   45, null),
  ('f0000000-0000-0000-0000-00000000000c', 'ac000000-0000-0000-0000-00000000000c',
   'Consultorio Básico', 'basico', null, 'trial',
   '{"mon": [["09:00", "17:00"]], "tue": [["09:00", "17:00"]], "wed": [["09:00", "17:00"]],
     "thu": [["09:00", "17:00"]], "fri": [["09:00", "17:00"]]}',
   30, null);

-- ---------------------------------------------------------------------------
-- Usuarios de Supabase Auth (auth.users + auth.identities)
-- Los campos *_token / email_change van como '' porque GoTrue no acepta NULL ahí.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email,
  extensions.crypt('demo1234', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.full_name),
  now(), now(), '', '', '', '', '', '', '', ''
from (values
  ('11111111-1111-1111-1111-111111111111', 'dentista@demo.local', 'Dra. Ana López'),
  ('22222222-2222-2222-2222-222222222222', 'recepcion@demo.local', 'Laura Martínez'),
  ('33333333-3333-3333-3333-333333333333', 'dueno.norte@demo.local', 'Dr. Jorge Treviño'),
  ('44444444-4444-4444-4444-444444444444', 'recepcion.norte@demo.local', 'Paola Garza'),
  ('55555555-5555-5555-5555-555555555555', 'dueno.basico@demo.local', 'Dra. Elena Ruiz')
) as u(id, email, full_name);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u;

-- ---------------------------------------------------------------------------
-- Personal
-- ---------------------------------------------------------------------------
insert into public.staff (id, clinic_id, full_name, email, role) values
  ('11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000a',
   'Dra. Ana López', 'dentista@demo.local', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-00000000000a',
   'Laura Martínez', 'recepcion@demo.local', 'receptionist'),
  ('33333333-3333-3333-3333-333333333333', 'f0000000-0000-0000-0000-00000000000b',
   'Dr. Jorge Treviño', 'dueno.norte@demo.local', 'owner'),
  ('44444444-4444-4444-4444-444444444444', 'f0000000-0000-0000-0000-00000000000b',
   'Paola Garza', 'recepcion.norte@demo.local', 'receptionist'),
  ('55555555-5555-5555-5555-555555555555', 'f0000000-0000-0000-0000-00000000000c',
   'Dra. Elena Ruiz', 'dueno.basico@demo.local', 'owner');

-- ===========================================================================
-- Consultorio A
-- ===========================================================================

-- Catálogo de tratamientos
insert into public.treatments (id, clinic_id, name, default_price, default_duration_min)
select v.id::uuid, 'f0000000-0000-0000-0000-00000000000a', v.name, v.price, v.duration
from (values
  ('a0000000-0000-0000-0000-000000000001', 'Consulta de valoración', 500.00, 30),
  ('a0000000-0000-0000-0000-000000000002', 'Limpieza dental', 800.00, 45),
  ('a0000000-0000-0000-0000-000000000003', 'Resina (obturación)', 1200.00, 60),
  ('a0000000-0000-0000-0000-000000000004', 'Extracción simple', 1000.00, 45),
  ('a0000000-0000-0000-0000-000000000005', 'Endodoncia', 4500.00, 90),
  ('a0000000-0000-0000-0000-000000000006', 'Corona de porcelana', 6500.00, 60),
  ('a0000000-0000-0000-0000-000000000007', 'Blanqueamiento', 3500.00, 60),
  ('a0000000-0000-0000-0000-000000000008', 'Radiografía periapical', 250.00, 15)
) as v(id, name, price, duration);

-- Pacientes (teléfonos E.164 normalizados a +52 + 10 dígitos, ver normalize_phone).
-- El 006 escribió por WhatsApp y está "por identificar": solo tiene teléfono.
insert into public.patients (id, clinic_id, full_name, phone, email, birthdate, allergies, notes_admin, status)
select v.id::uuid, 'f0000000-0000-0000-0000-00000000000a', v.full_name, v.phone, v.email,
       v.birthdate::date, v.allergies, v.notes_admin, v.status::public.patient_status
from (values
  ('b0000000-0000-0000-0000-000000000001', 'Carlos Hernández', '+525511112222', 'carlos@example.com', '1985-03-14', 'Penicilina', null, 'active'),
  ('b0000000-0000-0000-0000-000000000002', 'María González', '+525522223333', 'maria@example.com', '1992-07-02', null, 'Prefiere citas por la tarde', 'active'),
  ('b0000000-0000-0000-0000-000000000003', 'José Ramírez', '+525533334444', null, '1978-11-20', null, null, 'active'),
  ('b0000000-0000-0000-0000-000000000004', 'Sofía Torres', '+525544445555', 'sofia@example.com', '2001-01-30', 'Látex', null, 'active'),
  ('b0000000-0000-0000-0000-000000000005', 'Luis Flores', '+525555556666', null, '1969-05-09', null, 'Factura a nombre de su empresa', 'active'),
  ('b0000000-0000-0000-0000-000000000006', null, '+525566667777', null, null, null, null, 'unidentified')
) as v(id, full_name, phone, email, birthdate, allergies, notes_admin, status);

-- Plan de tratamiento con items
insert into public.treatment_plans (id, clinic_id, patient_id, dentist_id, title, status) values
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Rehabilitación molar inferior', 'active');

insert into public.treatment_plan_items (id, clinic_id, plan_id, treatment_id, tooth, price, status, sort_order)
select v.id::uuid, 'f0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
       v.treatment_id::uuid, '36', v.price, v.status::public.item_status, v.sort_order
from (values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000008', 250.00, 'done', 1),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005', 4500.00, 'in_progress', 2),
  ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000006', 6500.00, 'pending', 3)
) as v(id, treatment_id, price, status, sort_order);

-- Citas de esta semana (lunes = date_trunc('week'), hora local de CDMX)
with semana as (
  select date_trunc('week', now() at time zone 'America/Mexico_City') as lunes
)
insert into public.appointments (
  id, clinic_id, patient_id, dentist_id, plan_item_id, starts_at, ends_at, status, source, reason, created_by
)
select v.id::uuid, 'f0000000-0000-0000-0000-00000000000a', v.patient_id::uuid,
       '11111111-1111-1111-1111-111111111111', v.plan_item_id::uuid,
       (s.lunes + v.inicio) at time zone 'America/Mexico_City',
       (s.lunes + v.inicio + v.duracion) at time zone 'America/Mexico_City',
       v.status::public.appt_status, v.source::public.appt_source, v.reason,
       '22222222-2222-2222-2222-222222222222'
from semana s
cross join (values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
   interval '1 day 10 hours', interval '90 minutes', 'confirmed', 'panel', 'Endodoncia molar 36'),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', null,
   interval '1 day 12 hours', interval '45 minutes', 'scheduled', 'panel', 'Limpieza dental'),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', null,
   interval '2 days 16 hours', interval '30 minutes', 'scheduled', 'whatsapp', 'Valoración: dolor de muela'),
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', null,
   interval '3 days 11 hours', interval '60 minutes', 'scheduled', 'panel', 'Blanqueamiento'),
  ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', null,
   interval '4 days 10 hours', interval '30 minutes', 'cancelled', 'panel', 'Valoración (canceló el paciente)')
) as v(id, patient_id, plan_item_id, inicio, duracion, status, source, reason);

-- Pago (anticipo del plan) y nota clínica
insert into public.payments (clinic_id, patient_id, plan_id, amount, method, received_by, notes) values
  ('f0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 2000.00, 'card',
   '22222222-2222-2222-2222-222222222222', 'Anticipo del plan');

insert into public.clinical_notes (clinic_id, patient_id, author_id, body) values
  ('f0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'Pieza 36 con caries profunda y dolor a la percusión. Se indica endodoncia y corona.');

-- Conversaciones de WhatsApp. El trigger de messages calcula last_message_at
-- y unread_count (suma los mensajes entrantes). conversations.phone es el
-- "From" original de Twilio (los celulares de México llegan como +521...),
-- mientras que patients.phone está normalizado a +52.
insert into public.conversations (id, clinic_id, patient_id, phone, bot_paused) values
  ('90000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-000000000006', '+5215566667777', false),
  ('90000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a',
   'b0000000-0000-0000-0000-000000000002', '+5215522223333', true);

insert into public.messages (clinic_id, conversation_id, direction, sender, body, twilio_sid, status, staff_id, created_at)
select 'f0000000-0000-0000-0000-00000000000a', v.conversation_id::uuid, v.direction::public.msg_direction,
       v.sender::public.msg_sender, v.body, v.sid, v.status, v.staff_id::uuid, now() - v.hace
from (values
  ('90000000-0000-0000-0000-000000000001', 'in', 'patient', 'Hola, quiero una cita', 'SMseed0000000000000000000000000001', 'received', null, interval '2 hours'),
  ('90000000-0000-0000-0000-000000000001', 'out', 'bot',
   E'Estos son los horarios disponibles:\n1. mañana a las 10:00\n2. pasado mañana a las 12:00\n3. el jueves a las 16:00\n\nResponde con el número del horario que prefieras para confirmar tu cita.',
   'SMseed0000000000000000000000000002', 'read', null, interval '119 minutes'),
  ('90000000-0000-0000-0000-000000000001', 'in', 'patient', '¿Aceptan tarjeta?', 'SMseed0000000000000000000000000003', 'received', null, interval '90 minutes'),
  ('90000000-0000-0000-0000-000000000002', 'in', 'patient', '¿Puedo cambiar mi limpieza al viernes?', 'SMseed0000000000000000000000000004', 'received', null, interval '1 day'),
  ('90000000-0000-0000-0000-000000000002', 'out', 'staff', 'Claro, María. Te pasamos al viernes a las 12:00.', 'SMseed0000000000000000000000000005', 'delivered',
   '22222222-2222-2222-2222-222222222222', interval '23 hours')
) as v(conversation_id, direction, sender, body, sid, status, staff_id, hace);

-- La conversación de María ya la atendió la recepción (leída y con el bot pausado).
update public.conversations set unread_count = 0
where id = '90000000-0000-0000-0000-000000000002';

-- El paciente por identificar preguntó algo que el bot no puede responder
-- (formas de pago): quedó escalado a la recepción ("Requiere atención").
update public.conversations
set needs_attention = true,
    bot_paused = true,
    attention_category = 'other',
    attention_reason = 'Pregunta si aceptan tarjeta (formas de pago)',
    escalated_at = now() - interval '89 minutes'
where id = '90000000-0000-0000-0000-000000000001';

-- ===========================================================================
-- Consultorio B (mínimo, para probar el aislamiento). Carlos tiene el mismo
-- teléfono que el paciente de A: el teléfono es único por consultorio.
-- ===========================================================================
insert into public.treatments (id, clinic_id, name, default_price, default_duration_min) values
  ('a0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b', 'Consulta de valoración', 450.00, 30),
  ('a0000000-0000-0000-0000-0000000000b2', 'f0000000-0000-0000-0000-00000000000b', 'Limpieza dental', 750.00, 45);

insert into public.patients (id, clinic_id, full_name, phone, email) values
  ('b0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b',
   'Carlos Hernández (Norte)', '+525511112222', null),
  ('b0000000-0000-0000-0000-0000000000b2', 'f0000000-0000-0000-0000-00000000000b',
   'Ana Villarreal', '+528111223344', 'ana.v@example.com');

insert into public.treatment_plans (id, clinic_id, patient_id, dentist_id, title, status) values
  ('c0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b',
   'b0000000-0000-0000-0000-0000000000b2', '33333333-3333-3333-3333-333333333333',
   'Limpieza semestral', 'active');

insert into public.treatment_plan_items (id, clinic_id, plan_id, treatment_id, price, sort_order) values
  ('d0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b',
   'c0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b2', 750.00, 1);

with semana as (
  select date_trunc('week', now() at time zone 'America/Mexico_City') as lunes
)
insert into public.appointments (id, clinic_id, patient_id, dentist_id, starts_at, ends_at, reason, created_by)
select 'e0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-00000000000b',
       'b0000000-0000-0000-0000-0000000000b2', '33333333-3333-3333-3333-333333333333',
       (s.lunes + interval '1 day 10 hours') at time zone 'America/Mexico_City',
       (s.lunes + interval '1 day 10 hours 45 minutes') at time zone 'America/Mexico_City',
       'Limpieza dental', '44444444-4444-4444-4444-444444444444'
from semana s;

insert into public.payments (clinic_id, patient_id, amount, method, received_by, notes) values
  ('f0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-0000000000b2',
   300.00, 'cash', '44444444-4444-4444-4444-444444444444', 'Anticipo');

insert into public.clinical_notes (clinic_id, patient_id, author_id, body) values
  ('f0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-0000000000b2',
   '33333333-3333-3333-3333-333333333333', 'Sarro moderado en sector anteroinferior.');
