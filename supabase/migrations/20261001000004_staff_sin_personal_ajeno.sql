-- Verificación de planes y topes (docs/plans/2026-10-01_1308_verificacion-fase-4.md).
--
-- Defecto: al pasar staff de PK (id) a PK (id, clinic_id) (20261001000001), un
-- owner podía, con su sesión y directo contra la API, insertar en su consultorio
-- una fila de staff con el id de un usuario de OTRA cuenta (o cambiar el id de
-- una fila existente a ese usuario). Antes la PK (id) lo impedía. El usuario
-- ajeno pasaba a tener acceso al consultorio del owner y, con un created_at
-- antiguo, ese consultorio se volvía su consultorio activo por defecto.
--
-- Arreglo (solo para la sesión, current_user = 'authenticated'; la service role
-- de los scripts y de inviteStaff no cambia):
--   * insert: el id no puede ser personal de un consultorio de otra cuenta;
--   * update: el id de una fila no cambia.
-- El resto de staff_guard_owner_rules queda igual.

create or replace function public.staff_guard_owner_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.role = 'owner' and (tg_op = 'INSERT' or old.role is distinct from 'owner') then
    raise exception 'No se puede asignar el rol owner desde la app'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'No se puede cambiar el usuario de una fila de personal'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and public.staff_in_other_account(new.id, new.clinic_id) then
    raise exception 'Esa persona es personal de otra cuenta'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.id = auth.uid() then
    if new.active is distinct from old.active and not new.active then
      raise exception 'No puedes desactivar tu propia cuenta' using errcode = '42501';
    end if;
    if new.role is distinct from old.role then
      raise exception 'No puedes cambiar tu propio rol' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- true si p_user_id es personal (activo o no) de algún consultorio de una cuenta
-- distinta a la de p_clinic_id. security definer: la RLS de staff solo deja ver
-- el consultorio activo.
create or replace function public.staff_in_other_account(p_user_id uuid, p_clinic_id uuid)
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
    join public.clinics target on target.id = p_clinic_id
    where s.id = p_user_id
      and c.account_id <> target.account_id
  )
$$;

revoke execute on function public.staff_in_other_account(uuid, uuid) from public, anon;
grant execute on function public.staff_in_other_account(uuid, uuid) to authenticated, service_role;
