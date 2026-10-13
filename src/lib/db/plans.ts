'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

import { dbError, throwReadError, validationError } from './errors';
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
