'use server';

import type { PostgrestError } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { getEntitlements } from './account';
import { dbError, throwReadError, validationError } from './errors';
import { planLimitError, planLimitMessage, type PlanInfo } from './plan-limits';
import { staffInviteSchema, type StaffInviteInput } from './schemas';
import {
  actsAsDentist,
  isSubscriptionActive,
  type ActionResult,
  type CurrentStaff,
  type Staff,
} from './types';
import { reportError } from '@/lib/observability';

const SUBSCRIPTION_INACTIVE =
  'La suscripción del consultorio no está activa: el panel está en solo lectura';

// Personal que tiene la sesión actual, con su membresía del consultorio activo
// y el plan de la cuenta de ese consultorio; null si no hay sesión o la cuenta
// no es personal activo (en ese caso RLS no le deja ver nada).
// Un usuario puede ser personal de varios consultorios: el activo lo resuelve
// la base (user_active_clinic -> current_clinic_id()) y llega en
// my_entitlements().clinic_id. Se elige la fila de ese consultorio en lugar de
// suponer que hay una sola (la RLS de staff ya filtra al activo, pero no se
// depende de eso).
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [memberships, entitlements] = await Promise.all([
    supabase
      .from('staff')
      .select('id, full_name, role, clinic:clinics(id, name, subscription_status)')
      .eq('id', user.id)
      .eq('active', true),
    supabase.rpc('my_entitlements'),
  ]);
  if (memberships.error) throwReadError(memberships.error, 'el usuario actual');
  if (entitlements.error) throwReadError(entitlements.error, 'el plan del consultorio');

  const ent = entitlements.data[0];
  if (!ent) return null;
  const row = memberships.data.find((m) => m.clinic?.id === ent.clinic_id);
  if (!row?.clinic) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    role: row.role,
    clinic: {
      ...row.clinic,
      account: {
        account_id: ent.account_id,
        plan: ent.plan,
        bot_addon: ent.bot_addon,
        bot_enabled: ent.bot_enabled,
        max_clinics: ent.max_clinics,
        max_doctors: ent.max_doctors,
      },
    },
  };
}

// Dentistas activos del consultorio (filtro de la agenda y selector al crear
// citas/planes). El owner cuenta como dentista.
export async function listDentists(): Promise<Pick<Staff, 'id' | 'full_name'>[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name')
    .in('role', ['dentist', 'owner'])
    .eq('active', true)
    .order('full_name');
  if (error) throwReadError(error, 'los dentistas');
  return data;
}

// Todo el personal del consultorio, activos primero (página de personal).
export async function listStaff(): Promise<Staff[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .order('active', { ascending: false })
    .order('full_name');
  if (error) throwReadError(error, 'el personal');
  return data;
}

// ---------------------------------------------------------------------------
// Server actions (solo owner)
// ---------------------------------------------------------------------------

async function requireOwner(): Promise<
  { ok: true; me: CurrentStaff } | { ok: false; error: string }
> {
  const me = await getCurrentStaff();
  if (!me || me.role !== 'owner') {
    return { ok: false, error: 'Solo el dueño del consultorio puede administrar al personal' };
  }
  if (!isSubscriptionActive(me.clinic.subscription_status)) {
    return { ok: false, error: SUBSCRIPTION_INACTIVE };
  }
  return { ok: true, me };
}

