import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

// Cliente con la service role: se salta la RLS. Solo para el servidor y solo en
// flujos sin sesión de usuario (webhook de Twilio) o ya autorizados en código
// (invitar personal después de comprobar que quien llama es owner).
// Nunca importarlo desde un Client Component ni exponer la llave.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  }
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
