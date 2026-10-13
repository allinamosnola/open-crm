-- npx supabase test db (requiere la seed: npx supabase db reset).
-- accounts.stripe_checkout_session_id es única (migración 20261008000001): da
-- idempotencia al alta de cuentas desde el Checkout de la landing.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(3);

insert into public.accounts (name, plan, stripe_checkout_session_id)
values ('Cuenta de prueba', 'basic', 'cs_test_unica');

select throws_ok(
  $$insert into public.accounts (name, plan, stripe_checkout_session_id)
    values ('Otra cuenta', 'basic', 'cs_test_unica')$$,
  '23505', null,
  'una segunda cuenta para la misma sesión de Checkout se rechaza');

select lives_ok(
  $$insert into public.accounts (name, plan) values ('Alta manual 1', 'basic'), ('Alta manual 2', 'basic')$$,
  'las altas manuales (sin sesión) no chocan entre sí');

set local role authenticated;
select throws_ok(
  $$select stripe_checkout_session_id from public.accounts$$,
  '42501', null,
  'un usuario autenticado no puede leer la llave de Checkout');

select * from finish();
rollback;
