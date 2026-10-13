// Estado del bot por conversación (conversations.bot_state). Lo lee y lo guarda
// el agente dentro del candado por conversación (bot_acquire_turn /
// bot_release_turn), así dos mensajes simultáneos no se pisan.

export interface OfferedSlot {
  // Id corto que ve el modelo (p. ej. "H4"); agendar_cita solo acepta estos.
  id: string;
  dentist_id: string;
  dentist_name: string;
  starts_at: string;
  ends_at: string;
  label: string;
}

export interface BotState {
  // Huecos ofrecidos en esta conversación (los más recientes al final).
  offered_slots: OfferedSlot[];
  // Contador para generar ids de huecos únicos en la conversación.
  slot_seq: number;
  // Turnos seguidos en los que el modelo marcó que no entendió.
  not_understood: number;
}

// Máximo de huecos que se recuerdan (varias búsquedas en la misma conversación).
export const MAX_OFFERED_SLOTS = 12;

export function emptyBotState(): BotState {
  return { offered_slots: [], slot_seq: 0, not_understood: 0 };
}

function isOfferedSlot(value: unknown): value is OfferedSlot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return ['id', 'dentist_id', 'dentist_name', 'starts_at', 'ends_at', 'label'].every(
    (key) => typeof s[key] === 'string',
  );
}

// Convierte lo guardado en jsonb a BotState, tolerando '{}' o datos del bot
// anterior (p. ej. { pendingSlots: [...] } de la Semana 2), que se descartan.
export function parseBotState(value: unknown): BotState {
  const state = emptyBotState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return state;
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.offered_slots)) {
    state.offered_slots = v.offered_slots.filter(isOfferedSlot).slice(-MAX_OFFERED_SLOTS);
  }
  if (typeof v.slot_seq === 'number' && Number.isInteger(v.slot_seq) && v.slot_seq >= 0) {
    state.slot_seq = v.slot_seq;
  }
  if (typeof v.not_understood === 'number' && Number.isInteger(v.not_understood) && v.not_understood >= 0) {
    state.not_understood = v.not_understood;
  }
  return state;
}
