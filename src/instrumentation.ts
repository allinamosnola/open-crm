import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('../sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('../sentry.edge.config');
}

// Errores no atrapados de Server Components, route handlers y server actions.
export const onRequestError = Sentry.captureRequestError;
