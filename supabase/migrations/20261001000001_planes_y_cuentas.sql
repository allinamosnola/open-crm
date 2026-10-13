-- Planes y topes (un plan de negocio no incluido en la copia pública, Fase 1).
--   * Cuentas: una cuenta agrupa uno o varios consultorios (sedes) y tiene el plan
--     (basic | pro | plus) y el complemento de bot. Cada consultorio sigue aislado
--     (su número, agenda y pacientes); la suscripción sigue en clinics.
--   * Un usuario puede ser personal de varios consultorios: staff pasa de PK (id)
--     a PK (id, clinic_id). El consultorio activo se guarda en user_active_clinic
--     y las tres funciones de la RLS resuelven la membresía activa. Las políticas
--     RLS existentes no cambian.
--   * Topes: account_entitlements(account_id) es el único origen de verdad; los
--     triggers la leen y aplican a todos (también a la service role).
--   * Bot: whatsapp_register_inbound devuelve además bot_enabled.
--
-- Nota: la restricción appointments_no_overlap (dentist_id sin clinic_id) ahora
-- también impide que una misma persona tenga citas traslapadas en dos sedes.

-- ---------------------------------------------------------------------------
-- Cuentas
-- ---------------------------------------------------------------------------
create type public.account_plan as enum ('basic', 'pro', 'plus');

-- Las da de alta el dueño del SaaS (scripts/create-clinic.ts y scripts/set-plan.ts,
-- con la service role). Sin acceso desde la app por ahora: RLS activa y sin políticas.
create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  plan       public.account_plan not null,
  -- Complemento "Bot de WhatsApp" (relevante en Básica; Pro y Plus ya lo incluyen).
  bot_addon  boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;
revoke all on public.accounts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- clinics.account_id + backfill: una cuenta Pro por consultorio existente,
-- con el nombre del consultorio.
-- ---------------------------------------------------------------------------
alter table public.clinics add column account_id uuid;

update public.clinics set account_id = gen_random_uuid() where account_id is null;

insert into public.accounts (id, name, plan, created_at)
select c.account_id, c.name, 'pro', c.created_at
from public.clinics c;

alter table public.clinics
  alter column account_id set not null,
  add constraint clinics_account_id_fkey foreign key (account_id) references public.accounts (id);

create index clinics_account_id_idx on public.clinics (account_id);

-- ---------------------------------------------------------------------------
-- staff: PK (id, clinic_id). La restricción staff_id_clinic_key (id, clinic_id)
-- sigue siendo el destino de las llaves foráneas compuestas; ninguna FK apunta
-- a staff_pkey, así que se puede reemplazar sin tocarlas.
-- ---------------------------------------------------------------------------
alter table public.staff drop constraint staff_pkey;
alter table public.staff add constraint staff_pkey primary key (id, clinic_id);
-- Búsquedas por usuario (resolución de la membresía activa).
create index staff_id_idx on public.staff (id);

-- ---------------------------------------------------------------------------
-- Consultorio activo por usuario
-- ---------------------------------------------------------------------------
-- La FK compuesta a staff garantiza que el usuario es (o fue) personal de ese
-- consultorio; la política exige además que siga activo al elegirlo. Si después
-- lo desactivan, las funciones de abajo ignoran la elección.
create table public.user_active_clinic (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  clinic_id uuid not null,
  constraint user_active_clinic_staff_fkey foreign key (user_id, clinic_id)
    references public.staff (id, clinic_id) on delete cascade
);

create index user_active_clinic_staff_idx on public.user_active_clinic (user_id, clinic_id);

-- ---------------------------------------------------------------------------
-- Membresía activa del usuario actual.
-- La elegida en user_active_clinic si sigue siendo personal activo ahí; si no
-- (sin elección, o ya no vale), su primera membresía activa (por antigüedad).
-- security definer: lee staff sin depender de sus políticas (evita recursión).
-- ---------------------------------------------------------------------------
create or replace function public.current_membership()
returns table (clinic_id uuid, role public.staff_role)
language sql
stable
security definer
set search_path = ''
as $$
  select s.clinic_id, s.role
  from public.staff s
  left join public.user_active_clinic u
    on u.user_id = s.id
   and u.clinic_id = s.clinic_id
  where s.id = auth.uid()
    and s.active
  order by (u.user_id is not null) desc, s.created_at, s.clinic_id
  limit 1
$$;

-- Las tres funciones de la RLS conservan su firma y su significado ("el
-- consultorio / rol / suscripción del usuario actual"), ahora sobre la
-- membresía activa. Siguen devolviendo null / false si no es personal activo.
create or replace function public.current_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.clinic_id from public.current_membership() m
$$;

create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.current_membership() m
$$;

create or replace function public.clinic_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.current_membership() m
    join public.clinics c on c.id = m.clinic_id
    where c.subscription_status in ('trial', 'active')
  )
$$;

