-- Planes y topes, Fase 2 (un plan de negocio no incluido en la copia pública).
-- Lectura de la cuenta desde la sesión del usuario, sin el cliente admin:
--   * my_clinics(): consultorios donde el usuario es personal activo (para el
--     selector de consultorio).
--   * my_entitlements(): plan, topes y uso de la cuenta del consultorio activo.
-- Ambas son security definer (accounts no tiene políticas y staff solo deja ver
-- el consultorio activo) y están acotadas a auth.uid(): nunca devuelven datos de
-- otra cuenta.
--
-- El cambio de consultorio activo NO necesita función: lo cubren las políticas
-- de user_active_clinic (Fase 1), que solo dejan elegir un consultorio donde el
-- usuario es personal activo. La app hace un upsert con la sesión del usuario.

-- ---------------------------------------------------------------------------
-- Consultorios del usuario actual
-- ---------------------------------------------------------------------------
-- is_active marca el consultorio activo (el que resuelve current_clinic_id()).
-- Sin sesión o sin membresías activas devuelve cero filas.
create or replace function public.my_clinics()
returns table (id uuid, name text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.id = public.current_clinic_id()
  from public.staff s
  join public.clinics c on c.id = s.clinic_id
  where s.id = auth.uid()
    and s.active
  order by c.name, c.id
$$;

revoke execute on function public.my_clinics() from public, anon;
grant execute on function public.my_clinics() to authenticated;

-- ---------------------------------------------------------------------------
-- Plan, topes y uso de la cuenta del consultorio activo
-- ---------------------------------------------------------------------------
-- Topes: los de account_entitlements() (null = ilimitado). La recepción es igual
-- en todos los planes (1 activa por consultorio, ver staff_enforce_plan_limits):
-- se devuelve aquí para que la app no repita la constante.
-- Uso (con la misma regla que los triggers):
--   clinics_used        consultorios de la cuenta;
--   doctors_used        personas distintas activas con rol dentist u owner en la cuenta;
--   receptionists_used  recepcionistas activos del consultorio activo.
-- Lo puede leer todo el personal activo (el panel oculta el bot según el plan).
-- Sin membresía activa devuelve cero filas.
create or replace function public.my_entitlements()
returns table (
  clinic_id uuid,
  account_id uuid,
  plan public.account_plan,
  bot_addon boolean,
  bot_enabled boolean,
  max_clinics integer,
  max_doctors integer,
  max_receptionists_per_clinic integer,
  clinics_used integer,
  doctors_used integer,
  receptionists_used integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with active as (
    select c.id as clinic_id, c.account_id
    from public.clinics c
    where c.id = public.current_clinic_id()
  )
  select
    act.clinic_id,
    a.id,
    a.plan,
    a.bot_addon,
    e.bot_enabled,
    e.max_clinics,
    e.max_doctors,
    1,
    (select count(*)::integer from public.clinics c where c.account_id = a.id),
    (select count(distinct s.id)::integer
       from public.staff s
       join public.clinics c on c.id = s.clinic_id
      where c.account_id = a.id
        and s.active
        and s.role in ('dentist', 'owner')),
    (select count(*)::integer
       from public.staff s
      where s.clinic_id = act.clinic_id
        and s.active
        and s.role = 'receptionist')
  from active act
  join public.accounts a on a.id = act.account_id
  cross join lateral public.account_entitlements(a.id) e
$$;

revoke execute on function public.my_entitlements() from public, anon;
grant execute on function public.my_entitlements() to authenticated;
