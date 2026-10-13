-- npx supabase test db (requiere la seed: npx supabase db reset).
-- Bucket privado "receipts" (migración 20261101000002_receipts_storage.sql):
-- cada consultorio solo lee y escribe bajo <su clinic_id>/payments|plans/, la
-- escritura exige suscripción activa y nadie fuera del personal ve nada.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'receipts'$$,
  $$values (false, 5242880::bigint, array['application/pdf'])$$,
  'bucket receipts privado, 5 MB, solo PDF');

-- Owner de Sonrisas (consultorio A).
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('receipts', 'f0000000-0000-0000-0000-00000000000a/payments/pago-1.pdf')$$,
  'A guarda un recibo en su carpeta');
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('receipts', 'f0000000-0000-0000-0000-00000000000a/plans/plan-1.pdf')$$,
  'A guarda un presupuesto en su carpeta');
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('receipts', 'f0000000-0000-0000-0000-00000000000b/payments/pago-x.pdf')$$,
  '42501', null, 'A no puede escribir en la carpeta de B');
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('receipts', 'f0000000-0000-0000-0000-00000000000a/otros/x.pdf')$$,
  '42501', null, 'solo las subcarpetas payments y plans');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('receipts', 'pago-suelto.pdf')$$,
  '42501', null, 'un archivo sin carpeta de consultorio se rechaza');
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 2,
  'A ve sus dos documentos');
select lives_ok(
  $$update storage.objects set metadata = '{"regenerado": true}'
    where bucket_id = 'receipts' and name = 'f0000000-0000-0000-0000-00000000000a/payments/pago-1.pdf'$$,
  'A puede regenerar (upsert) su recibo');
select throws_ok(
  $$update storage.objects set name = 'f0000000-0000-0000-0000-00000000000b/payments/pago-1.pdf'
    where bucket_id = 'receipts' and name = 'f0000000-0000-0000-0000-00000000000a/payments/pago-1.pdf'$$,
  '42501', null, 'A no puede mover su recibo a la carpeta de B');

-- Recepción de Sonrisas: también lee (todo el personal ve pagos y planes).
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 2,
  'la recepción de A ve los documentos de A');

-- Owner de Dental Norte (consultorio B): no ve ni toca lo de A.
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 0,
  'B no ve los documentos de A');
update storage.objects set metadata = '{"hackeado": true}' where bucket_id = 'receipts';
-- Storage bloquea cualquier DELETE directo con un trigger; lo que se comprueba es que
-- no exista ninguna política de borrado para este bucket.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd in ('DELETE', 'ALL')
      and (qual ilike '%receipts%' or with_check ilike '%receipts%')),
  0, 'no hay políticas de borrado sobre receipts');
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('receipts', 'f0000000-0000-0000-0000-00000000000b/payments/pago-b.pdf')$$,
  'B guarda en su propia carpeta');

-- Con la suscripción de B vencida, B ya no puede generar documentos (solo leer).
reset role;
update public.clinics set subscription_status = 'past_due' where id = 'f0000000-0000-0000-0000-00000000000b';
set local role authenticated;
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('receipts', 'f0000000-0000-0000-0000-00000000000b/plans/plan-b.pdf')$$,
  '42501', null, 'B con suscripción vencida no puede escribir');
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 1,
  'B con suscripción vencida sigue leyendo lo suyo');

-- Anónimo: nada.
reset role;
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 0,
  'anon no ve documentos');

-- Lo que intentó B sobre A no tuvo efecto.
reset role;
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'receipts' and name like 'f0000000-0000-0000-0000-00000000000a/%'),
  2, 'B no pudo borrar los documentos de A');
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'receipts' and metadata ? 'hackeado'),
  0, 'B no pudo modificar los documentos de A');

select * from finish();
rollback;
