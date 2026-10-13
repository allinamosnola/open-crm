-- Mensajes entrantes de consultorios sin bot.
--
-- Decisión del usuario: si el plan de la cuenta no incluye el bot
-- (account_entitlements(...).bot_enabled = false), los mensajes entrantes de
-- WhatsApp NO se guardan: ni paciente "por identificar", ni conversación, ni
-- mensaje. Antes se guardaban y no se respondían.
--
-- whatsapp_register_inbound devuelve el estado nuevo 'bot_disabled' justo
-- después de resolver el consultorio por el número "To", sin insertar nada.
-- El resto se conserva (unknown_clinic, duplicate, idempotencia por
-- MessageSid, clinic_active, bot_paused). La columna bot_enabled del resultado
-- desaparece: con 'stored'/'duplicate' siempre sería true. Cambia el tipo de
-- retorno, así que hay que borrar y recrear la función (y sus permisos).
-- Sin cambios en políticas RLS.

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
  v_bot_enabled boolean;
begin
  select * into v_clinic from public.clinics c where c.whatsapp_from = p_to;
  if not found then
    return query select 'unknown_clinic'::text, null::uuid, null::boolean, null::uuid,
      null::uuid, null::uuid, null::boolean;
    return;
  end if;

  -- Sin bot en el plan el mensaje se descarta sin guardar nada.
  select coalesce(e.bot_enabled, false) into v_bot_enabled
  from public.account_entitlements(v_clinic.account_id) e;
  if not coalesce(v_bot_enabled, false) then
    return query select 'bot_disabled'::text, v_clinic.id, null::boolean, null::uuid,
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
revoke execute on function public.whatsapp_register_inbound(text, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_register_inbound(text, text, text, text) to service_role;
