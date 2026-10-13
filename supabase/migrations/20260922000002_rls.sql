-- Row Level Security (Semana 1, reescrita en la Semana 1b para multi-consultorio).
--   * Toda política exige clinic_id = current_clinic_id(): cada usuario solo ve y
--     escribe su consultorio. current_clinic_id() es null para personal inactivo,
--     así que desactivar a alguien le quita el acceso de inmediato.
--   * Las políticas de escritura exigen además clinic_is_active() (suscripción
--     trial o active); con past_due o canceled el consultorio queda en solo lectura.
--   * Roles:
--       - todo el personal: CRUD de pacientes, citas y pagos; lectura de catálogo,
--         planes, items, saldos y personal;
--       - dentist y owner: escritura de catálogo, planes e items, y cualquier
--         acceso a clinical_notes (la recepción no las ve);
--       - owner: administra staff de su consultorio y edita name/timezone de clinics.
--   * La administración del SaaS (alta de consultorios, whatsapp_from,
--     subscription_status) se hace fuera de la app con la service role. No hay
--     rol "superadmin" en la RLS. Sin registro público (enable_signup = false).
--
-- (select f()) hace que Postgres evalúe la función una vez por consulta, no por fila.

alter table public.clinics              enable row level security;
alter table public.staff                enable row level security;
alter table public.patients             enable row level security;
alter table public.treatments           enable row level security;
alter table public.treatment_plans      enable row level security;
alter table public.treatment_plan_items enable row level security;
alter table public.appointments         enable row level security;
alter table public.payments             enable row level security;
alter table public.clinical_notes       enable row level security;

-- ---------------------------------------------------------------------------
-- clinics: el personal lee su propia fila; el owner solo puede cambiar name y
-- timezone (privilegio por columna). Sin políticas de insert/delete.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.clinics from anon, authenticated;
grant update (name, timezone) on public.clinics to authenticated;

create policy "clinics: lectura propia" on public.clinics
  for select to authenticated
  using (id = (select public.current_clinic_id()));

create policy "clinics: update owner" on public.clinics
  for update to authenticated
  using (
    id = (select public.current_clinic_id())
    and (select public.current_staff_role()) = 'owner'
    and (select public.clinic_is_active())
  )
  with check (
    id = (select public.current_clinic_id())
    and (select public.current_staff_role()) = 'owner'
    and (select public.clinic_is_active())
  );

-- ---------------------------------------------------------------------------
-- staff: lectura para el personal activo del consultorio; el owner administra.
-- Las invitaciones las crea una server action con la service role (después de
-- comprobar que quien llama es owner); aquí el owner puede además editar y
-- desactivar (active = false) a su personal.
-- ---------------------------------------------------------------------------
create policy "staff: lectura mismo consultorio" on public.staff
  for select to authenticated
  using (clinic_id = (select public.current_clinic_id()));

create policy "staff: insert owner" on public.staff
  for insert to authenticated
  with check (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) = 'owner'
    and (select public.clinic_is_active())
  );
create policy "staff: update owner" on public.staff
  for update to authenticated
  using (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) = 'owner'
    and (select public.clinic_is_active())
  )
  with check (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) = 'owner'
    and (select public.clinic_is_active())
  );
-- Sin política de delete: el personal se desactiva (active = false), no se
-- borra. Solo la service role puede borrar filas de staff.

-- Reglas extra para el personal que la RLS no expresa bien (compara con la fila
-- anterior). Solo aplican a sesiones de usuario (rol authenticated): la service
-- role (scripts de plataforma como create-clinic) no queda limitada.
--   1. Nadie asigna el rol owner, ni al invitar ni al editar.
--   2. Nadie se desactiva a sí mismo ni cambia su propio rol.
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

revoke execute on function public.staff_guard_owner_rules() from public, anon;

create trigger staff_guard_owner_rules
  before insert or update on public.staff
  for each row execute function public.staff_guard_owner_rules();

