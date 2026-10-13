// Alta manual de un consultorio (lo ejecuta el dueño del SaaS, no la app).
// Usa la service role (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY de .env).
// Si algo falla, deshace lo creado.
//
// Dos modos:
//   * Cuenta nueva (sin --account):
//       1. crea la cuenta (accounts) con el plan y el complemento de bot;
//       2. crea la fila en clinics;
//       3. invita al owner por correo (auth.admin.inviteUserByEmail);
//       4. crea su fila en staff con rol owner.
//   * Sede nueva de una cuenta existente (--account <id>):
//       1. crea la fila en clinics dentro de esa cuenta;
//       2. agrega al owner de la cuenta (el mismo usuario) como owner de la sede
//          nueva: otra fila de staff, sin invitación.
//     El plan no cambia aquí (para eso está scripts/set-plan.ts).
// Los topes del plan (consultorios, doctores, whatsapp_from solo con bot) los
// aplica la base con triggers; si se rebasan, el script lo reporta y deshace.
//
// Uso:
//   npx tsx scripts/create-clinic.ts --name "Consultorio Sonrisas" --slug sonrisas \
//     --owner-email dueno@ejemplo.com --owner-name "Dra. Ana López" --plan basic|pro|plus \
//     [--bot-addon] [--whatsapp-from +14155238886] [--timezone America/Mexico_City] \
//     [--subscription trial|active]
//   npx tsx scripts/create-clinic.ts --account <account_id> --name "Sonrisas Sur" --slug sonrisas-sur \
//     [--owner-email dueno@ejemplo.com] [--whatsapp-from ...] [--timezone ...] [--subscription ...]

import 'dotenv/config';
import { parseArgs } from 'node:util';

import { createClient } from '@supabase/supabase-js';

import { createAccountWithOwner, describeDbError, insertClinic } from '../src/lib/provisioning/account';
import { normalizeWhatsAppNumber } from '../src/lib/whatsapp/phone';
import type { Database } from '../src/types/database';

type Plan = Database['public']['Enums']['account_plan'];
const PLANS: readonly Plan[] = ['basic', 'pro', 'plus'];

const USAGE = `Uso:
  Cuenta nueva:
    npx tsx scripts/create-clinic.ts --name <nombre> --slug <slug> --owner-email <correo> --owner-name <nombre>
         --plan basic|pro|plus [--bot-addon]
         [--whatsapp-from <E.164>] [--timezone <IANA>] [--subscription trial|active]
  Sede nueva de una cuenta existente (reutiliza al owner de la cuenta):
    npx tsx scripts/create-clinic.ts --account <account_id> --name <nombre> --slug <slug>
         [--owner-email <correo de un owner de la cuenta>]
         [--whatsapp-from <E.164>] [--timezone <IANA>] [--subscription trial|active]`;

