-- Semana 2: conexión a WhatsApp vía Twilio.
--   * Pacientes "por identificar": el webhook crea un paciente solo con teléfono
--     cuando escribe un número desconocido; la recepción completa el nombre.
--   * Una conversación por paciente, con el estado del bot en la misma fila.
--   * Mensajes entrantes y salientes (paciente, bot, recepción) con su estado de entrega.
-- El webhook escribe con la service role (bypass de RLS) desde el servidor; el
-- personal lee, responde y pausa el bot con su sesión (RLS).

-- ---------------------------------------------------------------------------
-- Pacientes por identificar
-- ---------------------------------------------------------------------------
create type public.patient_status as enum ('active', 'unidentified');

alter table public.patients
  add column status public.patient_status not null default 'active',
  alter column full_name drop not null,
  add constraint patients_full_name_required
    check (status = 'unidentified' or full_name is not null);

-- ---------------------------------------------------------------------------
-- Conversaciones (una por paciente)
-- ---------------------------------------------------------------------------
create type public.msg_direction as enum ('in', 'out');
create type public.msg_sender as enum ('patient', 'bot', 'staff');

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null default public.current_clinic_id() references public.clinics (id),
  patient_id      uuid not null unique,
  -- Teléfono E.164 al que se responde (el "From" del paciente).
  phone           text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Estado del bot (SessionStore de src/lib/bot); '{}' = sin flujo pendiente.
  bot_state       jsonb not null default '{}'::jsonb,
  -- true cuando la recepción toma la conversación: el webhook ya no responde con el bot.
  bot_paused      boolean not null default false,
  last_message_at timestamptz,
  unread_count    integer not null default 0 check (unread_count >= 0),
  created_at      timestamptz not null default now(),
  constraint conversations_id_clinic_key unique (id, clinic_id),
  constraint conversations_patient_id_fkey foreign key (patient_id, clinic_id)
    references public.patients (id, clinic_id)
);

create index conversations_clinic_last_message_idx
  on public.conversations (clinic_id, last_message_at desc nulls last);

-- ---------------------------------------------------------------------------
-- Mensajes
-- ---------------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null default public.current_clinic_id() references public.clinics (id),
  conversation_id uuid not null,
  direction       public.msg_direction not null,
  sender          public.msg_sender not null,
  body            text not null,
  -- MessageSid de Twilio: hace idempotente el webhook (los reintentos no duplican)
  -- y liga el callback de estado con el mensaje saliente.
  twilio_sid      text unique,
  status          text not null
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  -- Código de error de Twilio (p. ej. 63016 = fuera de la ventana de 24 h).
  error_code      text,
  staff_id        uuid,
  created_at      timestamptz not null default now(),
  constraint messages_conversation_id_fkey foreign key (conversation_id, clinic_id)
    references public.conversations (id, clinic_id) on delete cascade,
  constraint messages_staff_id_fkey foreign key (staff_id, clinic_id)
    references public.staff (id, clinic_id),
  -- Solo el paciente escribe "in"; bot y recepción escriben "out".
  constraint messages_direction_sender check ((direction = 'in') = (sender = 'patient')),
  -- staff_id identifica a quien respondió desde el panel, y solo en ese caso.
  constraint messages_staff_sender check ((sender = 'staff') = (staff_id is not null))
);

create index messages_conversation_created_idx on public.messages (conversation_id, created_at);

-- Cada mensaje nuevo actualiza last_message_at de la conversación, y los
-- entrantes suman a unread_count. security definer: el personal solo tiene
-- privilegio de update sobre bot_paused y unread_count.
create or replace function public.messages_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations c
  set last_message_at = greatest(coalesce(c.last_message_at, new.created_at), new.created_at),
      unread_count = c.unread_count + case when new.direction = 'in' then 1 else 0 end
  where c.id = new.conversation_id;
  return null;
end;
$$;

