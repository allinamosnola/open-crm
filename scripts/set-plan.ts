// Cambia el plan y/o el complemento de bot de una cuenta (lo ejecuta el dueño
// del SaaS, no la app). Usa la service role (NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY de .env).
//
// Los topes se leen de account_entitlements() en la base (único origen de
// verdad). Bajar de plan no borra ni desactiva nada: los triggers solo bloquean
// altas nuevas. El script muestra el uso contra los topes nuevos y avisa si
// queda excedido (qué hacer con el exceso es decisión de negocio).
//
// Uso:
//   npx tsx scripts/set-plan.ts (--account <account_id> | --clinic <slug>) \
//     [--plan basic|pro|plus] [--bot-addon on|off]

import 'dotenv/config';
import { parseArgs } from 'node:util';

import { createClient } from '@supabase/supabase-js';

import type { Database } from '../src/types/database';

type Plan = Database['public']['Enums']['account_plan'];
const PLANS: readonly Plan[] = ['basic', 'pro', 'plus'];

const USAGE = `Uso: npx tsx scripts/set-plan.ts (--account <account_id> | --clinic <slug>)
       [--plan basic|pro|plus] [--bot-addon on|off]
Sin --plan ni --bot-addon solo muestra el plan, los topes y el uso actuales.`;

function fail(message: string): never {
  console.error(`Error: ${message}\n\n${USAGE}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    account: { type: 'string' },
    clinic: { type: 'string' },
    plan: { type: 'string' },
    'bot-addon': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

if (!values.account === !values.clinic) fail('indica la cuenta con --account o con --clinic (solo uno)');
if (values.plan && !PLANS.includes(values.plan as Plan)) fail('--plan debe ser basic, pro o plus');
const botAddonArg = values['bot-addon'];
if (botAddonArg && botAddonArg !== 'on' && botAddonArg !== 'off') fail('--bot-addon debe ser on u off');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) fail('faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');

const supabase = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PLAN_LABEL: Record<Plan, string> = { basic: 'Básico', pro: 'Pro', plus: 'Plus' };

function formatLimit(limit: number | null): string {
  return limit === null ? 'ilimitado' : String(limit);
}

async function resolveAccountId(): Promise<string> {
  if (values.account) return values.account.trim();
  const { data, error } = await supabase
    .from('clinics')
    .select('account_id')
    .eq('slug', values.clinic!.trim())
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el consultorio: ${error.message}`);
  if (!data) throw new Error(`No existe el consultorio con slug ${values.clinic}`);
  return data.account_id;
}

// Plan, topes y uso actual de la cuenta; avisa de excesos.
async function report(accountId: string) {
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id, name, plan, bot_addon')
    .eq('id', accountId)
    .single();
  if (accountError) throw new Error(`No se pudo leer la cuenta: ${accountError.message}`);

  const { data: entitlements, error: entError } = await supabase.rpc('account_entitlements', {
    p_account_id: accountId,
  });
  if (entError) throw new Error(`No se pudieron leer los topes: ${entError.message}`);
  const ent = entitlements?.[0];
  if (!ent) throw new Error('account_entitlements no devolvió resultado');

  const { data: clinics, error: clinicsError } = await supabase
    .from('clinics')
    .select('id, slug, whatsapp_from')
    .eq('account_id', accountId);
  if (clinicsError) throw new Error(`No se pudieron leer los consultorios: ${clinicsError.message}`);

  const { data: doctors, error: doctorsError } = await supabase
    .from('staff')
    .select('id, clinic:clinics!inner(account_id)')
    .in('role', ['dentist', 'owner'])
    .eq('active', true)
    .eq('clinic.account_id', accountId);
  if (doctorsError) throw new Error(`No se pudo leer el personal: ${doctorsError.message}`);
  const doctorCount = new Set((doctors ?? []).map((d) => d.id)).size;
  const clinicCount = clinics?.length ?? 0;
  const numbers = (clinics ?? []).filter((c) => c.whatsapp_from);

  console.log(`Cuenta: ${account.name} (${account.id})`);
  console.log(`Plan: ${PLAN_LABEL[account.plan]}${account.bot_addon ? ' + complemento Bot' : ''}`);
  console.log(`Bot de WhatsApp: ${ent.bot_enabled ? 'sí' : 'no'}`);
  console.log(`Consultorios: ${clinicCount} de ${formatLimit(ent.max_clinics)} (${(clinics ?? []).map((c) => c.slug).join(', ')})`);
  console.log(`Doctores (distintos, activos): ${doctorCount} de ${formatLimit(ent.max_doctors)}`);

  if (ent.max_clinics !== null && clinicCount > ent.max_clinics) {
    console.warn(`Aviso: la cuenta excede el tope de consultorios (${clinicCount} > ${ent.max_clinics}). No se pueden agregar más.`);
  }
  if (ent.max_doctors !== null && doctorCount > ent.max_doctors) {
    console.warn(`Aviso: la cuenta excede el tope de doctores (${doctorCount} > ${ent.max_doctors}). No se pueden agregar ni reactivar más.`);
  }
  if (!ent.bot_enabled && numbers.length > 0) {
    console.warn(
      `Aviso: el plan no incluye bot, pero ${numbers.map((c) => c.slug).join(', ')} conserva(n) su número de WhatsApp; ` +
        'sus mensajes entrantes no se guardan y el paciente recibe un texto fijo (una vez cada 24 h por número).',
    );
  }
  if (account.bot_addon && account.plan !== 'basic') {
    console.warn('Aviso: el complemento Bot solo aplica a Básico; Pro y Plus ya incluyen el bot.');
  }
}

async function main() {
  const accountId = await resolveAccountId();

  const changes: Database['public']['Tables']['accounts']['Update'] = {};
  if (values.plan) changes.plan = values.plan as Plan;
  if (botAddonArg) changes.bot_addon = botAddonArg === 'on';

  if (Object.keys(changes).length > 0) {
    const { data, error } = await supabase.from('accounts').update(changes).eq('id', accountId).select('id');
    if (error) throw new Error(`No se pudo cambiar el plan: ${error.message}`);
    if (!data?.length) throw new Error(`No existe la cuenta ${accountId}`);
    console.log('Plan actualizado.\n');
  }

  await report(accountId);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
