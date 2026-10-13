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
