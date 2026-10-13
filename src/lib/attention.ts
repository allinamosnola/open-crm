// Detección de escalamientos nuevos a partir de los eventos de Realtime de
// `conversations` (aviso con sonido y toast en el panel). Sin dependencias del
// navegador ni del servidor: se prueba con vitest.

// Tiempo máximo entre escalated_at (lo escribe el bot) y el commit del UPDATE
// para considerar que ese UPDATE es el propio escalamiento.
const ESCALATION_WINDOW_MS = 15_000;

type ConversationRow = {
  id?: string;
  needs_attention?: boolean | null;
  escalated_at?: string | null;
};

export type ConversationChange = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  commit_timestamp?: string;
  new: ConversationRow | Record<string, never>;
  old: ConversationRow | Record<string, never>;
};

// Un escalamiento es un UPDATE de conversations en el que needs_attention pasa
// de false a true.
//
// La tabla usa REPLICA IDENTITY por defecto, así que Realtime solo manda la
// llave primaria en `old`. Si `old` trae needs_attention (REPLICA IDENTITY
// FULL) se usa la regla exacta; si no, se considera escalamiento el UPDATE que
// deja needs_attention = true y cuyo escalated_at coincide con la hora del
// commit (el bot lo escribe en el mismo UPDATE). `notified` guarda el último
// escalated_at avisado por conversación para no repetir el aviso cuando llegan
// otros UPDATE (mensajes nuevos, no leídos) de la misma conversación.
export function detectNewEscalation(
  change: ConversationChange,
  notified: Map<string, string>,
): { id: string; escalatedAt: string } | null {
  const row = change.new as ConversationRow;
  const old = change.old as ConversationRow;
  if (change.eventType === 'DELETE' || !row.id || row.needs_attention !== true) return null;

  const escalatedAt = row.escalated_at ?? '';
  if (notified.get(row.id) === escalatedAt) return null;

  let isEscalation: boolean;
  if (change.eventType === 'UPDATE' && typeof old.needs_attention === 'boolean') {
    isEscalation = old.needs_attention === false;
  } else {
    const committed = Date.parse(change.commit_timestamp ?? '');
    const escalated = Date.parse(escalatedAt);
    isEscalation =
      Number.isFinite(committed) &&
      Number.isFinite(escalated) &&
      Math.abs(committed - escalated) <= ESCALATION_WINDOW_MS;
  }
  if (!isEscalation) return null;

  notified.set(row.id, escalatedAt);
  return { id: row.id, escalatedAt };
}
