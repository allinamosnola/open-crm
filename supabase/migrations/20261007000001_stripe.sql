-- Cobro con Stripe (docs/plans/2026-10-07_1218_integracion-stripe.md, Fase 1).
--   * accounts guarda los ids de Stripe y el estado de cobro. Una suscripción por
--     cuenta; sus ítems (plan base, Bot, consultorio extra) fijan plan, bot_addon
--     y extra_clinics.
--   * stripe_events da idempotencia al webhook (Stripe reintenta y puede repetir).
--   * stripe_apply_subscription() aplica el estado de la suscripción en una sola
--     transacción: cuenta + subscription_status de todos sus consultorios. Es el
--     único camino que escribe plan y estado de cobro; solo la service role.
-- subscription_status sigue en clinics (la RLS y el webhook de WhatsApp dependen
-- de él). El enum solo tiene trial|active|past_due|canceled: la app mapea
-- unpaid -> past_due e incomplete_expired -> canceled.

alter table public.accounts
  add column stripe_customer_id     text unique,
  add column stripe_subscription_id text unique,
  -- Consultorios extra cobrados (Plus, desde el 6.º). Informativo: no es un tope.
  add column extra_clinics          integer not null default 0 check (extra_clinics >= 0),
  -- Estado de la suscripción en Stripe tal cual (active, past_due, canceled...).
  add column billing_status         text;

-- accounts ya tiene RLS activa y sin acceso para anon/authenticated.

create table public.stripe_events (
  event_id     text primary key,
  type         text not null,
  received_at  timestamptz not null default now(),
  -- null mientras se procesa o si falló: Stripe reintenta y se vuelve a intentar.
  processed_at timestamptz
);

alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;

create or replace function public.stripe_apply_subscription(
  p_account_id uuid,
  p_plan public.account_plan,
  p_bot_addon boolean,
  p_extra_clinics integer,
  p_customer_id text,
  p_subscription_id text,
  p_billing_status text,
  p_clinic_status public.subscription_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.accounts a
  set plan = p_plan,
      bot_addon = p_bot_addon,
      extra_clinics = p_extra_clinics,
      stripe_customer_id = p_customer_id,
      stripe_subscription_id = p_subscription_id,
      billing_status = p_billing_status
  where a.id = p_account_id;
  if not found then
    raise exception 'No existe la cuenta %', p_account_id using errcode = 'P0002';
  end if;

  update public.clinics c
  set subscription_status = p_clinic_status
  where c.account_id = p_account_id
    and c.subscription_status is distinct from p_clinic_status;
end;
$$;

revoke execute on function public.stripe_apply_subscription(uuid, public.account_plan, boolean, integer, text, text, text, public.subscription_status)
  from public, anon, authenticated;
grant execute on function public.stripe_apply_subscription(uuid, public.account_plan, boolean, integer, text, text, text, public.subscription_status)
  to service_role;
