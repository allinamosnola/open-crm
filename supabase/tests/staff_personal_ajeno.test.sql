-- npx supabase test db (requiere la seed: npx supabase db reset).
-- Un owner, con su sesión, no puede meter en su consultorio a personal de otra
-- cuenta ni cambiar el usuario de una fila de staff
-- (migración 20261001000004_staff_sin_personal_ajeno.sql).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

-- Sesión del owner de Sonrisas (cuenta A).
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$insert into public.staff (id, clinic_id, full_name, email, role, created_at)
    values ('33333333-3333-3333-3333-333333333333', 'f0000000-0000-0000-0000-00000000000a',
            'x', 'x@x', 'dentist', '2000-01-01')$$,
  '42501', 'Esa persona es personal de otra cuenta',
  'insert de personal de otra cuenta (owner de Dental Norte) se rechaza');

update public.staff set active = false where id = '22222222-2222-2222-2222-222222222222';
select throws_ok(
  $$update public.staff set id = '44444444-4444-4444-4444-444444444444'
    where id = '22222222-2222-2222-2222-222222222222'$$,
  '42501', 'No se puede cambiar el usuario de una fila de personal',
  'cambiar el id de una fila de staff se rechaza');

select lives_ok(
  $$update public.staff set active = true where id = '22222222-2222-2222-2222-222222222222'$$,
  'reactivar a su recepcionista sigue funcionando');

-- La service role (scripts) sí puede sumar al owner a otra sede de su cuenta.
reset role;
insert into public.clinics (id, account_id, name, slug, timezone)
values ('f0000000-0000-0000-0000-0000000000d1', 'ac000000-0000-0000-0000-00000000000a',
        'Sede D', 'sede-d', 'America/Mexico_City');
set local role service_role;
select lives_ok(
  $$insert into public.staff (id, clinic_id, full_name, email, role)
    values ('11111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-0000000000d1',
            'Dra', 'dentista@demo.local', 'owner')$$,
  'service role suma al owner a otra sede de su cuenta');

select * from finish();
rollback;
