'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

import { throwReadError, validationError } from './errors';
import { clinicIdSchema, passwordSchema, type PasswordInput } from './schemas';
import type { ActionResult, Entitlements, MyClinic } from './types';
import { reportError } from '@/lib/observability';

// Define la contraseña del usuario de la sesión. La usa /auth/aceptar-invitacion:
// /auth/confirm ya abrió la sesión con el enlace de la invitación.
export async function updatePassword(input: PasswordInput): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'El enlace expiró. Pide una nueva invitación.' };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    reportError('Error al definir la contraseña:', error, { where: 'account.updatePassword' });
    return { ok: false, error: 'No se pudo guardar la contraseña. Intenta de nuevo.' };
  }
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Cuenta, plan y consultorio activo. Todo con la sesión del usuario: las
// funciones SQL my_clinics() y my_entitlements() son security definer acotadas
// a auth.uid() (no se usa el cliente admin).
// ---------------------------------------------------------------------------

// Consultorios donde el usuario es personal activo; is_active marca el activo.
// Vacío sin sesión o sin membresías activas.
export async function listMyClinics(): Promise<MyClinic[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_clinics');
  if (error) throwReadError(error, 'tus consultorios');
  return data;
}

// Plan, topes y uso de la cuenta del consultorio activo (lo puede leer todo el
// personal activo). null sin sesión o sin membresía activa.
export async function getEntitlements(): Promise<Entitlements | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_entitlements');
  if (error) throwReadError(error, 'el plan del consultorio');
  return data[0] ?? null;
}

// Cambia el consultorio activo del usuario (se guarda en la base, por usuario:
// todas sus pestañas pasan al nuevo consultorio). La política de
// user_active_clinic solo deja elegir un consultorio donde es personal activo;
// cualquier otro id falla con 42501 y no cambia nada.
export async function switchClinic(clinicId: string): Promise<ActionResult<{ id: string }>> {
  const parsed = clinicIdSchema.safeParse(clinicId);
  if (!parsed.success) return { ok: false, error: 'Consultorio inválido' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };

  const { error } = await supabase
    .from('user_active_clinic')
    .upsert({ user_id: user.id, clinic_id: parsed.data }, { onConflict: 'user_id' });
  if (error) {
    // 42501: RLS (no es personal activo de ese consultorio). 23503: no existe la membresía.
    if (error.code === '42501' || error.code === '23503') {
      return { ok: false, error: 'No tienes acceso a ese consultorio' };
    }
    reportError('Error al cambiar de consultorio:', error, { where: 'account.switchClinic' });
    return { ok: false, error: 'No se pudo cambiar de consultorio. Intenta de nuevo.' };
  }

  // Todo el panel depende del consultorio activo: se invalida desde la raíz.
  revalidatePath('/', 'layout');
  return { ok: true, data: { id: parsed.data } };
}
