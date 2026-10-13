import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { reportError } from '@/lib/observability';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/types/database';

// Feature flags en la base (tabla feature_flags, migración 20261101000001).
// Valor resuelto: excepción de la cuenta > valor global > apagado. Toda función
// nueva se despliega apagada y se enciende por cuenta con scripts/set-flag.ts,
// sin redeploy. Solo en el servidor: el panel recibe el valor ya resuelto.
//
// Ante un error de la base el flag cuenta como apagado (falla cerrado): una
// función a medio probar no debe encenderse por un fallo transitorio.

export const FLAGS = {
  // Recibo de pago y presupuesto del plan de tratamiento en PDF (Fase 6).
  pdfDocuments: 'pdf_documents',
} as const;

export type FeatureFlag = (typeof FLAGS)[keyof typeof FLAGS];

export const FEATURE_FLAGS: readonly FeatureFlag[] = Object.values(FLAGS);

type Client = SupabaseClient<Database>;

// Flag de una cuenta cualquiera. Usa la service role (feature_enabled solo la
// puede ejecutar el servidor): para webhooks, jobs y scripts.
export async function isEnabled(
  flag: FeatureFlag,
  accountId: string | null | undefined,
  options: { supabase?: Client } = {},
): Promise<boolean> {
  if (!accountId) return false;
  const supabase = options.supabase ?? createAdminClient();
  const { data, error } = await supabase.rpc('feature_enabled', { p_flag: flag, p_account_id: accountId });
  if (error) {
    reportError('No se pudo leer el feature flag:', error, { where: 'flags.isEnabled', extra: { flag } });
    return false;
  }
  return data === true;
}

// Flag de la cuenta del consultorio activo del usuario, con su sesión (server
// actions y Server Components). Sin membresía activa, false.
export async function isEnabledForSession(flag: FeatureFlag, supabase: Client): Promise<boolean> {
  const { data, error } = await supabase.rpc('my_feature_enabled', { p_flag: flag });
  if (error) {
    reportError('No se pudo leer el feature flag:', error, { where: 'flags.isEnabledForSession', extra: { flag } });
    return false;
  }
  return data === true;
}
