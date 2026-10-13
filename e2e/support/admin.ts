import { createClient } from '@supabase/supabase-js';

// Cliente con la service role de Supabase LOCAL, solo para preparar y limpiar
// datos de los tests (nunca se usa en el navegador).
export function adminClient() {
  return createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
