import * as Sentry from '@sentry/nextjs';

// Reporta un error atrapado: lo deja en el log y lo manda a Sentry (sin DSN, el
// SDK no envía nada). `where` identifica el punto del código; en `extra` solo
// contexto técnico, nunca teléfonos, nombres ni texto de mensajes (datos de salud).
export function reportError(
  message: string,
  error: unknown,
  context: {
    where: string;
    clinicId?: string;
    // Tags adicionales para filtrar en Sentry (p. ej. attempt de withRetry).
    tags?: Record<string, string>;
    extra?: Record<string, string | number | boolean>;
  },
): void {
  console.error(message, error);
  // Los errores de Supabase son objetos planos sin stack: se envuelven en un Error.
  const captured = error instanceof Error ? error : new Error(message);
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  Sentry.captureException(captured, {
    tags: {
      ...context.tags,
      where: context.where,
      ...(context.clinicId ? { clinic_id: context.clinicId } : {}),
    },
    extra: { message, ...(code ? { code } : {}), ...context.extra },
  });
}
