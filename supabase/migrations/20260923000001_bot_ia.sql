-- Semanas 3-4: bot con IA (agente con herramientas) y ajustes a la Semana 2.
--   * clinics: horario de atención por día, duración de cita por defecto y correo
--     de la recepción (los edita el owner).
--   * conversations: marca "requiere atención" cuando el bot escala a la recepción.
--   * Teléfonos: +52 y +521 (celulares de México) se unifican a +52 + 10 dígitos
--     al guardar y al buscar (normalize_phone). Al responder se usa el "From"
--     original de Twilio, que queda en conversations.phone.
--   * Candado por conversación para que dos mensajes simultáneos no pisen bot_state.

-- ---------------------------------------------------------------------------
-- Normalización de teléfonos
-- ---------------------------------------------------------------------------

-- "+5215512345678" -> "+525512345678". Solo reescribe el prefijo de celular
-- viejo de México (+521 seguido de 10 dígitos); cualquier otro valor se
-- devuelve igual. La misma regla vive en src/lib/whatsapp/phone.ts (normalizePhone).
create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_phone ~ '^\+521[0-9]{10}$' then '+52' || substr(p_phone, 5)
    else p_phone
  end
$$;

-- Migra los teléfonos existentes (hoy solo hay datos de seed). Si el mismo
-- consultorio ya tiene el número en los dos formatos, la migración se detiene:
-- hay que fusionar esos pacientes a mano antes de aplicarla.
do $$
begin
  if exists (
    select 1
    from public.patients p
    join public.patients q
      on q.clinic_id = p.clinic_id
     and q.id <> p.id
     and q.phone = public.normalize_phone(p.phone)
    where p.phone ~ '^\+521[0-9]{10}$'
  ) then
    raise exception 'Hay pacientes con el mismo teléfono en formato +52 y +521 en un consultorio; fusiónalos antes de migrar';
  end if;

  update public.patients
  set phone = public.normalize_phone(phone)
  where phone ~ '^\+521[0-9]{10}$';
end;
$$;

-- A partir de aquí la base solo acepta teléfonos ya normalizados.
alter table public.patients
  add constraint patients_phone_normalized
    check (phone is null or phone = public.normalize_phone(phone));

-- ---------------------------------------------------------------------------
-- Configuración del consultorio para el bot
-- ---------------------------------------------------------------------------

