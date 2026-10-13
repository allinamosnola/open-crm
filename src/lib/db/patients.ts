'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

import { dbError, throwReadError, validationError } from './errors';
import { patientSchema, type PatientInput } from './schemas';
import type { ActionResult, Patient } from './types';

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

// Lista de pacientes del consultorio, con búsqueda opcional por nombre o teléfono.
// Los "por identificar" (sin nombre, llegaron por WhatsApp) van al final.
export async function listPatients(search?: string): Promise<Patient[]> {
  const supabase = await createClient();
  let query = supabase
    .from('patients')
    .select('*')
    .order('full_name', { nullsFirst: false })
    .limit(200);

  // Quitamos los caracteres con significado en la sintaxis de filtros de PostgREST.
  // Un teléfono de México con "+521" se busca como "+52" (así se guardan, ver
  // normalizePhone); también sirve con números incompletos.
  const cleaned = search?.replace(/[%,()*\\]/g, ' ').trim();
  const compact = cleaned?.replace(/[\s-]/g, '');
  const term = compact && /^\+521[0-9]*$/.test(compact) ? `+52${compact.slice(4)}` : cleaned;
  if (term) {
    query = query.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throwReadError(error, 'los pacientes');
  return data;
}

export async function getPatient(id: string): Promise<Patient | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('patients').select('*').eq('id', id).maybeSingle();
  if (error) throwReadError(error, 'el paciente');
  return data;
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

// createPatient y updatePatient guardan el teléfono normalizado (+521 -> +52):
// lo hace patientSchema con normalizePhone().
export async function createPatient(input: PatientInput): Promise<ActionResult<{ id: string }>> {
  const parsed = patientSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('patients')
    .insert(parsed.data)
    .select('id')
    .single();
  if (error) return dbError(error);

  revalidatePath('/pacientes');
  return { ok: true, data: { id: data.id } };
}

export async function updatePatient(
  id: string,
  input: PatientInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = patientSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('patients')
    // El formulario exige el nombre: un paciente "por identificar" pasa a activo al guardarlo.
    .update({ ...parsed.data, status: 'active' })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return { ok: false, error: 'El paciente no existe' };

  revalidatePath('/pacientes');
  revalidatePath(`/pacientes/${id}`);
  return { ok: true, data: { id } };
}
