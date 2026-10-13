'use server';

import { revalidatePath } from 'next/cache';

import { FLAGS, isEnabledForSession } from '@/lib/flags';
import { createPaymentReceipt } from '@/lib/pdf/documents';
import { createClient } from '@/lib/supabase/server';

import { dbError, PDF_DISABLED_ERROR, throwReadError, validationError } from './errors';
import { paymentSchema, type PaymentInput } from './schemas';
import type { ActionResult, PatientBalance, PaymentWithReceiver } from './types';

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export async function listPatientPayments(patientId: string): Promise<PaymentWithReceiver[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('payments')
    .select('*, receiver:staff(id, full_name)')
    .eq('patient_id', patientId)
    .order('paid_at', { ascending: false });
  if (error) throwReadError(error, 'los pagos del paciente');
  return data;
}

// Saldo por plan del paciente (vista patient_balances). La fila con plan_id null
// agrupa los pagos sin plan (balance negativo = saldo a favor).
export async function getPatientBalances(patientId: string): Promise<PatientBalance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('patient_balances')
    .select('*')
    .eq('patient_id', patientId);
  if (error) throwReadError(error, 'el saldo del paciente');
  return data;
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

export async function createPayment(input: PaymentInput): Promise<ActionResult<{ id: string }>> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { paid_at, ...payment } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('payments')
    // received_by lo pone la base de datos (default auth.uid()); paid_at, now() si no viene.
    .insert({ ...payment, ...(paid_at ? { paid_at } : {}) })
    .select('id')
    .single();
  if (error) return dbError(error);

  revalidatePath(`/pacientes/${payment.patient_id}`);
  return { ok: true, data: { id: data.id } };
}

// Recibo del pago en PDF: lo genera, lo guarda en Storage (bucket privado
// receipts) y devuelve una URL firmada de 60 s para descargarlo. Detrás del
// feature flag pdf_documents (apagado por defecto; se enciende por cuenta).
export async function getPaymentReceiptUrl(paymentId: string): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  if (!(await isEnabledForSession(FLAGS.pdfDocuments, supabase))) {
    return { ok: false, error: PDF_DISABLED_ERROR };
  }
  const result = await createPaymentReceipt(supabase, paymentId);
  if (!result.ok) return result;
  return { ok: true, data: { url: result.url } };
}