-- true si el usuario actual es personal activo de p_clinic_id (para la
-- política de user_active_clinic, que no puede leer staff de otros
-- consultorios por la RLS de staff).
create or replace function public.is_active_member(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    where s.id = auth.uid()
      and s.clinic_id = p_clinic_id
      and s.active
  )
$$;

revoke execute on function public.current_membership() from public, anon;
revoke execute on function public.is_active_member(uuid) from public, anon;
grant execute on function public.current_membership() to authenticated, service_role;
grant execute on function public.is_active_member(uuid) to authenticated, service_role;

-- RLS de user_active_clinic: solo el propio usuario, y solo hacia un
-- consultorio donde es personal activo. Sin delete (no hace falta: al cambiar
-- se actualiza la fila).
alter table public.user_active_clinic enable row level security;
revoke all on public.user_active_clinic from anon, authenticated;
grant select, insert, update on public.user_active_clinic to authenticated;

create policy "user_active_clinic: lectura propia" on public.user_active_clinic
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_active_clinic: insert propio" on public.user_active_clinic
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_active_member(clinic_id)
  );

create policy "user_active_clinic: update propio" on public.user_active_clinic
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.is_active_member(clinic_id)
  );

-- ---------------------------------------------------------------------------
-- Topes por plan (único origen de verdad)
-- ---------------------------------------------------------------------------
--               | basic | basic + bot_addon | pro | plus
--   max_clinics |   1   |         1         |  3  | null (ilimitado)
--   max_doctors |   1   |         1         |  3  | null (ilimitado)
--   bot_enabled | false |       true        | true| true
-- La recepción (1 activa por consultorio) es igual en todos los planes y vive
-- en el trigger de staff. Devuelve cero filas si la cuenta no existe.
create or replace function public.account_entitlements(p_account_id uuid)
returns table (max_clinics integer, max_doctors integer, bot_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case a.plan when 'basic' then 1 when 'pro' then 3 else null end,
    case a.plan when 'basic' then 1 when 'pro' then 3 else null end,
    a.plan in ('pro', 'plus') or a.bot_addon
  from public.accounts a
  where a.id = p_account_id
$$;

-- Por ahora solo la service role (scripts y servidor); el acceso desde la
-- sesión del usuario se decide en la Fase 2.
revoke execute on function public.account_entitlements(uuid) from public, anon, authenticated;
grant execute on function public.account_entitlements(uuid) to service_role;

-- Errores de tope: SQLSTATE P0001 y hint con el nombre del tope
-- (max_clinics, max_doctors, max_receptionists, bot_required) para que la app
-- los traduzca a mensajes. Los triggers no distinguen el rol de quien escribe:
-- aplican también a la service role.
--
-- Concurrencia: cada trigger bloquea la fila de la cuenta (for update), así
-- dos altas simultáneas en la misma cuenta se serializan y no rebasan el tope.

-- clinics: tope de consultorios por cuenta y whatsapp_from solo con bot.
create or replace function public.clinics_enforce_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ent record;
  v_count integer;
begin
  perform 1 from public.accounts a where a.id = new.account_id for update;
  select * into v_ent from public.account_entitlements(new.account_id);
  if not found then
    -- La FK reporta la cuenta inexistente.
    return new;
  end if;

  -- Alta de consultorio (o cambio de cuenta).
  if tg_op = 'INSERT' or new.account_id is distinct from old.account_id then
    if v_ent.max_clinics is not null then
      select count(*) into v_count
      from public.clinics c
      where c.account_id = new.account_id
        and c.id <> new.id;
      if v_count >= v_ent.max_clinics then
        raise exception 'El plan de la cuenta permite % consultorio(s) y ya tiene %', v_ent.max_clinics, v_count
          using errcode = 'P0001', hint = 'max_clinics';
      end if;
    end if;
  end if;

  -- Número de WhatsApp: solo con bot (al asignarlo, cambiarlo o mover el consultorio de cuenta).
  if new.whatsapp_from is not null
     and (tg_op = 'INSERT'
          or new.whatsapp_from is distinct from old.whatsapp_from
          or new.account_id is distinct from old.account_id)
     and not v_ent.bot_enabled then
    raise exception 'El plan de la cuenta no incluye el bot de WhatsApp; no se puede asignar whatsapp_from'
      using errcode = 'P0001', hint = 'bot_required';
  end if;

  return new;
end;
$$;

revoke execute on function public.clinics_enforce_plan_limits() from public, anon, authenticated;

create trigger clinics_enforce_plan_limits
  before insert or update of account_id, whatsapp_from on public.clinics
  for each row execute function public.clinics_enforce_plan_limits();

-- staff: doctores distintos por cuenta (dentist u owner activos, una persona
-- en varias sedes cuenta una vez) y 1 recepcionista activo por consultorio.
-- Se revisa cuando la fila queda activa y antes no contaba igual: alta,
-- reactivación (active false -> true), cambio de rol o de consultorio.
create or replace function public.staff_enforce_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_ent record;
  v_count integer;
begin
  if not new.active then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.active
     and old.role = new.role
     and old.clinic_id = new.clinic_id
     and old.id = new.id then
    return new;
  end if;

  select c.account_id into v_account_id from public.clinics c where c.id = new.clinic_id;
  if v_account_id is null then
    -- La FK reporta el consultorio inexistente.
    return new;
  end if;
  perform 1 from public.accounts a where a.id = v_account_id for update;
  select * into v_ent from public.account_entitlements(v_account_id);

  if new.role in ('dentist', 'owner') and v_ent.max_doctors is not null then
    -- Si la persona ya cuenta como doctor en otra sede de la cuenta, no suma.
    if not exists (
      select 1
      from public.staff s
      join public.clinics c on c.id = s.clinic_id
      where c.account_id = v_account_id
        and s.id = new.id
        and s.clinic_id <> new.clinic_id
        and s.active
        and s.role in ('dentist', 'owner')
    ) then
      select count(distinct s.id) into v_count
      from public.staff s
      join public.clinics c on c.id = s.clinic_id
      where c.account_id = v_account_id
        and s.id <> new.id
        and s.active
        and s.role in ('dentist', 'owner');
      if v_count >= v_ent.max_doctors then
        raise exception 'El plan de la cuenta permite % doctor(es) y ya tiene %', v_ent.max_doctors, v_count
          using errcode = 'P0001', hint = 'max_doctors';
      end if;
    end if;
  end if;

  if new.role = 'receptionist' then
    if exists (
      select 1
      from public.staff s
      where s.clinic_id = new.clinic_id
        and s.id <> new.id
        and s.active
        and s.role = 'receptionist'
    ) then
      raise exception 'El consultorio ya tiene un recepcionista activo (máximo 1 por consultorio)'
        using errcode = 'P0001', hint = 'max_receptionists';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.staff_enforce_plan_limits() from public, anon, authenticated;

create trigger staff_enforce_plan_limits
  before insert or update of active, role, clinic_id, id on public.staff
  for each row execute function public.staff_enforce_plan_limits();

-- ---------------------------------------------------------------------------
-- Webhook: devuelve además bot_enabled (plan de la cuenta del consultorio).
-- Sin bot el mensaje se guarda igual; la app decide no responder (Fase 2).
-- Cambia el tipo de retorno, así que se borra y se vuelve a crear.
-- ---------------------------------------------------------------------------
drop function public.whatsapp_register_inbound(text, text, text, text);

create function public.whatsapp_register_inbound(
  p_to text,
  p_from text,
  p_message_sid text,
  p_body text
)
returns table (
  status text,
  clinic_id uuid,
  clinic_active boolean,
  patient_id uuid,
  conversation_id uuid,
  message_id uuid,
  bot_paused boolean,
  bot_enabled boolean
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_clinic public.clinics%rowtype;
  v_phone text := public.normalize_phone(p_from);
  v_patient_id uuid;
  v_conversation public.conversations%rowtype;
  v_message_id uuid;
  v_bot_enabled boolean;
begin
  select * into v_clinic from public.clinics c where c.whatsapp_from = p_to;
  if not found then
    return query select 'unknown_clinic'::text, null::uuid, null::boolean, null::uuid,
      null::uuid, null::uuid, null::boolean, null::boolean;
    return;
  end if;

  select coalesce(e.bot_enabled, false) into v_bot_enabled
  from public.account_entitlements(v_clinic.account_id) e;

  insert into public.patients as p (clinic_id, phone, status)
  values (v_clinic.id, v_phone, 'unidentified')
  on conflict on constraint patients_clinic_phone_key do nothing;
  select p.id into v_patient_id
  from public.patients p
  where p.clinic_id = v_clinic.id and p.phone = v_phone;

  insert into public.conversations as c (clinic_id, patient_id, phone)
  values (v_clinic.id, v_patient_id, p_from)
  on conflict on constraint conversations_patient_id_key do nothing;
  select * into v_conversation from public.conversations c where c.patient_id = v_patient_id;

  insert into public.messages as m (clinic_id, conversation_id, direction, sender, body, twilio_sid, status)
  values (v_clinic.id, v_conversation.id, 'in', 'patient', p_body, p_message_sid, 'received')
  on conflict on constraint messages_twilio_sid_key do nothing
  returning m.id into v_message_id;

  -- Se responde al último "From" con el que escribió el paciente.
  if v_message_id is not null and v_conversation.phone is distinct from p_from then
    update public.conversations c set phone = p_from where c.id = v_conversation.id;
  end if;

  return query select
    case when v_message_id is null then 'duplicate' else 'stored' end,
    v_clinic.id,
    v_clinic.subscription_status in ('trial', 'active'),
    v_patient_id,
    v_conversation.id,
    v_message_id,
    v_conversation.bot_paused,
    coalesce(v_bot_enabled, false);
end;
$$;

revoke execute on function public.whatsapp_register_inbound(text, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_register_inbound(text, text, text, text) to service_role;