-- Valida el formato de clinics.business_hours:
--   {"mon": [["09:00","14:00"], ["16:00","20:00"]], "sat": [["09:00","13:00"]]}
-- Llaves mon..sun (un día sin llave o con lista vacía = cerrado); cada rango es
-- ["HH:MM","HH:MM"] con inicio < fin. Los traslapes entre rangos del mismo día
-- los valida la capa de datos (clinicSettingsSchema).
create or replace function public.business_hours_valid(p_hours jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_day text;
  v_ranges jsonb;
  v_range jsonb;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' then
    return false;
  end if;
  for v_day, v_ranges in select key, value from jsonb_each(p_hours) loop
    if v_day not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
       or jsonb_typeof(v_ranges) <> 'array' then
      return false;
    end if;
    for v_range in select value from jsonb_array_elements(v_ranges) loop
      if jsonb_typeof(v_range) <> 'array'
         or jsonb_array_length(v_range) <> 2
         or jsonb_typeof(v_range -> 0) <> 'string'
         or jsonb_typeof(v_range -> 1) <> 'string'
         or (v_range ->> 0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or (v_range ->> 1) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or (v_range ->> 0) >= (v_range ->> 1) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

alter table public.clinics
  -- Sin horario ('{}') el bot no puede ofrecer citas y escala a la recepción.
  add column business_hours jsonb not null default '{}'::jsonb
    constraint clinics_business_hours_valid check (public.business_hours_valid(business_hours)),
  add column default_appointment_minutes integer not null default 30
    constraint clinics_default_appointment_minutes_range
      check (default_appointment_minutes between 10 and 240),
  -- Destino de los avisos de escalamiento por email (null = solo aviso en el panel).
  add column reception_email text
    constraint clinics_reception_email_format
      check (reception_email is null or reception_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- El owner edita también las tres columnas nuevas (la política
-- "clinics: update owner" ya limita la fila, el rol y la suscripción).
grant update (business_hours, default_appointment_minutes, reception_email)
  on public.clinics to authenticated;

-- ---------------------------------------------------------------------------
-- Escalamiento a la recepción
-- ---------------------------------------------------------------------------
create type public.attention_category as enum (
  'human_requested', -- el paciente pidió una persona
  'urgent',          -- dolor fuerte, sangrado, inflamación o trauma
  'policy',          -- cancelar o reagendar con menos de 24 h
  'not_understood',  -- dos turnos seguidos sin entender
  'other'            -- temas fuera de agenda que el bot no puede responder
);

alter table public.conversations
  add column needs_attention boolean not null default false,
  -- Motivo, categoría y fecha del último escalamiento (se conservan al marcarlo
  -- resuelto; el panel solo muestra los que tienen needs_attention = true).
  add column attention_reason text,
  add column attention_category public.attention_category,
  add column escalated_at timestamptz,
  add constraint conversations_attention_has_category
    check (not needs_attention or attention_category is not null);

-- Sección "Requiere atención" de la bandeja y contador de la barra lateral.
create index conversations_clinic_attention_idx
  on public.conversations (clinic_id, escalated_at desc)
  where needs_attention;

-- El personal marca como resuelto (needs_attention = false). El escalamiento
-- lo escribe el servidor con la service role.
grant update (needs_attention) on public.conversations to authenticated;

-- ---------------------------------------------------------------------------
-- Webhook: registra el mensaje entrante con el teléfono normalizado
-- ---------------------------------------------------------------------------
-- Igual que en la Semana 2, salvo que:
--   * el paciente se busca y se crea con normalize_phone(p_from);
--   * conversations.phone guarda el "From" original de Twilio (a ese número se
--     responde) y se actualiza si el paciente escribe con otro formato.
create or replace function public.whatsapp_register_inbound(
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
  bot_paused boolean
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
begin
  select * into v_clinic from public.clinics c where c.whatsapp_from = p_to;
  if not found then
    return query select 'unknown_clinic'::text, null::uuid, null::boolean, null::uuid,
      null::uuid, null::uuid, null::boolean;
    return;
  end if;

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
    v_conversation.bot_paused;
end;
$$;

-- ---------------------------------------------------------------------------
-- Candado por conversación (solo service role)
-- ---------------------------------------------------------------------------
-- Un turno del bot (Claude + herramientas) dura varios segundos y hace varias
-- llamadas a la base, así que no cabe en una sola transacción. Cada función
-- toma pg_advisory_xact_lock de la conversación y, dentro de él, revisa y
-- escribe un "turno" con vencimiento en bot_state (lease_token, lease_until):
--   * bot_acquire_turn: si nadie tiene el turno (o venció), lo toma y devuelve
--     el estado del bot sin las llaves del candado; si no, acquired = false y
--     quien llama reintenta.
--   * bot_release_turn: guarda el estado nuevo y suelta el turno, solo si el
--     token coincide (si el turno venció y otro lo tomó, no pisa su estado).
create or replace function public.bot_acquire_turn(
  p_conversation_id uuid,
  p_lease_seconds integer default 90
)
returns table (acquired boolean, token uuid, bot_state jsonb)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_state jsonb;
  v_until timestamptz;
  v_token uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended('bot_turn:' || p_conversation_id::text, 0));

  select c.bot_state into v_state from public.conversations c where c.id = p_conversation_id;
  if not found then
    return query select false, null::uuid, null::jsonb;
    return;
  end if;

  v_until := nullif(v_state ->> 'lease_until', '')::timestamptz;
  if v_until is not null and v_until > clock_timestamp() then
    return query select false, null::uuid, null::jsonb;
    return;
  end if;

  update public.conversations c
  set bot_state = coalesce(c.bot_state, '{}'::jsonb) || jsonb_build_object(
    'lease_token', v_token,
    'lease_until', clock_timestamp() + make_interval(secs => p_lease_seconds)
  )
  where c.id = p_conversation_id;

  return query select true, v_token, coalesce(v_state, '{}'::jsonb) - 'lease_token' - 'lease_until';
end;
$$;

-- p_bot_state null = suelta el turno sin cambiar el estado.
create or replace function public.bot_release_turn(
  p_conversation_id uuid,
  p_token uuid,
  p_bot_state jsonb default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_updated integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('bot_turn:' || p_conversation_id::text, 0));

  update public.conversations c
  set bot_state = coalesce(p_bot_state, c.bot_state) - 'lease_token' - 'lease_until'
  where c.id = p_conversation_id
    and c.bot_state ->> 'lease_token' = p_token::text;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke execute on function public.bot_acquire_turn(uuid, integer) from public, anon, authenticated;
revoke execute on function public.bot_release_turn(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.bot_acquire_turn(uuid, integer) to service_role;
grant execute on function public.bot_release_turn(uuid, uuid, jsonb) to service_role;
