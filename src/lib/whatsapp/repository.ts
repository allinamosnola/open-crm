import 'server-only';

import type { AdminClient } from '@/lib/supabase/admin';

import type { MessageStatus } from './twilio';

// Acceso a datos del canal de WhatsApp con la service role. Aislado en este
// módulo para que la lógica del webhook se pruebe sin base de datos (vitest lo
// reemplaza por una versión en memoria). La parte transaccional vive en las
// funciones SQL whatsapp_register_inbound y whatsapp_update_status.

export interface InboundRegistration {
  // 'bot_disabled': el plan de la cuenta no incluye el bot; no se guardó nada
  // (ni paciente, ni conversación, ni mensaje).
  status: 'unknown_clinic' | 'bot_disabled' | 'duplicate' | 'stored';
  clinicId: string | null;
  clinicActive: boolean;
  patientId: string | null;
  conversationId: string | null;
  messageId: string | null;
  botPaused: boolean;
}

export async function registerInboundMessage(
  supabase: AdminClient,
  params: { to: string; from: string; messageSid: string; body: string },
): Promise<InboundRegistration> {
  const { data, error } = await supabase.rpc('whatsapp_register_inbound', {
    p_to: params.to,
    p_from: params.from,
    p_message_sid: params.messageSid,
    p_body: params.body,
  });
  if (error) throw new Error(`whatsapp_register_inbound: ${error.message}`);
  const row = data?.[0];
  if (!row) throw new Error('whatsapp_register_inbound no devolvió resultado');
  return {
    status: row.status as InboundRegistration['status'],
    clinicId: row.clinic_id,
    clinicActive: row.clinic_active ?? false,
    patientId: row.patient_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    botPaused: row.bot_paused ?? false,
  };
}

// Reserva la respuesta fija de un consultorio sin bot para el número del
// paciente: true si no se le respondió en las últimas 24 h (queda registrada la
// de ahora), false si ya se le respondió. Solo guarda (consultorio, teléfono
// normalizado, fecha); nunca el contenido del mensaje.
export async function claimDisabledReply(
  supabase: AdminClient,
  params: { clinicId: string; from: string },
): Promise<boolean> {
  const { data, error } = await supabase.rpc('whatsapp_claim_disabled_reply', {
    p_clinic_id: params.clinicId,
    p_from: params.from,
  });
  if (error) throw new Error(`whatsapp_claim_disabled_reply: ${error.message}`);
  return data === true;
}

// Libera el turno reservado por claimDisabledReply cuando el envío falló, para que
// el siguiente mensaje del paciente pueda volver a intentarlo.
export async function releaseDisabledReply(
  supabase: AdminClient,
  params: { clinicId: string; from: string },
): Promise<void> {
  const { error } = await supabase.rpc('whatsapp_release_disabled_reply', {
    p_clinic_id: params.clinicId,
    p_from: params.from,
  });
  if (error) throw new Error(`whatsapp_release_disabled_reply: ${error.message}`);
}

export interface BotContext {
  conversationId: string;
  clinicId: string;
  botPaused: boolean;
  patientPhone: string;
  clinicNumber: string | null;
}

// Estado actual de la conversación (se relee justo antes de responder: la
// recepción pudo pausar el bot mientras tanto).
export async function getBotContext(
  supabase: AdminClient,
  conversationId: string,
): Promise<BotContext | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, clinic_id, bot_paused, phone, clinic:clinics(whatsapp_from)')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`);
  if (!data) return null;
  return {
    conversationId: data.id,
    clinicId: data.clinic_id,
    botPaused: data.bot_paused,
    patientPhone: data.phone,
    clinicNumber: data.clinic?.whatsapp_from ?? null,
  };
}

// Guarda un mensaje saliente del bot en estado 'queued' antes de enviarlo.
export async function insertBotMessage(
  supabase: AdminClient,
  params: { clinicId: string; conversationId: string; body: string },
): Promise<string> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      clinic_id: params.clinicId,
      conversation_id: params.conversationId,
      direction: 'out',
      sender: 'bot',
      body: params.body,
      status: 'queued',
    })
    .select('id')
    .single();
  if (error) throw new Error(`No se pudo guardar el mensaje del bot: ${error.message}`);
  return data.id;
}

// Resultado del envío por la API REST (sid, estado inicial o error).
export async function recordDelivery(
  supabase: AdminClient,
  messageId: string,
  result: { sid: string | null; status: MessageStatus; errorCode: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .update({ twilio_sid: result.sid, status: result.status, error_code: result.errorCode })
    .eq('id', messageId);
  if (error) throw new Error(`No se pudo registrar el envío: ${error.message}`);
}

// Callback de estado: solo avanza el estado (ver whatsapp_update_status).
export async function applyStatusUpdate(
  supabase: AdminClient,
  params: { sid: string; status: MessageStatus; errorCode: string | null },
): Promise<boolean> {
  const { data, error } = await supabase.rpc('whatsapp_update_status', {
    p_sid: params.sid,
    p_status: params.status,
    ...(params.errorCode ? { p_error_code: params.errorCode } : {}),
  });
  if (error) throw new Error(`whatsapp_update_status: ${error.message}`);
  return data === true;
}
