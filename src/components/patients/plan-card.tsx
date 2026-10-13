import { LocalDateTime } from '@/components/local-date-time';
import { DocumentDownloadButton } from '@/components/patients/document-download-button';
import { ItemStatusBadge, PlanStatusBadge } from '@/components/status-badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PlanWithItems } from '@/lib/db/types';
import { formatCurrency } from '@/lib/format';

// Mismo cálculo que la vista patient_balances: los items cancelados no suman.
export function planTotal(plan: PlanWithItems) {
  return plan.items
    .filter((i) => i.status !== 'cancelled')
    .reduce((sum, i) => sum + Number(i.price), 0);
}

// Tarjeta de un plan de tratamiento en la ficha del paciente. Con `pdfEnabled`
// (feature flag pdf_documents, resuelto en el servidor) muestra el botón
// «Presupuesto».
export function PlanCard({ plan, pdfEnabled }: { plan: PlanWithItems; pdfEnabled: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {plan.title}
          <PlanStatusBadge status={plan.status} />
        </CardTitle>
        <CardDescription>
          {plan.dentist?.full_name ?? '—'} · creado <LocalDateTime value={plan.created_at} />
        </CardDescription>
        {pdfEnabled && (
          <CardAction>
            <DocumentDownloadButton
              kind="budget"
              id={plan.id}
              enabled={pdfEnabled}
              label={`Descargar presupuesto de ${plan.title}`}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tratamiento</TableHead>
              <TableHead>Diente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Precio</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.treatment?.name ?? '—'}</TableCell>
                <TableCell>{item.tooth ?? '—'}</TableCell>
                <TableCell>
                  <ItemStatusBadge status={item.status} />
                </TableCell>
                <TableCell
                  className={
                    item.status === 'cancelled'
                      ? 'text-right text-muted-foreground line-through'
                      : 'text-right'
                  }
                >
                  {formatCurrency(item.price)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>Total</TableCell>
              <TableCell className="text-right">{formatCurrency(planTotal(plan))}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
