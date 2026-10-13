import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { reportError } from '@/lib/observability';
import type { Database } from '@/types/database';

import { budgetModel, folioOf, receiptModel, type DocumentModel } from './model';
import { renderDocumentPdf } from './render';

// Genera el PDF, lo guarda en el bucket privado "receipts" y devuelve una URL
// firmada de vida corta. Todo con la sesión del usuario: la RLS de las tablas
// decide qué puede leer y la de storage.objects (migración 20261101000002) qué
// ruta puede escribir y firmar (<clinic_id>/...). Se regenera en cada descarga,
// así el documento refleja los datos actuales.
// El feature flag (pdf_documents) lo comprueban las server actions.

export const RECEIPTS_BUCKET = 'receipts';
// Vida de la URL firmada: suficiente para que el navegador inicie la descarga.
export const SIGNED_URL_SECONDS = 60;

type Client = SupabaseClient<Database>;
export type DocumentResult = { ok: true; url: string; path: string } | { ok: false; error: string };

export type DocumentKind = 'payments' | 'plans';

export function documentPath(clinicId: string, kind: DocumentKind, id: string): string {
  return `${clinicId}/${kind}/${id}.pdf`;
}

type Renderer = (model: DocumentModel) => Promise<Buffer>;

async function storeAndSign(
  supabase: Client,
  params: { path: string; pdf: Buffer; downloadName: string },
): Promise<DocumentResult> {
  const bucket = supabase.storage.from(RECEIPTS_BUCKET);
  const { error: uploadError } = await bucket.upload(params.path, params.pdf, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (uploadError) {
    reportError('No se pudo guardar el PDF:', uploadError, { where: 'pdf.upload' });
    return { ok: false, error: 'No se pudo guardar el documento' };
  }
  const { data, error } = await bucket.createSignedUrl(params.path, SIGNED_URL_SECONDS, {
    download: params.downloadName,
  });
  if (error || !data) {
    reportError('No se pudo firmar la URL del PDF:', error, { where: 'pdf.sign' });
    return { ok: false, error: 'No se pudo preparar la descarga' };
  }
  return { ok: true, url: data.signedUrl, path: params.path };
}

// Recibo de un pago.
export async function createPaymentReceipt(
  supabase: Client,
  paymentId: string,
  options: { now?: Date; render?: Renderer } = {},
): Promise<DocumentResult> {
  const { data: payment, error } = await supabase
    .from('payments')
    .select(
      'id, clinic_id, amount, method, paid_at, notes, receiver:staff(full_name), patient:patients(full_name), plan:treatment_plans(title), clinic:clinics(name, timezone)',
    )
    .eq('id', paymentId)
    .maybeSingle();
  if (error) {
    reportError('No se pudo leer el pago:', error, { where: 'pdf.receipt.read' });
    return { ok: false, error: 'No se pudo leer el pago' };
  }
  if (!payment || !payment.clinic || !payment.patient) return { ok: false, error: 'El pago no existe' };

  const model = receiptModel({
    clinic: payment.clinic,
    payment,
    patient: payment.patient,
    receiverName: payment.receiver?.full_name ?? null,
    planTitle: payment.plan?.title ?? null,
    issuedAt: options.now ?? new Date(),
  });
  const pdf = await (options.render ?? renderDocumentPdf)(model);
  return storeAndSign(supabase, {
    path: documentPath(payment.clinic_id, 'payments', payment.id),
    pdf,
    downloadName: `recibo-${folioOf(payment.id)}.pdf`,
  });
}

// Presupuesto de un plan de tratamiento (con lo pagado y el saldo).
export async function createPlanBudget(
  supabase: Client,
  planId: string,
  options: { now?: Date; render?: Renderer } = {},
): Promise<DocumentResult> {
  const { data: plan, error } = await supabase
    .from('treatment_plans')
    .select(
      'id, clinic_id, title, status, created_at, patient:patients(full_name), dentist:staff(full_name), clinic:clinics(name, timezone), items:treatment_plan_items(tooth, price, status, sort_order, treatment:treatments(name))',
    )
    .eq('id', planId)
    .order('sort_order', { referencedTable: 'treatment_plan_items' })
    .maybeSingle();
  if (error) {
    reportError('No se pudo leer el plan:', error, { where: 'pdf.budget.read' });
    return { ok: false, error: 'No se pudo leer el plan' };
  }
  if (!plan || !plan.clinic || !plan.patient) return { ok: false, error: 'El plan no existe' };

  const { data: balance, error: balanceError } = await supabase
    .from('patient_balances')
    .select('paid')
    .eq('plan_id', plan.id)
    .maybeSingle();
  if (balanceError) reportError('No se pudo leer el saldo del plan:', balanceError, { where: 'pdf.budget.balance' });

  const model = budgetModel({
    clinic: plan.clinic,
    plan,
    patient: plan.patient,
    dentistName: plan.dentist?.full_name ?? null,
    items: plan.items.map((item) => ({
      treatmentName: item.treatment?.name ?? 'Tratamiento',
      tooth: item.tooth,
      price: item.price,
      status: item.status,
    })),
    paid: balance?.paid ?? null,
    issuedAt: options.now ?? new Date(),
  });
  const pdf = await (options.render ?? renderDocumentPdf)(model);
  return storeAndSign(supabase, {
    path: documentPath(plan.clinic_id, 'plans', plan.id),
    pdf,
    downloadName: `presupuesto-${folioOf(plan.id)}.pdf`,
  });
}