-- ---------------------------------------------------------------------------
-- patients, appointments, payments: lectura y escritura para todo el personal
-- activo del consultorio; escritura solo con suscripción activa.
-- ---------------------------------------------------------------------------
create policy "patients: lectura" on public.patients
  for select to authenticated
  using (clinic_id = (select public.current_clinic_id()));
create policy "patients: insert" on public.patients
  for insert to authenticated
  with check (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()));
create policy "patients: update" on public.patients
  for update to authenticated
  using (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()))
  with check (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()));
create policy "patients: delete" on public.patients
  for delete to authenticated
  using (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()));

create policy "appointments: lectura" on public.appointments
  for select to authenticated
  using (clinic_id = (select public.current_clinic_id()));
create policy "appointments: insert" on public.appointments
  for insert to authenticated
  with check (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()));
create policy "appointments: update" on public.appointments
  for update to authenticated
  using (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()))
  with check (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()));
create policy "appointments: delete" on public.appointments
  for delete to authenticated
  using (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()));

create policy "payments: lectura" on public.payments
  for select to authenticated
  using (clinic_id = (select public.current_clinic_id()));
create policy "payments: insert" on public.payments
  for insert to authenticated
  with check (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()));
create policy "payments: update" on public.payments
  for update to authenticated
  using (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()))
  with check (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()));
create policy "payments: delete" on public.payments
  for delete to authenticated
  using (clinic_id = (select public.current_clinic_id()) and (select public.clinic_is_active()));

-- ---------------------------------------------------------------------------
-- treatments, treatment_plans, treatment_plan_items: lectura para todo el
-- personal (la recepción ve planes y precios para cobrar); escritura solo
-- dentist y owner.
-- ---------------------------------------------------------------------------
create policy "treatments: lectura" on public.treatments
  for select to authenticated
  using (clinic_id = (select public.current_clinic_id()));
create policy "treatments: insert dentista" on public.treatments
  for insert to authenticated
  with check (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  );
create policy "treatments: update dentista" on public.treatments
  for update to authenticated
  using (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  )
  with check (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  );
create policy "treatments: delete dentista" on public.treatments
  for delete to authenticated
  using (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  );

create policy "treatment_plans: lectura" on public.treatment_plans
  for select to authenticated
  using (clinic_id = (select public.current_clinic_id()));
create policy "treatment_plans: insert dentista" on public.treatment_plans
  for insert to authenticated
  with check (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  );
create policy "treatment_plans: update dentista" on public.treatment_plans
  for update to authenticated
  using (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  )
  with check (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  );
create policy "treatment_plans: delete dentista" on public.treatment_plans
  for delete to authenticated
  using (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  );

create policy "treatment_plan_items: lectura" on public.treatment_plan_items
  for select to authenticated
  using (clinic_id = (select public.current_clinic_id()));
create policy "treatment_plan_items: insert dentista" on public.treatment_plan_items
  for insert to authenticated
  with check (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  );
create policy "treatment_plan_items: update dentista" on public.treatment_plan_items
  for update to authenticated
  using (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  )
  with check (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  );
create policy "treatment_plan_items: delete dentista" on public.treatment_plan_items
  for delete to authenticated
  using (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  );

-- ---------------------------------------------------------------------------
-- clinical_notes: solo dentist y owner (lectura y escritura).
-- ---------------------------------------------------------------------------
create policy "clinical_notes: lectura dentista" on public.clinical_notes
  for select to authenticated
  using (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
  );
create policy "clinical_notes: insert dentista" on public.clinical_notes
  for insert to authenticated
  with check (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  );
create policy "clinical_notes: update dentista" on public.clinical_notes
  for update to authenticated
  using (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  )
  with check (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  );
create policy "clinical_notes: delete dentista" on public.clinical_notes
  for delete to authenticated
  using (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) in ('dentist', 'owner')
    and (select public.clinic_is_active())
  );
