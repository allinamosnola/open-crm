import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import type { Database } from '@/types/database';

// Cliente de Supabase para Server Components, Server Actions y Route Handlers.
// Usa la sesión del usuario (cookies), así que todas las consultas pasan por RLS.
// Crear uno nuevo por request: no reutilizar entre requests.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Llamado desde un Server Component (no puede escribir cookies).
            // Se puede ignorar: el middleware refresca la sesión en cada request.
          }
        },
      },
    },
  );
}