revoke execute on function public.messages_touch_conversation() from public, anon, authenticated;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.messages_touch_conversation();

-- ---------------------------------------------------------------------------
-- Funciones del webhook (solo service role). Hacen cada paso en una sola
-- transacción, así los reintentos y los mensajes simultáneos no duplican filas.
-- ---------------------------------------------------------------------------

-- Registra un mensaje entrante. p_to y p_from en E.164 (sin "whatsapp:").
--   status = 'unknown_clinic' si ningún consultorio tiene ese número;
--            'duplicate'      si el MessageSid ya estaba registrado (reintento de Twilio);
--            'stored'         si se guardó el mensaje.
-- Si el teléfono no es de ningún paciente del consultorio, crea uno
-- 'unidentified' (sin nombre) y su conversación.
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
  values (v_clinic.id, p_from, 'unidentified')
  on conflict on constraint patients_clinic_phone_key do nothing;
  select p.id into v_patient_id
  from public.patients p
  where p.clinic_id = v_clinic.id and p.phone = p_from;

  insert into public.conversations as c (clinic_id, patient_id, phone)
  values (v_clinic.id, v_patient_id, p_from)
  on conflict on constraint conversations_patient_id_key do nothing;
  select * into v_conversation from public.conversations c where c.patient_id = v_patient_id;

  insert into public.messages as m (clinic_id, conversation_id, direction, sender, body, twilio_sid, status)
  values (v_clinic.id, v_conversation.id, 'in', 'patient', p_body, p_message_sid, 'received')
  on conflict on constraint messages_twilio_sid_key do nothing
  returning m.id into v_message_id;

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

-- Aplica un callback de estado de Twilio. Solo avanza el estado
-- (queued < sent < delivered < read); 'failed' es final y los callbacks que
-- llegan desordenados no lo retroceden. Devuelve true si actualizó la fila.
create or replace function public.whatsapp_update_status(
  p_sid text,
  p_status text,
  p_error_code text default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_rank constant text[] := array['queued', 'sent', 'delivered', 'read'];
  v_updated integer;
begin
  update public.messages m
  set status = p_status,
      error_code = coalesce(p_error_code, m.error_code)
  where m.twilio_sid = p_sid
    and m.direction = 'out'
    and m.status <> 'failed'
    and (
      p_status = 'failed'
      or coalesce(array_position(v_rank, p_status), 0) > coalesce(array_position(v_rank, m.status), 0)
    );
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke execute on function public.whatsapp_register_inbound(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.whatsapp_update_status(text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_register_inbound(text, text, text, text) to service_role;
grant execute on function public.whatsapp_update_status(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- RLS
--   * conversations: el personal activo lee las de su consultorio y solo puede
--     cambiar bot_paused y unread_count (privilegio por columna). Las crea el webhook.
--   * messages: el personal activo lee e inserta respuestas propias
--     (sender = 'staff', staff_id = auth.uid()). Los estados los actualiza el
--     servidor con la service role.
--   * Escritura solo con suscripción activa, como el resto de tablas.
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

revoke insert, update, delete on public.conversations from anon, authenticated;
grant update (bot_paused, unread_count) on public.conversations to authenticated;
revoke update, delete on public.messages from anon, authenticated;

create policy "conversations: lectura" on public.conversations
  for select to authenticated
  using (clinic_id = (select public.current_clinic_id()));
create policy "conversations: update" on public.conversations
  for update to authenticated
  using (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()))
  with check (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()));

create policy "messages: lectura" on public.messages
  for select to authenticated
  using (clinic_id = (select public.current_clinic_id()));
create policy "messages: insert respuesta del personal" on public.messages
  for insert to authenticated
  with check (
    clinic_id = (select public.current_clinic_id())
    and (select public.clinic_is_active())
    and direction = 'out'
    and sender = 'staff'
    and staff_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Realtime: la bandeja se actualiza sola (respeta la RLS de select).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages, public.conversations;
