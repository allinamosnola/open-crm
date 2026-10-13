-- Si Twilio no pudo enviar el texto fijo a un paciente de un consultorio sin bot,
-- se libera el turno reservado por whatsapp_claim_disabled_reply para que el
-- siguiente mensaje de ese número pueda volver a intentarlo (y no quede 24 h sin respuesta).
-- Solo la usa la service role (el webhook). El claim de 24 h ya impide que otro
-- mensaje reserve el turno mientras este está vigente, así que borrar la fila
-- no pisa la reserva de nadie más.
create function public.whatsapp_release_disabled_reply(p_clinic_id uuid, p_from text)
returns void
language sql
set search_path = ''
as $$
  delete from public.whatsapp_disabled_replies
  where clinic_id = p_clinic_id
    and phone = public.normalize_phone(p_from);
$$;
revoke execute on function public.whatsapp_release_disabled_reply(uuid, text) from public, anon, authenticated;
grant execute on function public.whatsapp_release_disabled_reply(uuid, text) to service_role;
