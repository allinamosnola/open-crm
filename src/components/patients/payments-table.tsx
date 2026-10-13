import { LocalDateTime } from '@/components/local-date-time';
import { DocumentDownloadButton } from '@/components/patients/document-download-button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PaymentWithReceiver } from '@/lib/db/types';
import { formatCurrency, PAYMENT_METHOD_LABEL } from '@/lib/format';

// Tabla de pagos de la ficha del paciente. Con `pdfEnabled` (feature flag
// pdf_documents, resuelto en el servidor) agrega la columna con el botón
// «Recibo» de cada pago.
export function PaymentsTable({
  payments,
  planTitle,
  pdfEnabled,
}: {
  payments: PaymentWithReceiver[];
  planTitle: Map<string, string>;
  pdfEnabled: boolean;
}) {
  const columns = pdfEnabled ? 7 : 6;
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead className="text-right">Monto</TableHead>
            <TableHead>Método</TableHead>
            <TableHead className="hidden md:table-cell">Plan</TableHead>
            <TableHead className="hidden lg:table-cell">Recibió</TableHead>
            <TableHead className="hidden lg:table-cell">Notas</TableHead>
            {pdfEnabled && (
              <TableHead className="text-right">
                <span className="sr-only">Documento</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns} className="py-8 text-center text-muted-foreground">
                Sin pagos registrados.
              </TableCell>
            </TableRow>
          ) : (
            payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <LocalDateTime value={p.paid_at} />
                </TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(p.amount)}</TableCell>
                <TableCell>{PAYMENT_METHOD_LABEL[p.method]}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {p.plan_id ? (planTitle.get(p.plan_id) ?? '—') : 'Sin plan'}
                </TableCell>
                <TableCell className="hidden lg:table-cell">{p.receiver?.full_name ?? '—'}</TableCell>
                <TableCell className="hidden max-w-xs truncate lg:table-cell">
                  {p.notes ?? '—'}
                </TableCell>
                {pdfEnabled && (
                  <TableCell className="text-right">
                    <DocumentDownloadButton
                      kind="receipt"
                      id={p.id}
                      enabled={pdfEnabled}
                      label={`Descargar recibo del pago de ${formatCurrency(p.amount)}`}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
