-- Esquema base del CRM dental (Semana 1, reescrito en la Semana 1b para SaaS).
-- Multi-consultorio con esquema compartido: cada tabla de negocio lleva clinic_id
-- y la RLS (20260922000002_rls.sql) aísla los datos por consultorio. Cada usuario
-- de auth.users pertenece a un solo consultorio (staff.clinic_id).

-- btree_gist permite combinar igualdad (dentist_id) y traslape de rangos en una
-- restricción de exclusión.
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.subscription_status as enum ('trial', 'active', 'past_due', 'canceled');
create type public.staff_role as enum ('owner', 'dentist', 'receptionist');
create type public.plan_status as enum ('draft', 'active', 'completed', 'cancelled');
create type public.item_status as enum ('pending', 'in_progress', 'done', 'cancelled');
create type public.appt_status as enum ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show');
create type public.appt_source as enum ('panel', 'whatsapp');
create type public.payment_method as enum ('cash', 'card', 'transfer');

-- ---------------------------------------------------------------------------
-- Trigger genérico de updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Consultorios (tenants). Los da de alta el dueño del SaaS con
-- scripts/create-clinic.ts (service role); no hay alta desde la app.
-- ---------------------------------------------------------------------------
create table public.clinics (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  slug                text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  timezone            text not null default 'America/Mexico_City',
  -- Número de WhatsApp (Twilio) del consultorio en E.164, sin el prefijo
  -- "whatsapp:". El webhook identifica el consultorio por el "To" del mensaje.
  whatsapp_from       text unique check (whatsapp_from ~ '^\+[1-9][0-9]{7,14}$'),
  subscription_status public.subscription_status not null default 'trial',
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Personal (1 a 1 con auth.users; un consultorio por usuario)
-- ---------------------------------------------------------------------------
create table public.staff (
  id         uuid primary key references auth.users (id) on delete cascade,
  -- El default se agrega abajo, cuando existe current_clinic_id() (que lee esta tabla).
  clinic_id  uuid not null references public.clinics (id),
  full_name  text not null,
  email      text not null,
  role       public.staff_role not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  -- Destino de las llaves foráneas compuestas (staff_id, clinic_id).
  constraint staff_id_clinic_key unique (id, clinic_id)
);

create index staff_clinic_id_idx on public.staff (clinic_id);

-- ---------------------------------------------------------------------------
-- Funciones de apoyo para defaults y RLS.
-- security definer: leen staff/clinics sin depender de sus propias políticas
-- (evita recursión). search_path vacío para que no se puedan secuestrar con
-- objetos de otro schema. Devuelven null / false si el usuario no es personal activo.
-- ---------------------------------------------------------------------------

-- Consultorio del usuario actual. También es el default de clinic_id en todas
-- las tablas de negocio: la app no lo manda y no puede escribir en otro consultorio.
create or replace function public.current_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.clinic_id
  from public.staff s
  where s.id = auth.uid()
    and s.active
$$;

-- Rol del usuario actual.
create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select s.role
  from public.staff s
  where s.id = auth.uid()
    and s.active
$$;

-- true si la suscripción del consultorio del usuario permite escribir
-- (trial o active). Con past_due o canceled el consultorio queda en solo lectura.
create or replace function public.clinic_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    join public.clinics c on c.id = s.clinic_id
    where s.id = auth.uid()
      and s.active
      and c.subscription_status in ('trial', 'active')
  )
$$;

revoke execute on function public.current_clinic_id() from public, anon;
revoke execute on function public.current_staff_role() from public, anon;
revoke execute on function public.clinic_is_active() from public, anon;
grant execute on function public.current_clinic_id() to authenticated, service_role;
grant execute on function public.current_staff_role() to authenticated, service_role;
grant execute on function public.clinic_is_active() to authenticated, service_role;

alter table public.staff alter column clinic_id set default public.current_clinic_id();

