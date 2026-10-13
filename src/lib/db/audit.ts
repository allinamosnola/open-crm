'use server';

import { createClient } from '@/lib/supabase/server';

import { throwReadError } from './errors';
import type { AuditedTable, AuditLogEntry } from './types';

// Bitácora de auditoría (tabla audit_log, migración 20261101000003): la llenan
// triggers en pacientes, notas clínicas, pagos y personal. La RLS solo deja
// leerla al owner y de su consultorio activo: para cualquier otro rol esta
// lectura devuelve una lista vacía. No guarda valores, solo qué columnas
// cambiaron.

const MAX_LIMIT = 500;

// Registros más recientes primero; opcionalmente de una tabla o de un registro
// (p. ej. el historial de cambios de un paciente).
export async function listAuditLog(
  options: { tableName?: AuditedTable; recordId?: string; limit?: number } = {},
): Promise<AuditLogEntry[]> {
  const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? 100)), MAX_LIMIT);
  const supabase = await createClient();
  let query = supabase.from('audit_log').select('*');
  if (options.tableName) query = query.eq('table_name', options.tableName);
  if (options.recordId) query = query.eq('record_id', options.recordId);
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
  if (error) throwReadError(error, 'la bitácora de auditoría');
  return data;
}
