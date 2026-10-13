# Fase 6 — Supabase Storage y PDF (recibo y presupuesto)

Fecha: 2026-10-13 12:38 · Rama: `feat/receipts-pdf` (sale de `feat/feature-flags`) · Plan de origen: [2026-10-12_1748_brecha-puesto-valsnapp.md](2026-10-12_1748_brecha-puesto-valsnapp.md) (Fase 6)

Decisión abierta 4 del plan de origen («¿recibo, presupuesto o ambos?»): se hicieron **ambos**,
tal como pedía la tarea; los dos van detrás del mismo flag `pdf_documents`, apagado por defecto.

## Qué se hizo

- Migración `20261101000002_receipts_storage.sql`:
  - Bucket **privado** `receipts` (5 MB, solo `application/pdf`).
  - Ruta `<clinic_id>/payments/<payment_id>.pdf` y `<clinic_id>/plans/<plan_id>.pdf`.
  - Políticas en `storage.objects` con `(storage.foldername(name))[1] = current_clinic_id()`:
    lectura para todo el personal del consultorio (todos leen pagos y planes); insert/update
    (generar o regenerar) con suscripción activa y solo en `payments/` o `plans/`; sin delete.
- `@react-pdf/renderer` (Next lo deja fuera del bundle por defecto, `serverExternalPackages`):
  - `src/lib/pdf/model.ts`: contenido puro de cada documento (es-MX, MXN, zona del consultorio);
    `documentToText` para los tests.
  - `src/lib/pdf/render.tsx`: dibujo en tamaño carta con Helvetica integrada (acentos y ñ).
  - `src/lib/pdf/documents.ts`: lee con la sesión (RLS), genera, sube con `upsert` y firma una URL
    de 60 s con nombre de descarga (`recibo-<folio>.pdf`, `presupuesto-<folio>.pdf`).
- Server actions: `getPaymentReceiptUrl(paymentId)` (src/lib/db/payments.ts) y
  `getPlanBudgetUrl(planId)` (src/lib/db/plans.ts). Con el flag apagado devuelven
  `PDF_DISABLED_ERROR` sin leer datos.
- El presupuesto usa el mismo criterio que `patient_balances`: los items cancelados no suman;
  muestra pagado y saldo.

## Decisiones tomadas en la implementación

- Se regenera el PDF en cada descarga (refleja los datos actuales); Storage guarda la última
  versión. Si se quisiera un recibo inmutable, habría que no sobrescribir y versionar la ruta.
- Pie de página: «No es un comprobante fiscal (CFDI)»; el presupuesto agrega «Precios sujetos a
  cambio tras la valoración clínica». Texto revisable por el usuario.
- Todo con la sesión del usuario (no la service role): la política de Storage es la que impide
  escribir o firmar en la carpeta de otro consultorio.

## Pendiente (carril frontend)

- Botones «Descargar recibo» (lista de pagos) y «Descargar presupuesto» (plan) en el perfil del
  paciente: llamar a la acción y abrir `data.url`. Mostrarlos solo si el flag está encendido
  (`isEnabledForSession(FLAGS.pdfDocuments, supabase)` en el Server Component).

## Verificación

- `tests/pdf/pdf.test.ts`: snapshot de texto del recibo y del presupuesto, render real a PDF
  (cabecera `%PDF-`, varias páginas con 40 items), ruta/bucket/URL firmada con Storage simulado,
  errores (pago inexistente, subida rechazada) y acciones con el flag apagado/encendido.
- `supabase/tests/receipts_storage.test.sql` (pgTAP, 17 aserciones): bucket privado, escritura y
  lectura por consultorio, recepción lee, otro consultorio no ve/modifica/borra, suscripción
  vencida solo lee, anon nada.
- Sin Docker: los pgTAP corrieron en PGlite con un stub mínimo de `storage` (buckets, objects,
  `foldername`); **no** se probó contra el servicio real de Storage (triggers internos, API de
  subida y firma). `npx next build` con variables ficticias: OK.
- `npx tsc --noEmit`, `npx eslint`, `npx vitest run` en verde.
