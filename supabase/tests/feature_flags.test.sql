-- npx supabase test db (requiere la seed: npx supabase db reset).
-- Feature flags (migración 20261101000001_feature_flags.sql): apagados por
-- defecto, excepción por cuenta > valor global, la tabla solo para la service
-- role y my_feature_enabled() acotado a la cuenta del consultorio activo.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

select ok((select relrowsecurity from pg_class where oid = 'public.feature_flags'::regclass),
  'RLS activa en feature_flags');

-- Sin filas: apagado.
set local role service_role;
select is(public.feature_enabled('test_flag', 'ac000000-0000-0000-0000-00000000000a'), false,
  'sin filas el flag está apagado');

-- Encendido solo para la cuenta A (piloto).
insert into public.feature_flags (flag, account_id, enabled, note)
values ('test_flag', 'ac000000-0000-0000-0000-00000000000a', true, 'piloto');
select is(public.feature_enabled('test_flag', 'ac000000-0000-0000-0000-00000000000a'), true,
  'encendido para la cuenta piloto');
select is(public.feature_enabled('test_flag', 'ac000000-0000-0000-0000-00000000000b'), false,
  'otra cuenta sigue apagada');

-- Global encendido, con la cuenta B apagada a propósito.
insert into public.feature_flags (flag, account_id, enabled) values ('test_flag', null, true);
insert into public.feature_flags (flag, account_id, enabled)
values ('test_flag', 'ac000000-0000-0000-0000-00000000000b', false);
select is(public.feature_enabled('test_flag', 'ac000000-0000-0000-0000-00000000000c'), true,
  'el valor global aplica a las cuentas sin excepción');
select is(public.feature_enabled('test_flag', 'ac000000-0000-0000-0000-00000000000b'), false,
  'la excepción de la cuenta gana sobre el global');

select throws_ok(
  $$insert into public.feature_flags (flag, account_id, enabled) values ('test_flag', null, false)$$,
  '23505', null, 'un solo valor global por flag (nulls not distinct)');
-- Upsert como el de scripts/set-flag.ts (on conflict sobre flag + account_id).
select lives_ok(
  $$insert into public.feature_flags (flag, account_id, enabled) values ('test_flag', null, false)
    on conflict (flag, account_id) do update set enabled = excluded.enabled$$,
  'upsert del valor global');
select is(public.feature_enabled('test_flag', 'ac000000-0000-0000-0000-00000000000c'), false,
  'el upsert apagó el global');
update public.feature_flags set enabled = true where flag = 'test_flag' and account_id is null;
select throws_ok(
  $$insert into public.feature_flags (flag, enabled) values ('Mal-Nombre', true)$$,
  '23514', null, 'el nombre debe ir en snake_case');

-- Sesión del owner de Sonrisas (cuenta A).
reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.feature_flags$$, '42501', null,
  'authenticated no puede leer la tabla');
select throws_ok(
  $$insert into public.feature_flags (flag, enabled) values ('otro_flag', true)$$,
  '42501', null, 'authenticated no puede escribir en la tabla');
select throws_ok(
  $$select public.feature_enabled('test_flag', 'ac000000-0000-0000-0000-00000000000b')$$,
  '42501', null, 'authenticated no puede consultar flags de otra cuenta');
select is(public.my_feature_enabled('test_flag'), true, 'my_feature_enabled: cuenta A encendida');
select is(public.my_feature_enabled('flag_inexistente'), false, 'my_feature_enabled: flag desconocido apagado');

-- Sesión del owner de Dental Norte (cuenta B, apagada por excepción).
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is(public.my_feature_enabled('test_flag'), false, 'my_feature_enabled: cuenta B apagada');

-- Usuario sin membresía.
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
select is(public.my_feature_enabled('test_flag'), false, 'sin membresía activa: apagado');

-- Anónimo: sin acceso a la función.
reset role;
set local role anon;
select throws_ok($$select public.my_feature_enabled('test_flag')$$, '42501', null,
  'anon no puede ejecutar my_feature_enabled');

select * from finish();
rollback;
