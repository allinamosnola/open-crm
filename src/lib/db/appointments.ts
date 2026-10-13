'use server';

import { revalidatePath } from 'next/cache';

import { isWithinBusinessHours } from '@/lib/bot/slots';
import { createClient } from '@/lib/supabase/server';

import { getClinicSettings } from './clinic';
import { dbError, throwReadError, validationError } from './errors';
import {
  appointmentSchema,
  appointmentUpdateSchema,
  type AppointmentInput,
  type AppointmentUpdateInput,
} from './schemas';
import type { ActionResult, AppointmentWithRelations } from './types';

// Hay dos FKs de appointments a staff (dentist_id, created_by), por eso el
// embed del dentista indica la FK explícitamente.
const APPOINTMENT_SELECT =
  '*, patient:patients(id, full_name, phone, status), dentist:staff!appointments_dentist_id_fkey(id, full_name)';

function revalidateAppointment(patientId?: string) {
  revalidatePath('/agenda');
  if (patientId) revalidatePath(`/pacientes/${patientId}`);
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

// Citas que se traslapan con [from, to) (fechas ISO); para la vista semanal.
export async function listAppointments(params: {
  from: string;
  to: string;
  dentistId?: string | null;
  includeCancelled?: boolean;
}): Promise<AppointmentWithRelations[]> {
  const supabase = await createClient();
  let query = supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .lt('starts_at', params.to)
    .gt('ends_at', params.from)
    .order('starts_at');
  if (params.dentistId) query = query.eq('dentist_id', params.dentistId);
  if (!params.includeCancelled) query = query.neq('status', 'cancelled');

  const { data, error } = await query;
  if (error) throwReadError(error, 'las citas');
  return data;
}

// Todas las citas de un paciente (pestaña Citas), más recientes primero.
export async function listPatientAppointments(
  patientId: string,
): Promise<AppointmentWithRelations[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .eq('patient_id', patientId)
    .order('starts_at', { ascending: false });
  if (error) throwReadError(error, 'las citas del paciente');
  return data;
}

const OUTSIDE_HOURS_ERROR = 'Ese horario está fuera del horario del consultorio';

// Mensaje de error si la cita no cabe en el horario del consultorio; null si cabe
// (o si el consultorio aún no configuró horario).
async function outsideBusinessHours(startsAt: string, endsAt: string): Promise<string | null> {
  const clinic = await getClinicSettings();
  if (!clinic) return null;
  const ok = isWithinBusinessHours(
    new Date(startsAt),
    new Date(endsAt),
    clinic.business_hours,
    clinic.timezone,
  );
  return ok ? null : OUTSIDE_HOURS_ERROR;
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

export async function createAppointment(
  input: AppointmentInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = appointmentSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  const outside = await outsideBusinessHours(parsed.data.starts_at, parsed.data.ends_at);
  if (outside) return { ok: false, error: outside };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('appointments')
    // created_by lo pone la base de datos (default auth.uid()).
    .insert({ ...parsed.data, source: 'panel' })
    .select('id')
    .single();
  if (error) return dbError(error); // 23P01 => "El dentista ya tiene una cita en ese horario"

  revalidateAppointment(parsed.data.patient_id);
  return { ok: true, data: { id: data.id } };
}

export async function updateAppointment(
  id: string,
  input: AppointmentUpdateInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = appointmentUpdateSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  // Solo si se cambia el horario: editar notas de una cita antigua no se bloquea.
  if (parsed.data.starts_at && parsed.data.ends_at) {
    const outside = await outsideBusinessHours(parsed.data.starts_at, parsed.data.ends_at);
    if (outside) return { ok: false, error: outside };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('appointments')
    .update(parsed.data)
    .eq('id', id)
    .select('id, patient_id')
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return { ok: false, error: 'La cita no existe' };

  revalidateAppointment(data.patient_id);
  return { ok: true, data: { id } };
}

// Cancelar no borra la cita: cambia su estado y libera el horario (la
// restricción de traslapes ignora las citas canceladas).
export async function cancelAppointment(id: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .select('id, patient_id')
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return { ok: false, error: 'La cita no existe' };

  revalidateAppointment(data.patient_id);
  return { ok: true, data: { id } };
}
