'use client';

import { FileDownIcon } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { READ_ONLY_HINT, useReadOnly } from '@/components/layout/read-only';
import { Button } from '@/components/ui/button';
import { getPaymentReceiptUrl } from '@/lib/db/payments';
import { getPlanBudgetUrl } from '@/lib/db/plans';

const DOCUMENTS = {
  receipt: { label: 'Recibo', action: getPaymentReceiptUrl, success: 'Recibo generado' },
  budget: { label: 'Presupuesto', action: getPlanBudgetUrl, success: 'Presupuesto generado' },
} as const;

// La URL firmada trae Content-Disposition: attachment (opción download de
// Storage), así que abrirla descarga el PDF sin salir del panel. Se usa un
// enlace temporal en lugar de window.open: tras el await el navegador
// bloquearía la ventana emergente.
function startDownload(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Botón para descargar el recibo de un pago o el presupuesto de un plan en PDF.
// El feature flag pdf_documents se resuelve en el servidor y llega en `enabled`:
// apagado, el botón no se muestra (la server action también lo rechaza).
// Generar el PDF lo guarda en Storage, una escritura que la RLS rechaza con la
// suscripción inactiva; por eso en solo lectura queda deshabilitado.
export function DocumentDownloadButton({
  kind,
  id,
  enabled,
  label,
}: {
  kind: keyof typeof DOCUMENTS;
  // Id del pago (recibo) o del plan (presupuesto).
  id: string;
  enabled: boolean;
  // Nombre accesible; debe incluir el texto visible («Recibo» / «Presupuesto»).
  label: string;
}) {
  const readOnly = useReadOnly();
  const [pending, startTransition] = useTransition();
  if (!enabled) return null;

  const doc = DOCUMENTS[kind];

  function download() {
    startTransition(async () => {
      try {
        const result = await doc.action(id);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        startDownload(result.data.url);
        toast.success(doc.success);
      } catch {
        toast.error('No se pudo generar el documento. Intenta de nuevo.');
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={download}
      disabled={pending || readOnly}
      aria-label={label}
      title={readOnly ? READ_ONLY_HINT : undefined}
      aria-busy={pending || undefined}
    >
      <FileDownIcon aria-hidden />
      {pending ? 'Generando…' : doc.label}
    </Button>
  );
}
