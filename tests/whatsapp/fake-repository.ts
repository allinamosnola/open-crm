// Versión en memoria de src/lib/whatsapp/repository.ts con la misma semántica
// que las funciones SQL whatsapp_register_inbound (con normalize_phone) y
// whatsapp_update_status (verificadas aparte contra Postgres con PGlite) y
// whatsapp_claim_disabled_reply (supabase/migrations/20261001000005).

import { normalizePhone } from '@/lib/whatsapp/phone';
import type { BotContext, InboundRegistration } from '@/lib/whatsapp/repository';
import type { MessageStatus } from '@/lib/whatsapp/twilio';

export interface FakeClinic {
  id: string;
  whatsapp_from: string | null;
  subscription_status: 'trial' | 'active' | 'past_due' | 'canceled';
  // Resultado de account_entitlements(...).bot_enabled para la cuenta del
  // consultorio (true si no se indica).
  bot_enabled?: boolean;
}
export interface FakePatient {
  id: string;
  clinic_id: string;
  phone: string;
  full_name: string | null;
  status: 'active' | 'unidentified';
}
export interface FakeConversation {
  id: string;
  clinic_id: string;
  patient_id: string;
  phone: string;
  bot_paused: boolean;
  unread_count: number;
  last_message_at: string | null;
}
export interface FakeMessage {
  id: string;
  clinic_id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  sender: 'patient' | 'bot' | 'staff';
  body: string;
  twilio_sid: string | null;
  status: MessageStatus;
  error_code: string | null;
}

let seq = 0;
const newId = (prefix: string) => `${prefix}-${++seq}`;
const RANK = ['queued', 'sent', 'delivered', 'read'];

export const db = {
  clinics: [] as FakeClinic[],
  patients: [] as FakePatient[],
  conversations: [] as FakeConversation[],
  messages: [] as FakeMessage[],
  // whatsapp_disabled_replies: clave `${clinic_id}|${teléfono normalizado}` -> last_replied_at (ms).
  disabledReplies: new Map<string, number>(),
  reset() {
    seq = 0;
    this.clinics = [];
    this.patients = [];
    this.conversations = [];
    this.messages = [];
    this.disabledReplies = new Map();
  },
};

function touch(conversationId: string, direction: 'in' | 'out') {
  const c = db.conversations.find((x) => x.id === conversationId)!;
  c.last_message_at = new Date().toISOString();
  if (direction === 'in') c.unread_count += 1;
}

export async function registerInboundMessage(
  _supabase: unknown,
  params: { to: string; from: string; messageSid: string; body: string },
): Promise<InboundRegistration> {
  const clinic = db.clinics.find((c) => c.whatsapp_from === params.to);
  if (!clinic) {
    return {
      status: 'unknown_clinic',
      clinicId: null,
      clinicActive: false,
      patientId: null,
      conversationId: null,
      messageId: null,
      botPaused: false,
    };
  }
  // Sin bot en el plan no se guarda nada (ni paciente, ni conversación, ni mensaje).
  if (!(clinic.bot_enabled ?? true)) {
    return {
      status: 'bot_disabled',
      clinicId: clinic.id,
      clinicActive: false,
      patientId: null,
      conversationId: null,
      messageId: null,
      botPaused: false,
    };
  }
  // Como normalize_phone(): el paciente se busca y se crea con +52 (sin el 1).
  const phone = normalizePhone(params.from);
  let patient = db.patients.find((p) => p.clinic_id === clinic.id && p.phone === phone);
  if (!patient) {
    patient = {
      id: newId('patient'),
      clinic_id: clinic.id,
      phone,
      full_name: null,
      status: 'unidentified',
    };
    db.patients.push(patient);
  }
  let conversation = db.conversations.find((c) => c.patient_id === patient.id);
  if (!conversation) {
    conversation = {
      id: newId('conversation'),
      clinic_id: clinic.id,
      patient_id: patient.id,
      phone: params.from,
      bot_paused: false,
      unread_count: 0,
      last_message_at: null,
    };
    db.conversations.push(conversation);
  }
  let messageId: string | null = null;
  if (!db.messages.some((m) => m.twilio_sid === params.messageSid)) {
    messageId = newId('message');
    db.messages.push({
      id: messageId,
      clinic_id: clinic.id,
      conversation_id: conversation.id,
      direction: 'in',
      sender: 'patient',
      body: params.body,
      twilio_sid: params.messageSid,
      status: 'received',
      error_code: null,
    });
    touch(conversation.id, 'in');
    // Se responde al último "From" con el que escribió el paciente.
    conversation.phone = params.from;
  }
  return {
    status: messageId ? 'stored' : 'duplicate',
    clinicId: clinic.id,
    clinicActive: ['trial', 'active'].includes(clinic.subscription_status),
    patientId: patient.id,
    conversationId: conversation.id,
    messageId,
    botPaused: conversation.bot_paused,
  };
}

export async function getBotContext(
  _supabase: unknown,
  conversationId: string,
): Promise<BotContext | null> {
  const c = db.conversations.find((x) => x.id === conversationId);
  if (!c) return null;
  const clinic = db.clinics.find((x) => x.id === c.clinic_id)!;
  return {
    conversationId: c.id,
    clinicId: c.clinic_id,
    botPaused: c.bot_paused,
    patientPhone: c.phone,
    clinicNumber: clinic.whatsapp_from,
  };
}

export async function insertBotMessage(
  _supabase: unknown,
  params: { clinicId: string; conversationId: string; body: string },
): Promise<string> {
  const id = newId('message');
  db.messages.push({
    id,
    clinic_id: params.clinicId,
    conversation_id: params.conversationId,
    direction: 'out',
    sender: 'bot',
    body: params.body,
    twilio_sid: null,
    status: 'queued',
    error_code: null,
  });
  touch(params.conversationId, 'out');
  return id;
}

export async function recordDelivery(
  _supabase: unknown,
  messageId: string,
  result: { sid: string | null; status: MessageStatus; errorCode: string | null },
): Promise<void> {
  const m = db.messages.find((x) => x.id === messageId)!;
  m.twilio_sid = result.sid;
  m.status = result.status;
  m.error_code = result.errorCode;
}

export async function applyStatusUpdate(
  _supabase: unknown,
  params: { sid: string; status: MessageStatus; errorCode: string | null },
): Promise<boolean> {
  const m = db.messages.find((x) => x.twilio_sid === params.sid && x.direction === 'out');
  if (!m || m.status === 'failed') return false;
  const advances =
    params.status === 'failed' || RANK.indexOf(params.status) > RANK.indexOf(m.status);
  if (!advances) return false;
  m.status = params.status;
  m.error_code = params.errorCode ?? m.error_code;
  return true;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function releaseDisabledReply(
  _supabase: unknown,
  params: { clinicId: string; from: string },
): Promise<void> {
  db.disabledReplies.delete(`${params.clinicId}|${normalizePhone(params.from)}`);
}

export async function claimDisabledReply(
  _supabase: unknown,
  params: { clinicId: string; from: string },
): Promise<boolean> {
  const key = `${params.clinicId}|${normalizePhone(params.from)}`;
  const last = db.disabledReplies.get(key);
  const now = Date.now();
  if (last !== undefined && last > now - DAY_MS) return false;
  db.disabledReplies.set(key, now);
  return true;
}
