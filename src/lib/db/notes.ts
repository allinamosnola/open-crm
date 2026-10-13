'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

import { dbError, throwReadError, validationError } from './errors';
import { clinicalNoteSchema, type ClinicalNoteInput } from './schemas';
import type { ActionResult, ClinicalNoteWithAuthor } from './types';

// Notas clínicas: RLS solo las deja ver/escribir al dentista. Para la recepción
// la lectura devuelve [] y la escritura falla con permiso denegado.

export async function listPatientNotes(patientId: string): Promise<ClinicalNoteWithAuthor[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clinical_notes')
    .select('*, author:staff(id, full_name)')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  if (error) throwReadError(error, 'las notas clínicas');
  return data;
}

export async function createClinicalNote(
  input: ClinicalNoteInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = clinicalNoteSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clinical_notes')
    // author_id lo pone la base de datos (default auth.uid()).
    .insert(parsed.data)
    .select('id')
    .single();
  if (error) return dbError(error);

  revalidatePath(`/pacientes/${parsed.data.patient_id}`);
  return { ok: true, data: { id: data.id } };
}
