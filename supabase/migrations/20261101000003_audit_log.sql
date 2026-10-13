-- Bitácora de auditoría (Fase 7 del plan de brecha 2026-10-12): quién, qué y
-- cuándo se modificó en pacientes, notas clínicas, pagos y personal.
--   * La alimentan triggers (after insert/update/delete); la app no escribe en
--     ella. Cubre también los cambios de la service role (webhook, Stripe,
--     scripts): actor_id queda null y actor_role = 'service_role'.
--   * Solo inserción: nadie (ni la service role) tiene update, delete ni
--     truncate, y un trigger rechaza update/delete aunque alguien recupere el
--     privilegio. Sin FK a clinics/staff: la bitácora sobrevive a los borrados.
--   * Lectura: solo el owner, y solo de su consultorio activo.
--   * Sin datos de salud: se guardan los nombres de las columnas que cambiaron,
--     nunca sus valores (el texto de una nota clínica no se copia aquí).

create table public.audit_log (
  id             bigint generated always as identity primary key,
  clinic_id      uuid not null,
  -- auth.uid() de quien hizo el cambio; null = service role / sistema.
  actor_id       uuid,
  -- Rol de la petición: 'authenticated', 'service_role' o el usuario de Postgres.
  actor_role     text not null,
  table_name     text not null check (table_name in ('patients', 'clinical_notes', 'payments', 'staff')),
  record_id      uuid not null,
  action         text not null check (action in ('insert', 'update', 'delete')),
  -- Columnas que cambiaron (solo en update; sin valores).
  changed_fields text[],
  created_at     timestamptz not null default now()
);

create index audit_log_clinic_created_idx on public.audit_log (clinic_id, created_at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated, service_role;

create policy "audit_log: lectura owner" on public.audit_log
  for select to authenticated
  using (
    clinic_id = (select public.current_clinic_id())
    and (select public.current_staff_role()) = 'owner'
  );

-- Inmutable: update y delete fallan aunque se otorgue el privilegio.
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log es de solo inserción' using errcode = 'P0001', hint = 'audit_log_immutable';
end;
$$;

revoke execute on function public.audit_log_immutable() from public, anon, authenticated;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

-- ---------------------------------------------------------------------------
-- Trigger de auditoría. security definer: escribe en audit_log aunque quien
-- modifica no tenga privilegio sobre ella. Un update sin cambios reales (o que
-- solo toca updated_at) no deja registro.
-- ---------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     jsonb;
  v_changed text[];
  v_claims  jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value
      and n.key <> 'updated_at';
    if v_changed is null then
      return null;
    end if;
  end if;

  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  insert into public.audit_log (clinic_id, actor_id, actor_role, table_name, record_id, action, changed_fields)
  values (
    (v_row ->> 'clinic_id')::uuid,
    auth.uid(),
    coalesce(v_claims ->> 'role', current_user::text),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    lower(tg_op),
    v_changed
  );
  return null;
end;
$$;

revoke execute on function public.audit_row_change() from public, anon, authenticated;

create trigger patients_audit
  after insert or update or delete on public.patients
  for each row execute function public.audit_row_change();

create trigger clinical_notes_audit
  after insert or update or delete on public.clinical_notes
  for each row execute function public.audit_row_change();

create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function public.audit_row_change();

create trigger staff_audit
  after insert or update or delete on public.staff
  for each row execute function public.audit_row_change();
