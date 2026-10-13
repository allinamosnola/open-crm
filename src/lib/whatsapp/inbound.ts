import 'server-only';

import { handleMessage, type BotDeps } from '@/lib/bot/agent';
import {
  BOT_DISABLED_REPLY,
  BOT_ERROR_REPLY,
  MEDIA_ONLY_REPLY,
  SUBSCRIPTION_INACTIVE_REPLY,
} from '@/lib/bot/replies';
import { createSupabaseBotRepository } from '@/lib/bot/repository-supabase';
import type { AdminClient } from '@/lib/supabase/admin';

import { sendBotReply, type Sender } from './outbound';
import { sendWhatsApp } from './twilio';
import { normalizeWhatsAppNumber } from './phone';
import {
  claimDisabledReply,
  getBotContext,
  registerInboundMessage,
  releaseDisabledReply,
} from './repository';
import { reportError } from '@/lib/observability';

// Lógica del webhook de mensajes entrantes, sin HTTP (la ruta
// src/app/api/whatsapp/route.ts solo valida la firma y responde a Twilio).

// Cómo se responde a un mensaje guardado:
//   'bot'                   -> el agente con Claude;
//   'subscription_inactive' -> texto fijo sin IA (suscripción vencida o cancelada);
//   'media_only'            -> texto fijo pidiendo que escriba (llegó solo multimedia).
export type InboundReply = 'bot' | 'subscription_inactive' | 'media_only';

export type InboundResult =
  // Sin respuesta: parámetros inválidos o número "To" que no es de ningún consultorio.
  | { kind: 'ignored'; reason: 'invalid_params' | 'unknown_clinic' }
  // El plan de la cuenta no incluye el bot: el mensaje no se guarda (ni
  // paciente, ni conversación, ni mensaje); se responde BOT_DISABLED_REPLY con
  // replyBotDisabled (como mucho una vez cada 24 h por número).
  | {
      kind: 'bot_disabled';
      clinicId: string;
      // Número del consultorio ("To" del webhook) y del paciente ("From" original).
      clinicNumber: string;
      patientPhone: string;
    }
  | { kind: 'duplicate' }
  | {
      kind: 'stored';
      conversationId: string;
      patientId: string;
      // Texto que recibe el bot (vacío si solo llegó multimedia).
      text: string;
      // null si no se responde (bot pausado o mensaje vacío).
      reply: InboundReply | null;
    };

// Guarda el mensaje entrante (idempotente por MessageSid), salvo que el
// consultorio no tenga bot en su plan: entonces no se guarda nada y la ruta
// responde un texto fijo (replyBotDisabled). Si el número no es
// de ningún paciente del consultorio, se crea uno "por identificar". El
// paciente se busca con el teléfono normalizado (+521 -> +52, en SQL); a la
// conversación se le responde en el "From" original.
export async function registerInbound(
  supabase: AdminClient,
  params: Record<string, string>,
): Promise<InboundResult> {
  const messageSid = params.MessageSid ?? params.SmsMessageSid;
  const from = normalizeWhatsAppNumber(params.From);
  const to = normalizeWhatsAppNumber(params.To);
  if (!messageSid || !from || !to) {
    console.warn('Webhook de WhatsApp con parámetros inválidos', {
      messageSid,
      from: params.From,
      to: params.To,
    });
    return { kind: 'ignored', reason: 'invalid_params' };
  }

  const text = (params.Body ?? '').trim();
  const numMedia = Number.parseInt(params.NumMedia ?? '0', 10) || 0;
  // El bot solo entiende texto; los adjuntos se registran para que la recepción los vea en Twilio.
  const body = text || (numMedia > 0 ? '[Mensaje multimedia]' : '');

  const result = await registerInboundMessage(supabase, { to, from, messageSid, body });

  if (result.status === 'unknown_clinic') {
    console.warn(`Mensaje de WhatsApp descartado: el número ${to} no es de ningún consultorio`);
    return { kind: 'ignored', reason: 'unknown_clinic' };
  }
  if (result.status === 'bot_disabled') {
    console.warn(
      `Mensaje de WhatsApp sin guardar: el consultorio del número ${to} no tiene bot en su plan (se responde el texto fijo)`,
    );
    return {
      kind: 'bot_disabled',
      clinicId: result.clinicId!,
      clinicNumber: to,
      patientPhone: from,
    };
  }
  if (result.status === 'duplicate') return { kind: 'duplicate' };

  const reply = decideReply({
    botPaused: result.botPaused,
    clinicActive: result.clinicActive,
    text,
    body,
  });
  if (reply === 'subscription_inactive') {
    console.warn(
      `Consultorio ${result.clinicId} con suscripción inactiva: se guarda el mensaje y se responde sin IA`,
    );
  }

  return {
    kind: 'stored',
    conversationId: result.conversationId!,
    patientId: result.patientId!,
    text,
    reply,
  };
}

