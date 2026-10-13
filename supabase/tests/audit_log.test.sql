-- npx supabase test db (requiere la seed: npx supabase db reset).
-- Bitácora de auditoría (migración 20261101000003_audit_log.sql): los triggers
-- registran quién, qué y cuándo en pacientes, notas clínicas, pagos y personal;
-- solo inserción; lectura solo del owner de su consultorio; sin valores.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

-- Se parte de la bitácora vacía para contar solo lo de esta prueba (la seed ya
-- dejó registros). El trigger de inmutabilidad se apaga solo dentro de la
-- transacción de la prueba (rollback al final).
alter table public.audit_log disable trigger audit_log_immutable;
delete from public.audit_log;
alter table public.audit_log enable trigger audit_log_immutable;

select ok((select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass),
  'RLS activa en audit_log');

-- Recepción de Sonrisas (A): alta de paciente y pago.
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
insert into public.patients (id, full_name, phone)
values ('b0000000-0000-0000-0000-0000000ad001', 'Paciente Auditoría', '+525598765432');
update public.patients set phone = '+525598765433', updated_at = now()
where id = 'b0000000-0000-0000-0000-0000000ad001';
update public.patients set full_name = full_name where id = 'b0000000-0000-0000-0000-0000000ad001';
insert into public.payments (id, patient_id, amount, method)
values ('d0000000-0000-0000-0000-0000000ad001', 'b0000000-0000-0000-0000-0000000ad001', 500, 'cash');
delete from public.payments where id = 'd0000000-0000-0000-0000-0000000ad001';

select is((select count(*)::int from public.audit_log), 0,
  'la recepción no puede leer la bitácora');
select throws_ok(
  $$insert into public.audit_log (clinic_id, actor_role, table_name, record_id, action)
    values ('f0000000-0000-0000-0000-00000000000a', 'x', 'patients', gen_random_uuid(), 'insert')$$,
  '42501', null, 'authenticated no puede escribir directo en la bitácora');

-- Owner de Sonrisas: nota clínica y lectura de la bitácora.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
insert into public.clinical_notes (id, patient_id, body)
values ('a0000000-0000-0000-0000-0000000ad001', 'b0000000-0000-0000-0000-0000000ad001', 'Texto clínico privado');
update public.clinical_notes set body = 'Texto clínico corregido' where id = 'a0000000-0000-0000-0000-0000000ad001';

select results_eq(
  $$select table_name, action, actor_id, actor_role from public.audit_log
    where record_id = 'b0000000-0000-0000-0000-0000000ad001' order by id$$,
  $$values ('patients', 'insert', '22222222-2222-2222-2222-222222222222'::uuid, 'authenticated'),
           ('patients', 'update', '22222222-2222-2222-2222-222222222222'::uuid, 'authenticated')$$,
  'alta y cambio del paciente con quién lo hizo; el update sin cambios no se registra');
select is(
  (select changed_fields from public.audit_log
    where record_id = 'b0000000-0000-0000-0000-0000000ad001' and action = 'update'),
  array['phone'],
  'el update registra la columna cambiada (sin updated_at)');
select results_eq(
  $$select action from public.audit_log
    where record_id = 'd0000000-0000-0000-0000-0000000ad001' order by id$$,
  $$values ('insert'), ('delete')$$,
  'alta y borrado del pago');
select results_eq(
  $$select action, changed_fields from public.audit_log
    where table_name = 'clinical_notes' order by id$$,
  $$values ('insert', null::text[]), ('update', array['body'])$$,
  'nota clínica: alta y edición');
select is(
  (select count(*)::int from public.audit_log where clinic_id <> 'f0000000-0000-0000-0000-00000000000a'),
  0, 'el owner solo ve su consultorio');
select is(
  (select count(*)::int from public.audit_log a
    where to_jsonb(a)::text like '%Texto clínico%' or to_jsonb(a)::text like '%+52559876543%'),
  0, 'la bitácora no guarda valores (ni texto clínico ni teléfonos)');
select is(
  (select max(created_at) <= now() from public.audit_log), true,
  'cada registro tiene cuándo');

-- Solo inserción.
select throws_ok($$update public.audit_log set action = 'insert'$$, '42501', null,
  'authenticated no puede modificar la bitácora');
select throws_ok($$delete from public.audit_log$$, '42501', null,
  'authenticated no puede borrar la bitácora');

-- Owner de Dental Norte (B): no ve lo de A; su propio cambio sí.
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is((select count(*)::int from public.audit_log), 0, 'B no ve la bitácora de A');
update public.staff set full_name = 'Paola Garza Treviño'
where id = '44444444-4444-4444-4444-444444444444';
select results_eq(
  $$select table_name, action, changed_fields, actor_id from public.audit_log$$,
  $$values ('staff', 'update', array['full_name'], '33333333-3333-3333-3333-333333333333'::uuid)$$,
  'cambio de personal registrado en B');

-- Service role (webhook, Stripe, scripts): se registra sin actor; no puede
-- modificar ni borrar.
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into public.patients (id, clinic_id, full_name, phone)
values ('b0000000-0000-0000-0000-0000000ad002', 'f0000000-0000-0000-0000-00000000000b', 'Por webhook', '+525511223344');
select results_eq(
  $$select actor_id, actor_role, clinic_id from public.audit_log
    where record_id = 'b0000000-0000-0000-0000-0000000ad002'$$,
  $$values (null::uuid, 'service_role', 'f0000000-0000-0000-0000-00000000000b'::uuid)$$,
  'cambio de la service role: sin actor, con su rol');
select throws_ok($$update public.audit_log set action = 'insert'$$, '42501', null,
  'service_role no puede modificar la bitácora');
select throws_ok($$delete from public.audit_log$$, '42501', null,
  'service_role no puede borrar la bitácora');
select throws_ok($$truncate public.audit_log$$, '42501', null,
  'service_role no puede vaciar la bitácora');

-- Ni el dueño de la tabla: el trigger lo impide.
reset role;
select throws_ok($$update public.audit_log set action = 'insert'$$, 'P0001', null,
  'update rechazado por el trigger aun con privilegios');
select throws_ok($$delete from public.audit_log$$, 'P0001', null,
  'delete rechazado por el trigger aun con privilegios');
select throws_ok($$truncate public.audit_log$$, 'P0001', null,
  'truncate rechazado por el trigger aun con privilegios');

-- Anónimo: nada.
set local role anon;
select throws_ok($$select * from public.audit_log$$, '42501', null, 'anon no puede leer la bitácora');
reset role;

select is(
  (select count(*)::int from public.audit_log where table_name = 'staff' and action = 'insert'), 0,
  'sin altas de personal en esta prueba');
-- paciente (alta + cambio), pago (alta + borrado), nota (alta + edición),
-- personal (cambio) y paciente de la service role.
select is((select count(*)::int from public.audit_log), 8,
  'todos los cambios quedaron registrados, uno por cambio real');

select * from finish();
rollback;