function fail(message: string): never {
  console.error(`Error: ${message}\n\n${USAGE}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    account: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    'owner-email': { type: 'string' },
    'owner-name': { type: 'string' },
    plan: { type: 'string' },
    'bot-addon': { type: 'boolean' },
    'whatsapp-from': { type: 'string' },
    timezone: { type: 'string' },
    subscription: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const accountId = values.account?.trim() || null;
const name = values.name?.trim();
const slug = values.slug?.trim();
const ownerEmail = values['owner-email']?.trim().toLowerCase() || null;
const ownerName = values['owner-name']?.trim() || null;

if (!name || !slug) fail('faltan --name o --slug');
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail('el slug solo admite minúsculas, números y guiones');
if (ownerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) fail('correo del owner inválido');

let plan: Plan | null = null;
if (accountId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) {
    fail('--account debe ser el id (uuid) de la cuenta');
  }
  if (values.plan || values['bot-addon']) {
    fail('con --account no se cambia el plan; usa scripts/set-plan.ts');
  }
  if (ownerName) fail('con --account se reutiliza el owner de la cuenta; no uses --owner-name');
} else {
  if (!ownerEmail || !ownerName) fail('faltan --owner-email o --owner-name');
  if (!values.plan) fail('falta --plan (basic, pro o plus)');
  if (!PLANS.includes(values.plan as Plan)) fail('--plan debe ser basic, pro o plus');
  plan = values.plan as Plan;
}

let whatsappFrom: string | null = null;
if (values['whatsapp-from']) {
  whatsappFrom = normalizeWhatsAppNumber(values['whatsapp-from']);
  if (!whatsappFrom) fail('--whatsapp-from debe ser un número E.164, p. ej. +14155238886');
}

const subscription = values.subscription ?? 'trial';
if (subscription !== 'trial' && subscription !== 'active') {
  fail('--subscription debe ser trial o active');
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) fail('faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');

const supabase = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Cuenta nueva + consultorio + owner invitado.
async function createWithNewAccount() {
  await createAccountWithOwner(
    supabase,
    {
      name: name!,
      slug: slug!,
      plan: plan!,
      botAddon: values['bot-addon'] ?? false,
      ownerEmail: ownerEmail!,
      ownerName: ownerName!,
      whatsappFrom,
      timezone: values.timezone,
      subscriptionStatus: subscription as 'trial' | 'active',
    },
    console.log,
  );
  console.log('Le llegará un correo para definir su contraseña.');
}

// Sede nueva en una cuenta existente, con el mismo owner (otra fila de staff).
async function addClinicToAccount() {
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id, name, plan, bot_addon')
    .eq('id', accountId!)
    .maybeSingle();
  if (accountError) throw new Error(`No se pudo leer la cuenta: ${accountError.message}`);
  if (!account) throw new Error(`No existe la cuenta ${accountId}`);

  // Owners de la cuenta (una fila por sede; se agrupan por usuario).
  const { data: ownerRows, error: ownersError } = await supabase
    .from('staff')
    .select('id, full_name, email, clinic:clinics!inner(account_id)')
    .eq('role', 'owner')
    .eq('active', true)
    .eq('clinic.account_id', account.id);
  if (ownersError) throw new Error(`No se pudo leer el owner de la cuenta: ${ownersError.message}`);
  const owners = new Map((ownerRows ?? []).map((row) => [row.id, row]));
  let candidates = [...owners.values()];
  if (ownerEmail) candidates = candidates.filter((o) => o.email.toLowerCase() === ownerEmail);
  if (candidates.length === 0) {
    throw new Error(
      ownerEmail
        ? `${ownerEmail} no es owner activo de la cuenta ${account.name}`
        : `La cuenta ${account.name} no tiene owner activo`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `La cuenta tiene varios owners (${candidates.map((o) => o.email).join(', ')}); elige uno con --owner-email`,
    );
  }
  const owner = candidates[0];

  const clinicId = await insertClinic(supabase, {
    accountId: account.id,
    name: name!,
    slug: slug!,
    whatsappFrom,
    timezone: values.timezone,
    subscriptionStatus: subscription as 'trial' | 'active',
  });
  console.log(`Consultorio creado: ${clinicId}`);

  const { error: staffError } = await supabase.from('staff').insert({
    id: owner.id,
    clinic_id: clinicId,
    full_name: owner.full_name,
    email: owner.email,
    role: 'owner',
  });
  if (staffError) {
    await supabase.from('clinics').delete().eq('id', clinicId);
    throw new Error(`No se pudo agregar al owner a la sede nueva: ${describeDbError(staffError)}`);
  }

  console.log(`Sede agregada a la cuenta ${account.name} (plan ${account.plan}${account.bot_addon ? ' + bot' : ''}).`);
  console.log(`Owner: ${owner.email} (${owner.id}); entra con su mismo usuario, sin invitación nueva.`);
}

(accountId ? addClinicToAccount() : createWithNewAccount()).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
