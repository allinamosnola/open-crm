import 'server-only';

import type { PostgrestError } from '@supabase/supabase-js';
import type { z } from 'zod';

import type { ActionResult } from './types';
import { reportError } from '@/lib/observability';

export const OVERLAP_MESSAGE = 'El dentista ya tiene una cita en ese horario';

// Traduce errores de Postgres/PostgREST a mensajes en español para la UI.
export function dbError(error: PostgrestError): { ok: false; error: string } {
  switch (error.code) {
    case '23P01': // exclusion_violation: appointments_no_overlap
      return { ok: false, error: OVERLAP_MESSAGE };
    case '23505': // unique_violation
      return {
        ok: false,
        error: error.message.includes('phone')
          ? 'Ya existe un paciente con ese teléfono'
          : 'El registro ya existe',
      };
    case '23503': // foreign_key_violation
      return { ok: false, error: 'El registro relacionado no existe o está en uso' };
    case '23514': // check_violation
      return { ok: false, error: 'Algún dato no es válido' };
    case '42501': // insufficient_privilege (RLS)
      return { ok: false, error: 'No tienes permiso para realizar esta acción' };
    default:
      reportError('Error de base de datos:', error, { where: 'db.write', extra: { pgCode: error.code } });
      return { ok: false, error: 'Ocurrió un error al guardar. Intenta de nuevo.' };
  }
}

export function validationError(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { ok: false, error: 'Revisa los datos del formulario', fieldErrors };
}

// Error de lectura: se lanza para que lo capture el error boundary de la página.
export function throwReadError(error: PostgrestError, what: string): never {
  reportError(`Error al leer ${what}:`, error, { where: 'db.read', extra: { pgCode: error.code } });
  throw new Error(`No se pudo cargar ${what}`);
}
