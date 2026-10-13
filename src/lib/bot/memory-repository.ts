// BotRepository en memoria, con la misma semántica que la versión de Supabase
// (restricción de traslapes, candado con vencimiento, acotado por consultorio y
// paciente). Lo usan los tests con vitest y el eval del modelo
// (scripts/eval-bot.ts): no toca la base de datos.

import type { AttentionCategory, BusinessHours, PatientStatus } from '@/lib/db/types';

import type { BotRepository, ClinicInfo, HistoryMessage, TurnLock, UpcomingAppointment, WriteResult } from './repository';
import type { BotState } from './state';

export interface MemoryAppointment {
  id: string;
  clinic_id: string;
  patient_id: string;
  dentist_id: string;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  source: 'panel' | 'whatsapp';
}

export interface MemoryConversation {
  id: string;
  clinic_id: string;
  patient_id: string;
  bot_paused: boolean;
  bot_state: Record<string, unknown>;
  needs_attention: boolean;
  attention_category: AttentionCategory | null;
  attention_reason: string | null;
  escalated_at: string | null;
  lease: { token: string; until: number } | null;
}

export interface MemoryData {
  clinics: ClinicInfo[];
  dentists: { id: string; clinic_id: string; full_name: string; active: boolean }[];
  patients: { id: string; clinic_id: string; full_name: string | null; status: PatientStatus; phone: string | null }[];
  appointments: MemoryAppointment[];
  conversations: MemoryConversation[];
  messages: (HistoryMessage & { conversation_id: string })[];
}

export interface MemoryBotRepository extends BotRepository {
  data: MemoryData;
  // Guarda un mensaje en la conversación (como lo haría el webhook).
  addMessage(conversationId: string, sender: HistoryMessage['sender'], body: string, at?: Date): void;
}

const overlaps = (a: { starts_at: string; ends_at: string }, b: { starts_at: string; ends_at: string }) =>
  new Date(a.starts_at) < new Date(b.ends_at) && new Date(b.starts_at) < new Date(a.ends_at);

