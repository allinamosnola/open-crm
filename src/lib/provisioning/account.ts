// Alta de una cuenta nueva: cuenta -> consultorio -> owner invitado -> fila en staff.
// La usan scripts/create-clinic.ts (alta manual) y el webhook de Stripe (alta desde
// la landing). Recibe el cliente con la service role y no importa 'server-only'
// para poder correr desde tsx. Si un paso falla deshace lo creado.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

type Admin = SupabaseClient<Database>;
type Plan = Database['public']['Enums']['account_plan'];
type SubscriptionStatus = Database['public']['Enums']['subscription_status'];

export type ProvisioningErrorCode =
  // El correo ya tiene usuario en Auth.
  | 'email_exists'
  // El slug del consultorio ya existe.
  | 'slug_taken'
  // Ya hay una cuenta para esa sesión de Checkout (reintento o carrera).
  | 'duplicate_session'
  | 'other';

export class ProvisioningError extends Error {
  constructor(
    message: string,
    readonly code: ProvisioningErrorCode = 'other',
  ) {
    super(message);
    this.name = 'ProvisioningError';
  }
}

// Los triggers de topes lanzan P0001 con el nombre del tope en el hint.
export function describeDbError(error: PostgrestError): string {
  if (error.code === 'P0001' && error.hint) return `tope del plan (${error.hint}): ${error.message}`;
  return error.message;
}

export type NewClinicInput = {
  accountId: string;
  name: string;
  slug: string;
  whatsappFrom?: string | null;
  timezone?: string | null;
  subscriptionStatus: 'trial' | 'active';
};

export async function insertClinic(admin: Admin, input: NewClinicInput): Promise<string> {
  const { data, error } = await admin
    .from('clinics')
    .insert({
      account_id: input.accountId,
      name: input.name,
      slug: input.slug,
      whatsapp_from: input.whatsappFrom ?? null,
      subscription_status: input.subscriptionStatus satisfies SubscriptionStatus,
      ...(input.timezone ? { timezone: input.timezone } : {}),
    })
    .select('id')
    .single();
  if (error) {
    const code = error.code === '23505' && error.details?.includes('(slug)') ? 'slug_taken' : 'other';
    throw new ProvisioningError(`No se pudo crear el consultorio: ${describeDbError(error)}`, code);
  }
  return data.id;
}

export type NewAccountInput = {
  // Nombre de la cuenta y del consultorio.
  name: string;
  slug: string;
  plan: Plan;
  botAddon: boolean;
  ownerEmail: string;
  ownerName: string;
  whatsappFrom?: string | null;
  timezone?: string | null;
  subscriptionStatus: 'trial' | 'active';
  // Solo en altas desde Checkout: llave de idempotencia.
  stripeCheckoutSessionId?: string | null;
};

export type NewAccount = { accountId: string; clinicId: string; ownerId: string };

export async function createAccountWithOwner(
  admin: Admin,
  input: NewAccountInput,
  log: (message: string) => void = () => {},
): Promise<NewAccount> {
  // inviteUserByEmail solo falla con email_exists si el usuario ya confirmó; a quien
  // fue invitado y no ha entrado le reenvía la invitación y devolvería el mismo
  // usuario. Todo usuario de la app es personal de alguna sede: se revisa ahí antes
  // de crear nada para no ligar a una persona a dos cuentas.
  const { data: taken, error: takenError } = await admin
    .from('staff')
    .select('id')
    .eq('email', input.ownerEmail)
    .limit(1)
    .maybeSingle();
  if (takenError) throw new ProvisioningError(`No se pudo revisar el correo: ${takenError.message}`);
  if (taken) throw new ProvisioningError('El correo ya es personal de una cuenta', 'email_exists');

  const { data: account, error: accountError } = await admin
    .from('accounts')
    .insert({
      name: input.name,
      plan: input.plan,
      bot_addon: input.botAddon,
      ...(input.stripeCheckoutSessionId
        ? { stripe_checkout_session_id: input.stripeCheckoutSessionId }
        : {}),
    })
    .select('id')
    .single();
  if (accountError) {
    const code = accountError.code === '23505' ? 'duplicate_session' : 'other';
    throw new ProvisioningError(`No se pudo crear la cuenta: ${accountError.message}`, code);
  }
  log(`Cuenta creada: ${account.id} (plan ${input.plan}${input.botAddon ? ' + bot' : ''})`);

  const undoAccount = async () => {
    await admin.from('accounts').delete().eq('id', account.id);
  };

  let clinicId: string;
  try {
    clinicId = await insertClinic(admin, { ...input, accountId: account.id });
  } catch (error) {
    await undoAccount();
    throw error;
  }
  log(`Consultorio creado: ${clinicId}`);

  const undoClinic = async () => {
    await admin.from('clinics').delete().eq('id', clinicId);
    await undoAccount();
  };

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    input.ownerEmail,
    { data: { full_name: input.ownerName } },
  );
  if (inviteError || !invited.user) {
    await undoClinic();
    throw new ProvisioningError(
      `No se pudo invitar al owner: ${inviteError?.message ?? 'sin usuario'}`,
      inviteError?.code === 'email_exists' ? 'email_exists' : 'other',
    );
  }

  const { error: staffError } = await admin.from('staff').insert({
    id: invited.user.id,
    clinic_id: clinicId,
    full_name: input.ownerName,
    email: input.ownerEmail,
    role: 'owner',
  });
  if (staffError) {
    await admin.auth.admin.deleteUser(invited.user.id);
    await undoClinic();
    throw new ProvisioningError(`No se pudo crear al owner en staff: ${describeDbError(staffError)}`);
  }

  log(`Owner invitado: ${input.ownerEmail} (${invited.user.id})`);
  return { accountId: account.id, clinicId, ownerId: invited.user.id };
}

// Slug a partir del nombre: minúsculas, sin acentos, solo a-z, 0-9 y guiones. Lleva un
// sufijo aleatorio corto para que dos consultorios con el mismo nombre no choquen.
export function buildSlug(name: string, suffix: string = randomSuffix()): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `${base || 'consultorio'}-${suffix}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}
