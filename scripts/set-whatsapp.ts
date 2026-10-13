// Asigna, cambia o quita el número de WhatsApp (clinics.whatsapp_from) de un
// consultorio (lo ejecuta el dueño del SaaS, no la app). Usa la service role
// (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY de .env).
//
// El webhook identifica el consultorio por el "To" de Twilio, así que el número
// debe ser el remitente registrado en Twilio. Los topes (el plan debe incluir el
// bot) y la unicidad del número los aplica la base; si se rebasan, el script lo
// reporta.
//
// Uso:
//   npx tsx scripts/set-whatsapp.ts --clinic <slug> [--whatsapp-from <E.164> | --remove]
// Sin --whatsapp-from ni --remove solo muestra el número actual.

import 'dotenv/config';
import { parseArgs } from 'node:util';

import { createClient, type PostgrestError } from '@supabase/supabase-js';

import { normalizeWhatsAppNumber } from '../src/lib/whatsapp/phone';
import type { Database } from '../src/types/database';

const USAGE = `Uso: npx tsx scripts/set-whatsapp.ts --clinic <slug> [--whatsapp-from <E.164> | --remove]
Sin --whatsapp-from ni --remove solo muestra el número actual.`;

function fail(message: string): never {
  console.error(`Error: ${message}\n\n${USAGE}`);
  process.exit(1);
}

// Los triggers de topes lanzan P0001 con el nombre del tope en el hint.
function describeDbError(error: PostgrestError): string {
  if (error.code === 'P0001' && error.hint) return `tope del plan (${error.hint}): ${error.message}`;
  if (error.code === '23505') return 'ese número ya está asignado a otro consultorio';
  return error.message;
}

const { values } = parseArgs({
  options: {
    clinic: { type: 'string' },
    'whatsapp-from': { type: 'string' },
    remove: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const slug = values.clinic?.trim();
if (!slug) fail('falta --clinic <slug>');
if (values['whatsapp-from'] && values.remove) fail('usa --whatsapp-from o --remove, no los dos');

let whatsappFrom: string | null | undefined;
if (values['whatsapp-from']) {
  whatsappFrom = normalizeWhatsAppNumber(values['whatsapp-from']);
  if (!whatsappFrom) fail('--whatsapp-from debe ser un número E.164, p. ej. +14155238886');
} else if (values.remove) {
  whatsappFrom = null;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) fail('faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');

const supabase = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: clinic, error } = await supabase
    .from('clinics')
    .select('id, name, slug, whatsapp_from')
    .eq('slug', slug!)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el consultorio: ${error.message}`);
  if (!clinic) throw new Error(`No existe el consultorio con slug ${slug}`);

  console.log(`Consultorio: ${clinic.name} (${clinic.slug})`);
  console.log(`Número actual: ${clinic.whatsapp_from ?? 'ninguno'}`);
  if (whatsappFrom === undefined) return;

  if (whatsappFrom === clinic.whatsapp_from) {
    console.log('Sin cambios: ya tiene ese número.');
    return;
  }

  const { error: updateError } = await supabase
    .from('clinics')
    .update({ whatsapp_from: whatsappFrom })
    .eq('id', clinic.id);
  if (updateError) throw new Error(`No se pudo cambiar el número: ${describeDbError(updateError)}`);

  if (whatsappFrom) {
    console.log(`Número asignado: ${whatsappFrom}`);
    console.log('Recuerda que ese remitente en Twilio apunte a https://<PUBLIC_BASE_URL>/api/whatsapp.');
  } else {
    console.log('Número quitado: los mensajes a ese remitente se descartarán.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
