import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import type { Database } from '@/types/database';

// Rutas accesibles sin sesión. /auth/confirm recibe el enlace de invitación y
// abre la sesión. Los webhooks de Twilio (/api/whatsapp) ni siquiera pasan por
// aquí: los excluye el matcher de src/middleware.ts.
// /contratar/gracias es el destino de Stripe tras pagar desde la landing.
const PUBLIC_PATHS = ['/login', '/auth/confirm', '/contratar'];

// La raíz es la landing pública (src/app/(marketing)): sin sesión se muestra tal
// cual y con sesión se manda a la agenda.
const LANDING_PATH = '/';

// Refresca la sesión de Supabase (reescribe las cookies si el token rotó) y
// redirige a /login cuando no hay usuario.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          // Evita que un CDN cachee una respuesta con cookies de sesión.
          Object.entries(headers ?? {}).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // No poner código entre createServerClient y getUser(): getUser() valida el
  // token contra Supabase Auth y dispara el refresco de cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === LANDING_PATH ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === LANDING_PATH)) {
    const url = request.nextUrl.clone();
    url.pathname = '/agenda';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
