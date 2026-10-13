import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

// Destino del enlace de invitación (plantilla supabase/templates/invite.html):
//   /auth/confirm?token_hash=...&type=invite&next=/auth/aceptar-invitacion
// Verifica el token, abre la sesión (cookies) y redirige a `next`, donde la
// persona define su contraseña. Es pública en el middleware.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/auth/aceptar-invitacion';
  // Solo rutas internas (evita redirecciones abiertas).
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/agenda';

  const url = request.nextUrl.clone();
  url.search = '';

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      url.pathname = safeNext;
      return NextResponse.redirect(url);
    }
    console.error('Enlace de invitación inválido o expirado:', error.message);
  }

  url.pathname = '/login';
  url.searchParams.set('error', 'enlace-invalido');
  return NextResponse.redirect(url);
}
