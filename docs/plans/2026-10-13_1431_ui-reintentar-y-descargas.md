# UI: «Reintentar» y descargas de PDF (carril frontend de las fases 4 y 6)

Fecha: 2026-10-13 14:31 (CDMX) · Rama: `feat/ui-retry-and-downloads` · Depende de
[fase 4](2026-10-13_1229_fase-4-reintentos.md) y [fase 6](2026-10-13_1238_fase-6-storage-y-pdf.md).

## Objetivo

Conectar a la interfaz dos capacidades del servidor que ya existían sin botón:

1. `retryFailedMessage(messageId)` (`src/lib/db/conversations.ts`): reenvío manual de un mensaje saliente fallido.
2. `getPaymentReceiptUrl(paymentId)` (`src/lib/db/payments.ts`) y `getPlanBudgetUrl(planId)`
   (`src/lib/db/plans.ts`): recibo y presupuesto en PDF con URL firmada, detrás del flag `pdf_documents`.

Sin cambios de esquema, RLS ni de `src/lib`.

## Diseño

### Reintentar (hilo de conversación)

- `conversation-thread.tsx`: componente `RetryButton` dentro de la burbuja, solo si
  `direction === 'out'` y `status === 'failed'` (bot o personal; la acción acepta ambos).
- `useTransition` como el resto del hilo: texto «Reintentando…», `aria-busy` y deshabilitado mientras corre.
- Al terminar (éxito o error) se recarga el hilo (`refetch`), porque el estado y el código de error del
  mensaje cambian; Realtime también lo actualiza. Éxito: toast «Mensaje reenviado». Error: toast con el
  mensaje de la acción (p. ej. ventana de 24 h, «El mensaje ya se está reenviando»); si la acción lanza,
  error genérico.
- Solo lectura (`useReadOnly`): deshabilitado con `READ_ONLY_HINT`, igual que «Enviar» y «Pausar bot».

### Recibo y Presupuesto (ficha del paciente)

- El flag se resuelve en el Server Component `pacientes/[id]/page.tsx` con
  `isEnabledForSession(FLAGS.pdfDocuments, supabase)` en el mismo `Promise.all` de las lecturas y se pasa
  por props (`pdfEnabled`). Apagado: no hay botón ni columna.
- Para poder probarlos, la tabla de pagos y la tarjeta del plan salen de la página a
  `src/components/patients/payments-table.tsx` y `plan-card.tsx` (Server-compatibles, sin `'use client'`).
  `planTotal` se mueve a `plan-card.tsx`.
- `document-download-button.tsx` (cliente): `kind` = `receipt` | `budget`, llama a la acción y descarga
  la URL con un enlace temporal (la URL firmada trae `download`, es decir `Content-Disposition: attachment`;
  `window.open` tras un `await` lo bloquearía el navegador). Texto visible «Recibo» / «Presupuesto», nombre
  accesible con el monto o el título del plan, «Generando…» mientras corre.
- Errores: el de la acción (flag apagado: `PDF_DISABLED_ERROR`; fallo de generación o de Storage) va a un
  toast; si la acción lanza, error genérico.
- Solo lectura: deshabilitado. Generar el PDF sube el archivo a Storage y las políticas de `receipts`
  exigen `clinic_is_active()`, así que con la suscripción inactiva fallaría siempre.

## Pruebas (tests/components)

- `conversation-thread.test.tsx`: +7 casos (botón solo en salientes `failed`, llamada con el id y
  recarga, pendiente sin doble envío, error de la acción, excepción, solo lectura).
- `document-downloads.test.tsx` (nuevo, 12 casos): flag apagado oculta botones y columna; un «Recibo»
  por pago; llamada y descarga de recibo y presupuesto; pendiente; error con flag apagado en servidor;
  excepción; solo lectura.

## Verificación

`npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (298/298) y `npm run build` con variables de
Supabase ficticias: OK. No probado en el navegador ni contra Supabase/Storage/Twilio reales.

## Pendiente

- Prueba manual en el navegador con el flag encendido para una cuenta (`npm run flag:set`) y un mensaje
  fallido real o sembrado.
- Decisión de producto abierta (no tomada aquí): ¿permitir descargar un recibo ya generado en solo lectura?
  Requeriría una acción de solo lectura que firme el PDF existente sin regenerarlo (cambio en `src/lib`).
