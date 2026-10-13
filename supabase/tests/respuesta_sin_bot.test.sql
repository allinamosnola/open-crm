-- npx supabase test db (requiere la seed: npx supabase db reset).
-- Límite de la respuesta fija a pacientes de consultorios sin bot
-- (migración 20261001000005_respuesta_sin_bot.sql): solo la service role usa
-- la tabla y la función; una respuesta por (consultorio, número) cada 24 h.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

-- Sesión de un usuario (owner de Sonrisas, cuenta A): sin acceso.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.whatsapp_disabled_replies$$, '42501', null,
  'authenticated no puede leer la tabla');
select throws_ok(
  $$insert into public.whatsapp_disabled_replies (clinic_id, phone)
    values ('f0000000-0000-0000-0000-00000000000a', '+525500000000')$$,
  '42501', null, 'authenticated no puede escribir en la tabla');
select throws_ok(
  $$select public.whatsapp_claim_disabled_reply('f0000000-0000-0000-0000-00000000000a', '+5215500000000')$$,
  '42501', null, 'authenticated no puede ejecutar la función');

-- Anónimo: tampoco.
reset role;
set local role anon;
select throws_ok($$select * from public.whatsapp_disabled_replies$$, '42501', null,
  'anon no puede leer la tabla');
select throws_ok(
  $$select public.whatsapp_claim_disabled_reply('f0000000-0000-0000-0000-00000000000a', '+5215500000000')$$,
  '42501', null, 'anon no puede ejecutar la función');

-- Service role (webhook).
reset role;
set local role service_role;
select is(public.whatsapp_claim_disabled_reply('f0000000-0000-0000-0000-00000000000a', '+5215500000000'),
  true, 'primera respuesta al número: se reserva');
select is(public.whatsapp_claim_disabled_reply('f0000000-0000-0000-0000-00000000000a', '+5215500000000'),
  false, 'segunda en 24 h: no');
select is(public.whatsapp_claim_disabled_reply('f0000000-0000-0000-0000-00000000000a', '+525500000000'),
  false, '+52 y +521 son el mismo número');
select is(public.whatsapp_claim_disabled_reply('f0000000-0000-0000-0000-00000000000a', '+5215511110000'),
  true, 'otro número sí');
select results_eq(
  $$select phone from public.whatsapp_disabled_replies
    where clinic_id = 'f0000000-0000-0000-0000-00000000000a' order by phone$$,
  $$values ('+525500000000'::text), ('+525511110000'::text)$$,
  'se guarda el teléfono normalizado (sin contenido de mensajes)');

-- Pasadas las 24 h se vuelve a responder.
update public.whatsapp_disabled_replies set last_replied_at = now() - interval '24 hours 1 second'
where phone = '+525500000000';
select is(public.whatsapp_claim_disabled_reply('f0000000-0000-0000-0000-00000000000a', '+5215500000000'),
  true, 'pasadas 24 h: se vuelve a reservar');
select is(public.whatsapp_claim_disabled_reply('f0000000-0000-0000-0000-00000000000a', '+5215500000000'),
  false, 'y se vuelve a bloquear');

-- Liberar el turno (el envío falló): se puede volver a reservar de inmediato.
select lives_ok(
  $$select public.whatsapp_release_disabled_reply('f0000000-0000-0000-0000-00000000000a', '+5215500000000')$$,
  'liberar el turno no falla');
select is(public.whatsapp_claim_disabled_reply('f0000000-0000-0000-0000-00000000000a', '+5215500000000'),
  true, 'tras liberar, el número se puede volver a reservar');

-- RLS activa (sin políticas): la sesión no ve filas aunque tuviera permiso.
reset role;
select ok((select relrowsecurity from pg_class where oid = 'public.whatsapp_disabled_replies'::regclass),
  'RLS activa en whatsapp_disabled_replies');

select * from finish();
rollback;
