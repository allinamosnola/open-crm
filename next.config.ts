import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';

// Cabeceras de seguridad para todas las rutas. El panel muestra datos de salud:
// DENY evita que se incruste en un iframe (clickjacking). HSTS ya lo pone Vercel.
// Pendiente: una Content-Security-Policy, que hay que probar con FullCalendar y Sentry.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

// Sin SENTRY_AUTH_TOKEN (dev, CI sin secretos) el build sigue y solo omite la subida de source maps.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