// Invita por correo a un dentista o recepcionista al consultorio del owner.
// Usa la service role (crear usuarios en Auth la requiere) DESPUÉS de comprobar
// que quien llama es owner; el consultorio sale de su sesión, no del formulario.
// El correo de invitación lleva a /auth/confirm, que abre la sesión y manda a
// /auth/aceptar-invitacion para definir la contraseña.
//
// Si el correo ya es personal de otro consultorio de la MISMA cuenta, no se
// invita de nuevo: se agrega como personal de este consultorio (entra con su
// mismo usuario y cambia de consultorio en el panel). Si es de otra cuenta, se
// rechaza como antes.
//
// Topes del plan: los aplican los triggers (también a la service role); aquí
// se traducen a mensajes. Antes de mandar una invitación nueva se revisa el
// uso contra el tope para no enviar un correo que luego se anula.
export async function inviteStaff(input: StaffInviteInput): Promise<ActionResult<{ id: string }>> {
  const parsed = staffInviteSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  const auth = await requireOwner();
  if (!auth.ok) return auth;
  const { email, full_name, role } = parsed.data;
  const me = auth.me;
  const plan = me.clinic.account;

  const admin = createAdminClient();

  // ¿Ya es personal de algún consultorio? (staff.email se guarda en minúsculas.)
  const { data: existing, error: existingError } = await admin
    .from('staff')
    .select('id, clinic_id, active, clinic:clinics(account_id)')
    .eq('email', email);
  if (existingError) return dbError(existingError);

  if (existing.length > 0) {
    const here = existing.find((s) => s.clinic_id === me.clinic.id);
    if (here) {
      return {
        ok: false,
        error: here.active
          ? 'Esa persona ya es parte del personal de este consultorio'
          : 'Esa persona ya es parte del personal de este consultorio, pero está desactivada: actívala desde la lista',
      };
    }
    // Mismo usuario en otra sede de la cuenta del owner (la cuenta del
    // consultorio activo sale de la sesión: my_entitlements()).
    const sameAccount = existing.find((s) => s.clinic?.account_id === plan.account_id);
    if (!sameAccount) {
      // Pertenece a otra cuenta: no se comparte personal entre cuentas.
      return { ok: false, error: 'Ese correo ya tiene una cuenta en la plataforma' };
    }
    const { error } = await admin.from('staff').insert({
      id: sameAccount.id,
      clinic_id: me.clinic.id,
      full_name,
      email,
      role,
    });
    if (error) return staffWriteError(error, plan);
    revalidatePath('/configuracion/personal');
    return { ok: true, data: { id: sameAccount.id } };
  }

  // Persona nueva: revisión previa del tope (el trigger sigue decidiendo).
  const ent = await getEntitlements();
  if (ent) {
    if (actsAsDentist(role) && ent.max_doctors !== null && ent.doctors_used >= ent.max_doctors) {
      return { ok: false, error: planLimitMessage('max_doctors', ent) };
    }
    if (role === 'receptionist' && ent.receptionists_used >= ent.max_receptionists_per_clinic) {
      return { ok: false, error: planLimitMessage('max_receptionists', ent) };
    }
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name },
  });
  if (inviteError || !invited.user) {
    if (inviteError?.code === 'email_exists') {
      // Tiene usuario en Auth pero no es personal de ninguna sede de esta cuenta.
      return { ok: false, error: 'Ese correo ya tiene una cuenta en la plataforma' };
    }
    reportError('Error al invitar:', inviteError, { where: 'staff.invite' });
    return { ok: false, error: 'No se pudo enviar la invitación. Intenta de nuevo.' };
  }

  const { error } = await admin.from('staff').insert({
    id: invited.user.id,
    clinic_id: me.clinic.id,
    full_name,
    email,
    role,
  });
  if (error) {
    // Sin fila en staff la cuenta no serviría: se borra para poder reintentar.
    await admin.auth.admin.deleteUser(invited.user.id);
    return staffWriteError(error, plan);
  }

  revalidatePath('/configuracion/personal');
  return { ok: true, data: { id: invited.user.id } };
}

// Activa o desactiva a alguien del personal de ESTE consultorio (una persona
// puede estar en varias sedes: solo se toca la fila del consultorio activo).
// Desactivado aquí, la RLS le quita el acceso a este consultorio de inmediato.
// Reactivar respeta los topes del plan. Pasa por la RLS con la sesión del owner.
export async function setStaffActive(
  id: string,
  active: boolean,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireOwner();
  if (!auth.ok) return auth;
  if (id === auth.me.id && !active) {
    return { ok: false, error: 'No puedes desactivar tu propia cuenta' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('staff')
    .update({ active })
    .eq('id', id)
    .eq('clinic_id', auth.me.clinic.id)
    .select('id')
    .maybeSingle();
  if (error) return staffWriteError(error, auth.me.clinic.account);
  if (!data) return { ok: false, error: 'Esa persona no pertenece a tu consultorio' };

  revalidatePath('/configuracion/personal');
  return { ok: true, data: { id } };
}

// Errores al escribir en staff: los de tope del plan con su mensaje; el resto
// como cualquier error de base de datos.
function staffWriteError(error: PostgrestError, plan: PlanInfo): { ok: false; error: string } {
  const message = planLimitError(error, plan);
  return message ? { ok: false, error: message } : dbError(error);
}