// Único sitio donde se decide si (y cómo) se responde a un mensaje guardado.
// null = no se responde y no hace falta programar nada.
export function decideReply(state: {
  botPaused: boolean;
  clinicActive: boolean;
  // Texto del paciente (vacío si solo llegó multimedia).
  text: string;
  // Lo que se guardó (texto o '[Mensaje multimedia]'); vacío = mensaje vacío.
  body: string;
}): InboundReply | null {
  // La recepción tomó la conversación (o el mensaje llegó vacío): no se responde.
  if (state.botPaused || !state.body) return null;
  if (!state.clinicActive) return 'subscription_inactive';
  return state.text ? 'bot' : 'media_only';
}

const FIXED_REPLIES: Record<Exclude<InboundReply, 'bot'>, string> = {
  subscription_inactive: SUBSCRIPTION_INACTIVE_REPLY,
  media_only: MEDIA_ONLY_REPLY,
};

// Responde a un mensaje guardado (bot o texto fijo) y lo envía. Se llama con
// after() para no hacer esperar a Twilio (timeout de 15 s) mientras responde Claude.
export async function replyToInbound(
  supabase: AdminClient,
  params: { conversationId: string; text: string; reply: InboundReply },
  options: { send?: Sender; bot?: Partial<BotDeps> } = {},
): Promise<void> {
  const context = await getBotContext(supabase, params.conversationId);
  if (!context) return;
  // La recepción pudo tomar la conversación mientras llegaba este mensaje.
  if (context.botPaused) return;
  if (!context.clinicNumber) {
    reportError('El consultorio no tiene número de WhatsApp', new Error('clinic_without_whatsapp_number'), {
      where: 'inbound.replyToInbound',
      clinicId: context.clinicId,
    });
    return;
  }

  let body: string;
  if (params.reply === 'bot') {
    try {
      body = await handleMessage(params.conversationId, params.text, {
        repo: createSupabaseBotRepository(supabase),
        ...options.bot,
      });
    } catch (error) {
      reportError('Error del bot procesando el mensaje:', error, {
        where: 'inbound.bot',
        clinicId: context.clinicId,
      });
      body = BOT_ERROR_REPLY;
    }
  } else {
    body = FIXED_REPLIES[params.reply];
  }
  // '' = el agente decidió no responder (p. ej. otro turno ya contestó).
  if (!body) return;

  const sent = await sendBotReply(
    supabase,
    {
      clinicId: context.clinicId,
      conversationId: context.conversationId,
      from: context.clinicNumber,
      // conversations.phone = "From" original de Twilio.
      to: context.patientPhone,
      body,
    },
    options.send,
  );
  if (sent.status === 'failed') {
    reportError(
      `No se pudo enviar la respuesta del bot (error ${sent.errorCode})`,
      new Error(`bot_reply_failed_${sent.errorCode}`),
      { where: 'inbound.sendBotReply', clinicId: context.clinicId },
    );
  }
}

// Responde BOT_DISABLED_REPLY al paciente de un consultorio sin bot. No hay
// conversación ni se guarda el mensaje, así que se envía directo por Twilio
// (sin sendBotReply). Solo una vez cada 24 h por (consultorio, número): el
// turno se reserva antes de enviar, así que si Twilio falla no se reintenta
// hasta pasadas las 24 h (evita reenviar en cada mensaje). Se llama con after().
export async function replyBotDisabled(
  supabase: AdminClient,
  params: { clinicId: string; clinicNumber: string; patientPhone: string },
  options: { send?: Sender } = {},
): Promise<void> {
  const claimed = await claimDisabledReply(supabase, {
    clinicId: params.clinicId,
    from: params.patientPhone,
  });
  if (!claimed) return;

  // Si el envío falla (Twilio rechaza o el sender lanza) el turno se libera: el
  // siguiente mensaje del paciente vuelve a intentarlo en lugar de esperar 24 h.
  const release = () =>
    releaseDisabledReply(supabase, { clinicId: params.clinicId, from: params.patientPhone }).catch(
      (error) =>
        reportError('No se pudo liberar el turno de la respuesta sin bot:', error, {
          where: 'inbound.replyBotDisabled.release',
          clinicId: params.clinicId,
        }),
    );

  const send = options.send ?? sendWhatsApp;
  let sent;
  try {
    sent = await send({ from: params.clinicNumber, to: params.patientPhone, body: BOT_DISABLED_REPLY });
  } catch (error) {
    await release();
    throw error;
  }
  if (sent.status === 'failed') {
    await release();
    reportError(
      `No se pudo enviar la respuesta de consultorio sin bot (error ${sent.errorCode})`,
      new Error(`bot_disabled_reply_failed_${sent.errorCode}`),
      { where: 'inbound.replyBotDisabled', clinicId: params.clinicId },
    );
  }
}
