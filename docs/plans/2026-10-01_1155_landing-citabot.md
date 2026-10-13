# Landing de CitaBot Dental (citabot.maoli.ws)

## Decisión
La landing vive en este repo como página de Next.js en la raíz `/`, dentro del grupo de rutas
`src/app/(marketing)`. Se parte del diseño publicado como artifact (paleta de la app, planes
Básico / Pro / Plus + Complemento Bot).

## Cambios
- `src/app/(marketing)/page.tsx`: landing (hero con conversación de ejemplo, funciones, tarifas, contacto).
- `src/components/marketing/pricing-cards.tsx`: tarjetas de tarifas con los colores de sección de la app.
- `src/lib/planes-publicos.ts`: precios y datos de contacto en un solo lugar.
- `src/app/page.tsx` eliminado (solo redirigía a `/agenda`).
- `src/lib/supabase/middleware.ts`: `/` es pública; con sesión redirige a `/agenda`, sin sesión muestra la landing.
- Usa los tokens de `globals.css`, así que funciona en tema claro y oscuro.

## Precios (de 2026-10-01_1112_tarifas-basica-pro-plus-v2.md (plan de negocio, no incluido en la copia pública))
Básico 699, Complemento Bot +899, Pro 2,990, Plus 5,990 (hasta 5 consultorios, +999 por extra). MXN/mes + IVA.

## Pendiente
- Decisión 2026-10-01: consultorio.maoli.ws deja de usarse; todo (landing, login y panel) va en
  citabot.maoli.ws, así que no hace falta redirigir por host.
- Añadir el dominio citabot.maoli.ws en Vercel y su DNS.
- Pasar a citabot.maoli.ws lo que el plan de deploy puso en consultorio.maoli.ws: Site URL y Redirect
  URLs de Supabase Auth, `PUBLIC_BASE_URL` en Vercel y las URLs de webhook de Twilio
  (`/api/whatsapp` y su status callback). Si `PUBLIC_BASE_URL` no coincide, falla la firma de Twilio.
- Probar en el navegador (tsc y lint OK; no se levantó la app).
- Los topes de plan siguen sin existir en el código (ver plan de implementación de planes y topes).
