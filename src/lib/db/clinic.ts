'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

import { dbError, throwReadError, validationError } from './errors';
import { clinicSettingsSchema, type ClinicSettingsInput } from './schemas';
import { getCurrentStaff } from './staff';
import {
  isSubscriptionActive,
  parseBusinessHours,
  type ActionResult,
  type ClinicSettings,
} from './types';

// Configuración del consultorio que usa el bot (/configuracion/consultorio):
// horario por día, duración de cita por defecto, correo de la recepción y zona
// horaria. Todo el personal la lee (RLS de clinics); solo el owner la edita
// (privilegio por columna + política "clinics: update owner").

// Configuración del consultorio de la sesión, o null si no hay sesión.
export async function getClinicSettings(): Promise<ClinicSettings | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clinics')
    .select('id, name, timezone, business_hours, default_appointment_minutes, reception_email')
    .maybeSingle();
  if (error) throwReadError(error, 'la configuración del consultorio');
  if (!data) return null;
  return { ...data, business_hours: parseBusinessHours(data.business_hours) };
}

export async function updateClinicSettings(
  input: ClinicSettingsInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = clinicSettingsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  // La RLS ya lo impide; se comprueba antes para dar un mensaje claro.
  const me = await getCurrentStaff();
  if (!me || me.role !== 'owner') {
    return { ok: false, error: 'Solo el dueño del consultorio puede cambiar esta configuración' };
  }
  if (!isSubscriptionActive(me.clinic.subscription_status)) {
    return {
      ok: false,
      error: 'La suscripción del consultorio no está activa: el panel está en solo lectura',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clinics')
    .update(parsed.data)
    .eq('id', me.clinic.id)
    .select('id')
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return { ok: false, error: 'No tienes permiso para realizar esta acción' };

  revalidatePath('/configuracion/consultorio');
  return { ok: true, data: { id: data.id } };
}