-- ---------------------------------------------------------------------------
-- Pacientes
-- ---------------------------------------------------------------------------
create table public.patients (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null default public.current_clinic_id() references public.clinics (id),
  full_name   text not null,
  -- E.164 (p. ej. +5215512345678); liga al paciente con el "From" de Twilio.
  phone       text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email       text,
  birthdate   date,
  allergies   text,
  notes_admin text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint patients_id_clinic_key unique (id, clinic_id),
  -- El teléfono es único por consultorio (el mismo paciente puede estar en dos).
  -- La restricción crea el índice (clinic_id, phone) que usa el webhook.
  constraint patients_clinic_phone_key unique (clinic_id, phone)
);

create trigger patients_set_updated_at
  before update on public.patients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Catálogo de tratamientos (uno por consultorio)
-- ---------------------------------------------------------------------------
create table public.treatments (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null default public.current_clinic_id() references public.clinics (id),
  name                 text not null,
  default_price        numeric(10,2) not null default 0 check (default_price >= 0),
  default_duration_min integer not null default 30 check (default_duration_min > 0),
  active               boolean not null default true,
  constraint treatments_id_clinic_key unique (id, clinic_id),
  constraint treatments_clinic_name_key unique (clinic_id, name)
);

-- ---------------------------------------------------------------------------
-- Planes de tratamiento (plan -> items). El total NO se guarda: es la suma de
-- sus items (ver vista patient_balances), para evitar inconsistencias.
--
-- Integridad entre consultorios: las referencias usan llaves foráneas
-- compuestas (x_id, clinic_id) -> tabla(id, clinic_id). Así no se puede ligar
-- una fila a un registro de otro consultorio aunque se conozca su id (RLS por
-- sí sola no lo impide en el insert). Los nombres de las FKs conservan el
-- formato <tabla>_<columna>_fkey, que usan los embeds de PostgREST.
-- ---------------------------------------------------------------------------
create table public.treatment_plans (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null default public.current_clinic_id() references public.clinics (id),
  patient_id uuid not null,
  dentist_id uuid not null,
  title      text not null,
  status     public.plan_status not null default 'draft',
  created_at timestamptz not null default now(),
  constraint treatment_plans_id_clinic_key unique (id, clinic_id),
  constraint treatment_plans_patient_id_fkey foreign key (patient_id, clinic_id)
    references public.patients (id, clinic_id),
  constraint treatment_plans_dentist_id_fkey foreign key (dentist_id, clinic_id)
    references public.staff (id, clinic_id)
);

create index treatment_plans_clinic_patient_idx on public.treatment_plans (clinic_id, patient_id);

create table public.treatment_plan_items (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null default public.current_clinic_id() references public.clinics (id),
  plan_id      uuid not null,
  treatment_id uuid not null,
  tooth        text,
  price        numeric(10,2) not null check (price >= 0),
  status       public.item_status not null default 'pending',
  sort_order   integer not null default 0,
  constraint treatment_plan_items_id_clinic_key unique (id, clinic_id),
  constraint treatment_plan_items_plan_id_fkey foreign key (plan_id, clinic_id)
    references public.treatment_plans (id, clinic_id) on delete cascade,
  constraint treatment_plan_items_treatment_id_fkey foreign key (treatment_id, clinic_id)
    references public.treatments (id, clinic_id)
);

create index treatment_plan_items_clinic_plan_idx on public.treatment_plan_items (clinic_id, plan_id);

