# Auditoría SEO de la landing (prueba del plugin notfair)

Fecha: 2026-10-05 · Sitio: https://citabot.maoli.ws · Rama: `feat/prueba-seo-notfair`
Herramienta: skill `/notfair:seo-analysis` (plugin `notfair` 0.27.15), ejecutado en modo **solo URL**.

## Alcance y límites

- **Sin datos de Search Console ni GA4.** No se autenticó ninguna cuenta de Google; el sitio es nuevo y probablemente aún no está verificado en GSC. Faltan impresiones, consultas y posiciones.
- **Sin PageSpeed.** La API pública respondió 429 (cuota diaria sin API key). Rendimiento y Core Web Vitals quedan sin medir.
- **Bash denegado una vez** al intentar leer `~/.toprank` (caché del plugin) y comprobar gcloud. No se reintentó. El plugin no pudo guardar su log de auditorías.
- Lo auditado: HTML crudo del home (`curl`), cabeceras, `robots.txt`, `sitemap.xml` y el código en `src/app`.
- Corrección sobre WebFetch: informó dos H1 y teléfono `+56`. El HTML crudo muestra un solo H1, y el número real es `+52 56 5513 9819`.

## Lo que está bien

- `<html lang="es">`, `<title>` de 55 caracteres y meta description de 118 caracteres, ambos en español y con la propuesta de valor.
- Un solo H1, con jerarquía H1 > H2 > H3 limpia.
- Viewport correcto, HTTPS con HSTS, sin imágenes pesadas (17 SVG, 0 `<img>`).
- Favicon declarado (`/logo.svg`).

## Hallazgos priorizados

### 1. `robots.txt` y `sitemap.xml` no existen y redirigen a `/login` (Crítico, esfuerzo bajo)
- Evidencia: `curl` a ambos devuelve **307 → /login**, con el HTML del login. Causa: `src/lib/supabase/middleware.ts` solo deja pasar `/`, `/login` y `/auth/confirm`; el matcher de `src/middleware.ts` no excluye estas rutas.
- Efecto: los buscadores no pueden leer ni un robots ni un sitemap válidos, y el 307 con HTML puede interpretarse como un robots mal formado.
- Arreglo: crear `src/app/robots.ts` y `src/app/sitemap.ts` (ver `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/`) y excluirlos del matcher. Con `Disallow` para `/agenda`, `/pacientes`, `/api`, etc. y `Allow: /`; el sitemap solo con `/`.

### 2. Sin URL canónica, Open Graph ni Twitter cards (Alto, esfuerzo bajo)
- Evidencia: el `<head>` del home no tiene `canonical`, `og:*` ni `twitter:*`.
- Efecto: al compartir el enlace por WhatsApp, que es el canal de venta, no hay vista previa con título, descripción ni imagen.
- Arreglo: `metadataBase`, `alternates.canonical`, `openGraph` (con `locale: 'es_MX'`) y `twitter` en `src/app/(marketing)/page.tsx`. Falta una imagen 1200×630; el repo solo tiene `public/logo.svg` y `logo.jpeg`. Se puede generar con `opengraph-image.tsx`.

### 3. Metadatos del layout raíz genéricos (Medio, esfuerzo bajo)
- Evidencia: `src/app/layout.tsx` declara `description: "CRM del consultorio dental"`, que heredan `/login` y el resto de rutas.
- Arreglo: poner `robots: { index: false }` en `/login` y en el layout del panel, y dejar la descripción real solo en la landing.

### 4. Sin datos estructurados (Medio, esfuerzo bajo)
- Evidencia: 0 bloques JSON-LD.
- Arreglo: `SoftwareApplication` con `offers` (Básico 699, Pro 2,990, Plus 5,990 MXN, más el complemento Bot) y `Organization` con el email y el teléfono de contacto. Es un SaaS sin dirección física, así que `LocalBusiness` no aplica.

### 5. Contenido corto para posicionar (Medio, esfuerzo medio)
- Evidencia: la página tiene unas 5 secciones y no responde a búsquedas concretas como "agenda para dentistas", "bot de WhatsApp para consultorio dental" o "software dental México".
- Arreglo: añadir FAQ (con `FAQPage`), sección "cómo funciona" y una página por caso de uso. Validar las palabras clave con Search Console cuando haya datos, no solo con intuición.

### Menores
- El teléfono se muestra como `56 5513 9819` sin código de país; mostrar `+52 56 5513 9819`.
- El bot usa emoji 🤖 dentro de texto; añadir `aria-label` o quitarlo del H-contenido.
- La mayor parte del contenido de la landing es texto de la conversación de ejemplo. Está bien para conversión, pero conviene sumar texto descriptivo.
- Next 16 marca `middleware.ts` como obsoleto en favor de `proxy.ts` (según `node_modules/next/dist/docs/.../proxy.md`). No es SEO, pero conviene migrarlo con el codemod cuando se toque ese archivo.

## Para ignorar por ahora

- SEO local y hreflang: sitio en un solo idioma y sin sede física.
- Backlinks: sin datos y sin tráfico que justifique el esfuerzo todavía.
- Velocidad: probablemente buena (Next, SVG, sin imágenes), pero sin medir; repetir con API key.

## Siguientes pasos

1. Corregir hallazgos 1 a 4 en esta rama (cambio pequeño, unos 4 archivos).
2. Verificar el dominio `citabot.maoli.ws` en Search Console y enviar el sitemap.
3. Conseguir una `PAGESPEED_API_KEY` y repetir la medición.
4. Repetir `/notfair:seo-analysis` con GSC conectado a las 2 a 4 semanas.

## Evaluación del plugin (preliminar)

- **Útil:** el flujo es ordenado y el checklist cubre lo que importa. Los hallazgos 1 y 2 se detectaron con él.
- **Fricción:** el flujo asume gcloud, `~/.toprank` y GSC; en modo solo URL hay que saltar fases a mano. Su detección automática de sitios previos fue bloqueada por permisos.
- **Datos de terceros:** el plugin registra un MCP remoto (`notfair.co`) que no se usó en esta corrida. No se autenticó.
