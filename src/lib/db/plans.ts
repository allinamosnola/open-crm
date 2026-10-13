'use server';

import { revalidatePath } from 'next/cache';

import { FLAGS, isEnabledForSession } from '@/lib/flags';
import { createPlanBudget } from '@/lib/pdf/documents';
import { createClient } from '@/lib/supabase/server';

import { dbError, PDF_DISABLED_ERROR, throwReadError, validationError } from './errors';
import { planSchema, type PlanInput } from './schemas';
import type { ActionResult, PlanWithItems, Treatment } from './types';

// ---------------------------------------------------------------------------
// Lecturas (todo el personal activo puede leer; solo el dentista escribe)
// ---------------------------------------------------------------------------

// Catálogo de tratamientos activos.
export async function listTreatments(): Promise<Treatment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('treatments')
    .select('*')
    .eq('active', true)
    .order('name');
  if (error) throwReadError(error, 'el catálogo de tratamientos');
  return data;
}

// Planes del paciente con sus items (ordenados) y el dentista responsable.
export async function listPatientPlans(patientId: string): Promise<PlanWithItems[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('treatment_plans')
    .select(
      '*, dentist:staff(id, full_name), items:treatment_plan_items(*, treatment:treatments(id, name))',
    )
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .order('sort_order', { referencedTable: 'treatment_plan_items' });
  if (error) throwReadError(error, 'los planes del paciente');
  return data;
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

// Crea el plan y sus items. Si fallan los items se borra el plan para no dejarlo
// a medias (PostgREST no ofrece transacciones entre dos inserts).
export async function createPlan(input: PlanInput): Promise<ActionResult<{ id: string }>> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { items, ...plan } = parsed.data;

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from('treatment_plans')
    .insert(plan)
    .select('id')
    .single();
  if (error) return dbError(error);

  const { error: itemsError } = await supabase.from('treatment_plan_items').insert(
    items.map((item, index) => ({
      ...item,
      plan_id: created.id,
      sort_order: item.sort_order ?? index + 1,
    })),
  );
  if (itemsError) {
    await supabase.from('treatment_plans').delete().eq('id', created.id);
    return dbError(itemsError);
  }

  revalidatePath(`/pacientes/${plan.patient_id}`);
  return { ok: true, data: { id: created.id } };
}

// Presupuesto del plan en PDF (items, total, pagado y saldo): lo genera, lo
// guarda en Storage y devuelve una URL firmada de 60 s. Lo puede descargar todo
// el personal (todos leen los planes). Detrás del feature flag pdf_documents.
export async function getPlanBudgetUrl(planId: string): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  if (!(await isEnabledForSession(FLAGS.pdfDocuments, supabase))) {
    return { ok: false, error: PDF_DISABLED_ERROR };
  }
  const result = await createPlanBudget(supabase, planId);
  if (!result.ok) return result;
  return { ok: true, data: { url: result.url } };
}