-- ---------------------------------------------------------------------------
-- Citas
-- ---------------------------------------------------------------------------
create table public.appointments (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null default public.current_clinic_id() references public.clinics (id),
  patient_id   uuid not null,
  dentist_id   uuid not null,
  plan_item_id uuid,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       public.appt_status not null default 'scheduled',
  source       public.appt_source not null default 'panel',
  reason       text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint appointments_id_clinic_key unique (id, clinic_id),
  constraint appointments_valid_range check (ends_at > starts_at),
  constraint appointments_patient_id_fkey foreign key (patient_id, clinic_id)
    references public.patients (id, clinic_id),
  constraint appointments_dentist_id_fkey foreign key (dentist_id, clinic_id)
    references public.staff (id, clinic_id),
  -- "set null (plan_item_id)": al borrar el item solo se limpia plan_item_id
  -- (clinic_id es not null y se conserva).
  constraint appointments_plan_item_id_fkey foreign key (plan_item_id, clinic_id)
    references public.treatment_plan_items (id, clinic_id) on delete set null (plan_item_id),
  constraint appointments_created_by_fkey foreign key (created_by, clinic_id)
    references public.staff (id, clinic_id),
  -- La base de datos impide que un dentista tenga dos citas no canceladas que
  -- se traslapen. Rango semiabierto [inicio, fin): una cita puede empezar
  -- justo cuando termina la anterior. Violación => SQLSTATE 23P01.
  -- No necesita clinic_id: cada dentista pertenece a un solo consultorio.
  constraint appointments_no_overlap exclude using gist (
    dentist_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled')
);

create index appointments_clinic_starts_at_idx on public.appointments (clinic_id, starts_at);
create index appointments_clinic_dentist_starts_at_idx on public.appointments (clinic_id, dentist_id, starts_at);
create index appointments_clinic_patient_idx on public.appointments (clinic_id, patient_id);

-- ---------------------------------------------------------------------------
-- Pagos
-- ---------------------------------------------------------------------------
create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null default public.current_clinic_id() references public.clinics (id),
  patient_id  uuid not null,
  plan_id     uuid,
  amount      numeric(10,2) not null check (amount > 0),
  method      public.payment_method not null,
  paid_at     timestamptz not null default now(),
  received_by uuid default auth.uid(),
  notes       text,
  constraint payments_patient_id_fkey foreign key (patient_id, clinic_id)
    references public.patients (id, clinic_id),
  constraint payments_plan_id_fkey foreign key (plan_id, clinic_id)
    references public.treatment_plans (id, clinic_id),
  constraint payments_received_by_fkey foreign key (received_by, clinic_id)
    references public.staff (id, clinic_id)
);

create index payments_clinic_patient_idx on public.payments (clinic_id, patient_id);
create index payments_clinic_plan_idx on public.payments (clinic_id, plan_id);

-- ---------------------------------------------------------------------------
-- Notas clínicas: tabla aparte para que RLS la oculte a recepción.
-- ---------------------------------------------------------------------------
create table public.clinical_notes (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null default public.current_clinic_id() references public.clinics (id),
  patient_id     uuid not null,
  appointment_id uuid,
  author_id      uuid not null default auth.uid(),
  body           text not null,
  created_at     timestamptz not null default now(),
  constraint clinical_notes_patient_id_fkey foreign key (patient_id, clinic_id)
    references public.patients (id, clinic_id),
  constraint clinical_notes_appointment_id_fkey foreign key (appointment_id, clinic_id)
    references public.appointments (id, clinic_id) on delete set null (appointment_id),
  constraint clinical_notes_author_id_fkey foreign key (author_id, clinic_id)
    references public.staff (id, clinic_id)
);

create index clinical_notes_clinic_patient_idx on public.clinical_notes (clinic_id, patient_id);

-- ---------------------------------------------------------------------------
-- Saldos por paciente y plan.
--   total   = suma de los items no cancelados del plan
--   paid    = suma de los pagos ligados al plan
--   balance = total - paid
-- Los pagos sin plan aparecen en una fila con plan_id null (total 0, balance
-- negativo = saldo a favor). security_invoker => se aplican las políticas RLS
-- de quien consulta sobre las tablas base (y con ellas el aislamiento por consultorio).
-- ---------------------------------------------------------------------------
create view public.patient_balances
with (security_invoker = true) as
select
  t.clinic_id,
  t.patient_id,
  t.plan_id,
  t.total,
  t.paid,
  (t.total - t.paid)::numeric(10,2) as balance
from (
  select
    tp.clinic_id,
    tp.patient_id,
    tp.id as plan_id,
    coalesce((
      select sum(i.price)
      from public.treatment_plan_items i
      where i.plan_id = tp.id and i.status <> 'cancelled'
    ), 0)::numeric(10,2) as total,
    coalesce((
      select sum(p.amount)
      from public.payments p
      where p.plan_id = tp.id
    ), 0)::numeric(10,2) as paid
  from public.treatment_plans tp

  union all

  select
    p.clinic_id,
    p.patient_id,
    null::uuid as plan_id,
    0::numeric(10,2) as total,
    sum(p.amount)::numeric(10,2) as paid
  from public.payments p
  where p.plan_id is null
  group by p.clinic_id, p.patient_id
) t;
