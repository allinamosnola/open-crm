// Contenido de los documentos en PDF (recibo de pago y presupuesto del plan de
// tratamiento), separado del dibujo: estas funciones son puras y devuelven el
// texto ya formateado (es-MX, MXN, zona horaria del consultorio). render.tsx lo
// dibuja con @react-pdf/renderer y los tests comparan el texto (documentToText).

import { formatCurrency, ITEM_STATUS_LABEL, LOCALE, PAYMENT_METHOD_LABEL, PLAN_STATUS_LABEL, patientName } from '@/lib/format';
import type { Enums } from '@/types/database';

export interface DocumentModel {
  title: string;
  clinicName: string;
  // Folio corto (primeros 8 caracteres del id) para citarlo por teléfono.
  folio: string;
  issuedAt: string;
  fields: { label: string; value: string }[];
  table: { columns: string[]; rows: string[][] } | null;
  totals: { label: string; value: string }[];
  notes: string[];
  footer: string;
}

export interface ClinicInfo {
  name: string;
  timezone: string;
}

export interface ReceiptInput {
  clinic: ClinicInfo;
  payment: {
    id: string;
    amount: number | string;
    method: Enums<'payment_method'>;
    paid_at: string;
    notes: string | null;
  };
  patient: { full_name: string | null };
  receiverName: string | null;
  planTitle: string | null;
  issuedAt: Date;
}

export interface BudgetInput {
  clinic: ClinicInfo;
  plan: {
    id: string;
    title: string;
    status: Enums<'plan_status'>;
    created_at: string;
  };
  patient: { full_name: string | null };
  dentistName: string | null;
  items: {
    treatmentName: string;
    tooth: string | null;
    price: number | string;
    status: Enums<'item_status'>;
  }[];
  // Pagado al plan (vista patient_balances); null si no se conoce.
  paid: number | string | null;
  issuedAt: Date;
}

export function folioOf(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

function formatInZone(value: string | Date, timezone: string): string {
  return new Date(value).toLocaleString(LOCALE, {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateInZone(value: string | Date, timezone: string): string {
  return new Date(value).toLocaleDateString(LOCALE, {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const FOOTER = 'Documento generado por CitaBot Dental. No es un comprobante fiscal (CFDI).';

export function receiptModel(input: ReceiptInput): DocumentModel {
  const { clinic, payment } = input;
  return {
    title: 'Recibo de pago',
    clinicName: clinic.name,
    folio: folioOf(payment.id),
    issuedAt: formatInZone(input.issuedAt, clinic.timezone),
    fields: [
      { label: 'Paciente', value: patientName(input.patient) },
      { label: 'Fecha de pago', value: formatInZone(payment.paid_at, clinic.timezone) },
      { label: 'Método', value: PAYMENT_METHOD_LABEL[payment.method] },
      ...(input.planTitle ? [{ label: 'Plan de tratamiento', value: input.planTitle }] : []),
      ...(input.receiverName ? [{ label: 'Recibió', value: input.receiverName }] : []),
    ],
    table: null,
    totals: [{ label: 'Importe recibido', value: formatCurrency(payment.amount) }],
    notes: payment.notes?.trim() ? [payment.notes.trim()] : [],
    footer: FOOTER,
  };
}

export function budgetModel(input: BudgetInput): DocumentModel {
  const { clinic, plan } = input;
  // Mismo criterio que patient_balances: los items cancelados no suman.
  const total = input.items
    .filter((item) => item.status !== 'cancelled')
    .reduce((sum, item) => sum + Number(item.price), 0);
  const paid = input.paid == null ? null : Number(input.paid);
  return {
    title: 'Presupuesto de tratamiento',
    clinicName: clinic.name,
    folio: folioOf(plan.id),
    issuedAt: formatInZone(input.issuedAt, clinic.timezone),
    fields: [
      { label: 'Paciente', value: patientName(input.patient) },
      { label: 'Plan', value: plan.title },
      { label: 'Estado', value: PLAN_STATUS_LABEL[plan.status] },
      ...(input.dentistName ? [{ label: 'Dentista', value: input.dentistName }] : []),
      { label: 'Fecha del plan', value: formatDateInZone(plan.created_at, clinic.timezone) },
    ],
    table: {
      columns: ['Tratamiento', 'Pieza', 'Estado', 'Precio'],
      rows: input.items.map((item) => [
        item.treatmentName,
        item.tooth ?? '—',
        ITEM_STATUS_LABEL[item.status],
        formatCurrency(item.price),
      ]),
    },
    totals: [
      { label: 'Total', value: formatCurrency(total) },
      ...(paid != null
        ? [
            { label: 'Pagado', value: formatCurrency(paid) },
            { label: 'Saldo', value: formatCurrency(total - paid) },
          ]
        : []),
    ],
    notes: input.items.some((item) => item.status === 'cancelled')
      ? ['Los tratamientos cancelados no suman al total.']
      : [],
    footer: `${FOOTER} Precios sujetos a cambio tras la valoración clínica.`,
  };
}

// Texto plano del documento, en el orden en que se dibuja (tests y depuración).
export function documentToText(model: DocumentModel): string {
  const lines = [
    model.clinicName,
    model.title,
    `Folio: ${model.folio}`,
    `Emitido: ${model.issuedAt}`,
    '',
    ...model.fields.map((f) => `${f.label}: ${f.value}`),
  ];
  if (model.table) {
    lines.push('', model.table.columns.join(' | '), ...model.table.rows.map((row) => row.join(' | ')));
  }
  lines.push('', ...model.totals.map((t) => `${t.label}: ${t.value}`));
  if (model.notes.length) lines.push('', ...model.notes);
  lines.push('', model.footer);
  return lines.join('\n');
}