export function createMemoryBotRepository(
  seed: Partial<MemoryData> = {},
  options: { clock?: () => number } = {},
): MemoryBotRepository {
  const clock = options.clock ?? (() => Date.now());
  const data: MemoryData = {
    clinics: seed.clinics ?? [],
    dentists: seed.dentists ?? [],
    patients: seed.patients ?? [],
    appointments: seed.appointments ?? [],
    conversations: seed.conversations ?? [],
    messages: seed.messages ?? [],
  };
  let seq = 0;
  let messageSeq = 0;
  const newId = (prefix: string) => `${prefix}-${++seq}`;

  // Misma regla que appointments_no_overlap: sin traslapes por dentista entre
  // citas no canceladas (ignorando la propia cita al moverla).
  const collides = (candidate: Omit<MemoryAppointment, 'id' | 'status' | 'source'>, ignoreId?: string) =>
    data.appointments.some(
      (a) =>
        a.id !== ignoreId &&
        a.status !== 'cancelled' &&
        a.dentist_id === candidate.dentist_id &&
        overlaps(a, candidate),
    );

  const conversation = (id: string) => data.conversations.find((c) => c.id === id);

  return {
    data,

    addMessage(conversationId, sender, body, at) {
      data.messages.push({
        conversation_id: conversationId,
        direction: sender === 'patient' ? 'in' : 'out',
        sender,
        body,
        // +1 ms por mensaje para que el orden no dependa del reloj.
        created_at: (at ?? new Date(clock() + messageSeq++)).toISOString(),
      });
    },

    async acquireTurn(conversationId, leaseSeconds): Promise<TurnLock> {
      const c = conversation(conversationId);
      if (!c) return { acquired: false };
      if (c.lease && c.lease.until > clock()) return { acquired: false };
      const token = newId('lease');
      c.lease = { token, until: clock() + leaseSeconds * 1000 };
      return { acquired: true, token, state: structuredClone(c.bot_state) };
    },

    async releaseTurn(conversationId, token, state: BotState | null) {
      const c = conversation(conversationId);
      if (!c || c.lease?.token !== token) return false;
      if (state) c.bot_state = structuredClone(state) as unknown as Record<string, unknown>;
      c.lease = null;
      return true;
    },

    async loadTurnContext(conversationId, historyLimit) {
      const c = conversation(conversationId);
      if (!c) return null;
      const clinic = data.clinics.find((x) => x.id === c.clinic_id);
      const patient = data.patients.find((x) => x.id === c.patient_id);
      if (!clinic || !patient) return null;
      const history = data.messages
        .filter((m) => m.conversation_id === conversationId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(-historyLimit)
        .map(({ direction, sender, body, created_at }) => ({ direction, sender, body, created_at }));
      return {
        conversationId,
        botPaused: c.bot_paused,
        clinic: structuredClone(clinic),
        patient: { id: patient.id, full_name: patient.full_name, status: patient.status, phone: patient.phone },
        history,
      };
    },

    async listDentists(clinicId) {
      return data.dentists
        .filter((d) => d.clinic_id === clinicId && d.active)
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
        .map(({ id, full_name }) => ({ id, full_name }));
    },

    async listBusy(clinicId, from, to) {
      return data.appointments
        .filter((a) => a.clinic_id === clinicId && a.status !== 'cancelled' && overlaps(a, { starts_at: from, ends_at: to }))
        .map(({ dentist_id, starts_at, ends_at }) => ({ dentist_id, starts_at, ends_at }));
    },

    async findUsualDentistId(clinicId, patientId) {
      const last = data.appointments
        .filter(
          (a) =>
            a.clinic_id === clinicId &&
            a.patient_id === patientId &&
            ['completed', 'scheduled', 'confirmed'].includes(a.status),
        )
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0];
      return last?.dentist_id ?? null;
    },

    async listUpcomingAppointments(clinicId, patientId, now) {
      return data.appointments
        .filter(
          (a) =>
            a.clinic_id === clinicId &&
            a.patient_id === patientId &&
            (a.status === 'scheduled' || a.status === 'confirmed') &&
            new Date(a.starts_at) > new Date(now),
        )
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .slice(0, 10)
        .map(
          (a): UpcomingAppointment => ({
            id: a.id,
            dentist_id: a.dentist_id,
            dentist_name: data.dentists.find((d) => d.id === a.dentist_id)?.full_name ?? null,
            starts_at: a.starts_at,
            ends_at: a.ends_at,
            status: a.status as UpcomingAppointment['status'],
          }),
        );
    },

    async createAppointment(params): Promise<WriteResult> {
      const candidate = {
        clinic_id: params.clinicId,
        patient_id: params.patientId,
        dentist_id: params.dentistId,
        starts_at: params.startsAt,
        ends_at: params.endsAt,
      };
      if (collides(candidate)) return { ok: false, reason: 'overlap' };
      const id = newId('appt');
      data.appointments.push({ id, ...candidate, status: 'scheduled', source: 'whatsapp' });
      return { ok: true, id };
    },

    async cancelAppointment(params): Promise<WriteResult> {
      const a = data.appointments.find(
        (x) =>
          x.id === params.appointmentId &&
          x.clinic_id === params.clinicId &&
          x.patient_id === params.patientId &&
          (x.status === 'scheduled' || x.status === 'confirmed'),
      );
      if (!a) return { ok: false, reason: 'not_found' };
      a.status = 'cancelled';
      return { ok: true, id: a.id };
    },

    async rescheduleAppointment(params): Promise<WriteResult> {
      const a = data.appointments.find(
        (x) =>
          x.id === params.appointmentId &&
          x.clinic_id === params.clinicId &&
          x.patient_id === params.patientId &&
          (x.status === 'scheduled' || x.status === 'confirmed'),
      );
      if (!a) return { ok: false, reason: 'not_found' };
      const moved = { ...a, dentist_id: params.dentistId, starts_at: params.startsAt, ends_at: params.endsAt };
      if (collides(moved, a.id)) return { ok: false, reason: 'overlap' };
      Object.assign(a, moved, { status: 'scheduled' });
      return { ok: true, id: a.id };
    },

    async savePatientName(params) {
      const p = data.patients.find(
        (x) => x.id === params.patientId && x.clinic_id === params.clinicId && x.status === 'unidentified',
      );
      if (!p) return false;
      p.full_name = params.fullName;
      p.status = 'active';
      return true;
    },

    async escalate(params) {
      const c = conversation(params.conversationId);
      if (!c) throw new Error('La conversación no existe');
      c.bot_paused = true;
      c.needs_attention = true;
      c.attention_category = params.category;
      c.attention_reason = params.reason;
      c.escalated_at = new Date(clock()).toISOString();
    },
  };
}

// Consultorio de ejemplo para tests y eval (horario partido de lunes a viernes).
export const SAMPLE_BUSINESS_HOURS: BusinessHours = {
  mon: [['09:00', '14:00'], ['16:00', '20:00']],
  tue: [['09:00', '14:00'], ['16:00', '20:00']],
  wed: [['09:00', '14:00'], ['16:00', '20:00']],
  thu: [['09:00', '14:00'], ['16:00', '20:00']],
  fri: [['09:00', '14:00'], ['16:00', '20:00']],
  sat: [['09:00', '13:00']],
};

export function emptyConversation(id: string, clinicId: string, patientId: string): MemoryConversation {
  return {
    id,
    clinic_id: clinicId,
    patient_id: patientId,
    bot_paused: false,
    bot_state: {},
    needs_attention: false,
    attention_category: null,
    attention_reason: null,
    escalated_at: null,
    lease: null,
  };
}
