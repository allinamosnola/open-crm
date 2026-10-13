// URL pública de la landing. Se usa para metadataBase, canonical, sitemap y robots.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://citabot.maoli.ws').replace(
  /\/+$/,
  '',
);

export const SITE_NAME = 'CitaBot Dental';

export const SITE_DESCRIPTION =
  'Agenda, pacientes y un bot de WhatsApp que agenda citas por ti. Planes Básico, Pro y Plus para consultorios dentales.';

// Aviso de privacidad (enlace en Checkout, junto al botón de pagar). Sin la variable
// no se muestra el enlace.
export const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL?.trim() || null;

// URL base para los retornos de Stripe (success/cancel/portal). En desarrollo,
// PUBLIC_BASE_URL apunta al túnel o a localhost.
export function appUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? SITE_URL).replace(/\/+$/, '');
}
