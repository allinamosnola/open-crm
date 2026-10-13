-- Respuesta fija a pacientes de consultorios sin bot.
--
-- Decisión del usuario (docs/plans/2026-10-01_1308_verificacion-fase-4.md,
-- puntos 1 y 2 de "Sin arreglar"): al bajar de plan se conserva el número de
-- WhatsApp del consultorio y los mensajes entrantes se siguen sin guardar (ni
-- paciente, ni conversación, ni mensaje; ver 20261001000003), pero al paciente
-- se le responde un texto fijo, como mucho una vez cada 24 h por número.
--
-- Para el límite se guarda solo cuándo se respondió por última vez a cada
-- número (normalizado con normalize_phone, +521 -> +52) en cada consultorio.
-- No se guarda el contenido de ningún mensaje.
--
-- Solo la service role (webhook) usa la tabla y la función: RLS activa sin
-- políticas y sin permisos para anon ni authenticated.

create table public.whatsapp_disabled_replies (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  phone text not null,
  last_replied_at timestamptz not null default now(),
  primary key (clinic_id, phone)
);

comment on table public.whatsapp_disabled_replies is
  'Última respuesta fija enviada a un número en un consultorio sin bot (límite de 1 cada 24 h). Sin contenido de mensajes.';

alter table public.whatsapp_disabled_replies enable row level security;
revoke all on table public.whatsapp_disabled_replies from public, anon, authenticated;
grant select, insert, update, delete on table public.whatsapp_disabled_replies to service_role;

-- Reserva la respuesta fija para (consultorio, número): true si no se le ha
-- respondido en las últimas 24 h (y deja registrada la de ahora), false si ya
-- se le respondió. Es atómica: dos mensajes simultáneos del mismo número no
-- obtienen true los dos.
create function public.whatsapp_claim_disabled_reply(p_clinic_id uuid, p_from text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_claimed boolean;
begin
  insert into public.whatsapp_disabled_replies as r (clinic_id, phone, last_replied_at)
  values (p_clinic_id, public.normalize_phone(p_from), now())
  on conflict (clinic_id, phone) do update
    set last_replied_at = excluded.last_replied_at
    where r.last_replied_at <= now() - interval '24 hours'
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;
revoke execute on function public.whatsapp_claim_disabled_reply(uuid, text) from public, anon, authenticated;
grant execute on function public.whatsapp_claim_disabled_reply(uuid, text) to service_role;
