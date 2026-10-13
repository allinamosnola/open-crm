// Enciende o apaga un feature flag, global o para una cuenta (lo ejecuta el
// dueño del SaaS, no la app). Usa la service role (NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY de .env). El cambio aplica al siguiente request,
// sin redeploy.
//
// Uso:
//   npx tsx scripts/set-flag.ts --flag <nombre> [--account <account_id> | --clinic <slug>] \
//     [--on | --off | --clear] [--note <texto>]
// Sin --account ni --clinic cambia el valor global. --clear borra la fila (la
// cuenta vuelve a heredar el valor global). Sin acción solo muestra los valores.

import 'dotenv/config';
import { parseArgs } from 'node:util';

import { createClient } from '@supabase/supabase-js';

import type { Database } from '../src/types/database';

const USAGE = `Uso: npx tsx scripts/set-flag.ts --flag <nombre> [--account <account_id> | --clinic <slug>]
       [--on | --off | --clear] [--note <texto>]`;

function fail(message: string): never {
  console.error(`Error: ${message}\n\n${USAGE}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    flag: { type: 'string' },
    account: { type: 'string' },
    clinic: { type: 'string' },
    on: { type: 'boolean' },
    off: { type: 'boolean' },
    clear: { type: 'boolean' },
    note: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const flag = values.flag?.trim();
if (!flag || !/^[a-z][a-z0-9_]{1,62}$/.test(flag)) fail('--flag es obligatorio, en snake_case');
if (values.account && values.clinic) fail('usa --account o --clinic, no ambos');
if ([values.on, values.off, values.clear].filter(Boolean).length > 1) fail('usa solo una de --on, --off o --clear');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) fail('faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');

const supabase = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function resolveAccountId(): Promise<string | null> {
  if (values.account) return values.account.trim();
  if (!values.clinic) return null;
  const { data, error } = await supabase
    .from('clinics')
    .select('account_id')
    .eq('slug', values.clinic.trim())
    .maybeSingle();
  if (error) fail(`no se pudo leer el consultorio: ${error.message}`);
  if (!data) fail(`no existe el consultorio con slug "${values.clinic}"`);
  return data.account_id;
}

async function main() {
  const accountId = await resolveAccountId();
  const scope = accountId ? `cuenta ${accountId}` : 'global';

  if (values.clear) {
    let query = supabase.from('feature_flags').delete().eq('flag', flag!);
    query = accountId ? query.eq('account_id', accountId) : query.is('account_id', null);
    const { error } = await query;
    if (error) fail(`no se pudo borrar: ${error.message}`);
    console.log(`Flag ${flag} (${scope}): borrado`);
  } else if (values.on || values.off) {
    const { error } = await supabase.from('feature_flags').upsert(
      { flag: flag!, account_id: accountId, enabled: !!values.on, note: values.note ?? null },
      { onConflict: 'flag,account_id' },
    );
    if (error) fail(`no se pudo guardar: ${error.message}`);
    console.log(`Flag ${flag} (${scope}): ${values.on ? 'encendido' : 'apagado'}`);
  }

  const { data, error } = await supabase
    .from('feature_flags')
    .select('account_id, enabled, note, updated_at')
    .eq('flag', flag!)
    .order('account_id', { nullsFirst: true });
  if (error) fail(`no se pudo leer: ${error.message}`);
  console.log(`\nValores de ${flag} (sin fila = apagado):`);
  for (const row of data) {
    console.log(`  ${row.account_id ?? 'global'}: ${row.enabled ? 'on' : 'off'}${row.note ? ` (${row.note})` : ''}`);
  }
  if (accountId) {
    const { data: resolved } = await supabase.rpc('feature_enabled', { p_flag: flag!, p_account_id: accountId });
    console.log(`Valor resuelto para la cuenta: ${resolved ? 'on' : 'off'}`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
