import 'server-only';

import type { AdminClient } from '@/lib/supabase/admin';

import { insertBotMessage, recordDelivery } from './repository';
import { sendWhatsApp, type SendResult } from './twilio';

// Función que entrega el mensaje (Twilio en producción; el simulador
// scripts/bot-chat.ts y Wechaty pasan la suya).
export type Sender = (params: { from: string; to: string; body: string }) => Promise<SendResult>;

// Envía por Twilio un mensaje que ya está guardado en messages (estado 'queued')
// y registra el sid y el estado inicial o el error (p. ej. 63016).
export async function deliverMessage(
  supabase: AdminClient,
  params: { messageId: string; from: string; to: string; body: string },
  send: Sender = sendWhatsApp,
): Promise<SendResult> {
  const result = await send({ from: params.from, to: params.to, body: params.body });
  await recordDelivery(supabase, params.messageId, result);
  return result;
}

// Guarda y envía una respuesta del bot (sender = 'bot').
export async function sendBotReply(
  supabase: AdminClient,
  params: { clinicId: string; conversationId: string; from: string; to: string; body: string },
  send: Sender = sendWhatsApp,
): Promise<SendResult> {
  const messageId = await insertBotMessage(supabase, {
    clinicId: params.clinicId,
    conversationId: params.conversationId,
    body: params.body,
  });
  return deliverMessage(
    supabase,
    { messageId, from: params.from, to: params.to, body: params.body },
    send,
  );
}

// Reintento manual de un mensaje saliente que quedó 'failed' (botón del panel).
// Lo vuelve a poner en 'queued' solo si sigue 'failed': si dos personas pulsan
// a la vez, solo una lo envía. Devuelve null si el mensaje ya no está fallido.
export async function redeliverFailedMessage(
  supabase: AdminClient,
  params: { messageId: string; from: string; to: string; body: string },
  send: Sender = sendWhatsApp,
): Promise<SendResult | null> {
  const { data, error } = await supabase
    .from('messages')
    .update({ status: 'queued', error_code: null, twilio_sid: null })
    .eq('id', params.messageId)
    .eq('direction', 'out')
    .eq('status', 'failed')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`No se pudo preparar el reintento: ${error.message}`);
  if (!data) return null;
  return deliverMessage(supabase, params, send);
}
