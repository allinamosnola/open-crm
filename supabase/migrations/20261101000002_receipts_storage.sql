-- Documentos en PDF (Fase 6 del plan de brecha 2026-10-12): recibo de pago y
-- presupuesto del plan de tratamiento, guardados en Supabase Storage.
--   * Bucket privado "receipts": nada es público; se descarga con URL firmada
--     de vida corta que crea el servidor con la sesión del usuario.
--   * Ruta: <clinic_id>/payments/<payment_id>.pdf y <clinic_id>/plans/<plan_id>.pdf.
--     La primera carpeta es el consultorio: las políticas comparan
--     (storage.foldername(name))[1] con current_clinic_id(), igual que la RLS
--     de las tablas (personal activo del consultorio activo).
--   * Lectura: todo el personal (pagos y planes ya los lee todo el personal).
--     Escritura (generar o regenerar): personal con suscripción activa, como el
--     resto de las escrituras. Sin delete: solo la service role borra.
--   * Detrás del feature flag pdf_documents (la app no genera nada si está
--     apagado); las políticas no dependen del flag.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "receipts: lectura mismo consultorio" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select public.current_clinic_id())::text
  );

create policy "receipts: insert mismo consultorio" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select public.current_clinic_id())::text
    and (storage.foldername(name))[2] in ('payments', 'plans')
    and (select public.clinic_is_active())
  );

-- upsert (regenerar el PDF) necesita update además de insert.
create policy "receipts: update mismo consultorio" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select public.current_clinic_id())::text
    and (select public.clinic_is_active())
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select public.current_clinic_id())::text
    and (storage.foldername(name))[2] in ('payments', 'plans')
    and (select public.clinic_is_active())
  );
