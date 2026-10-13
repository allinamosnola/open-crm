import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Todo excepto: assets de Next, favicon, imágenes estáticas, el webhook de
    // WhatsApp (/api/whatsapp y /api/whatsapp/status), que Twilio llama sin sesión
    // de usuario (se autentican con la firma X-Twilio-Signature), y el webhook de
    // Stripe (/api/stripe, firma Stripe-Signature). También quedan
    // fuera robots.txt, sitemap.xml y la imagen social (opengraph-image), que deben
    // ser públicos para los buscadores y las vistas previas.
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|opengraph-image|api/whatsapp|api/stripe|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
