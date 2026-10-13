import { after } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { registerInbound, replyBotDisabled, replyToInbound } from '@/lib/whatsapp/inbound';
import { isValidTwilioRequest, readTwilioParams } from '@/lib/whatsapp/twilio';
import { reportError } from '@/lib/observability';
import * as Sentry from '@sentry/nextjs';

// Webhook de Twilio para mensajes entrantes de WhatsApp ("When a message comes in").
// El middleware excluye /api/whatsapp: aquí no hay sesión de usuario, la
// autenticación es la firma X-Twilio-Signature.

// Tiempo para que after() termine (espera del candado + Claude con herramientas + envío por Twilio).
export const maxDuration = 60;

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export async function POST(request: Request) {
  const params = await readTwilioParams(request);
  if (!isValidTwilioRequest(request, params)) {
    return new Response('Firma inválida', { status: 403 });
  }

  const supabase = createAdminClient();
  let result;
  try {
    result = await registerInbound(supabase, params);
  } catch (error) {
    // 500 => Twilio reintenta; el registro es idempotente por MessageSid.
    reportError('Error registrando el mensaje de WhatsApp:', error, { where: 'webhook.registerInbound' });
    return new Response('Error interno', { status: 500 });
  }

  if (result.kind === 'stored' && result.reply) {
    const { conversationId, text, reply } = result;
    after(async () => {
      try {
        await replyToInbound(supabase, { conversationId, text, reply });
      } catch (error) {
        reportError('Error respondiendo al mensaje de WhatsApp:', error, { where: 'webhook.reply' });
      }
      // En Vercel la función termina al acabar after(): vaciar la cola de Sentry.
      await Sentry.flush(2000);
    });
  }

  // Consultorio sin bot en su plan: no se guardó nada; texto fijo al paciente
  // (como mucho una vez cada 24 h por número).
  if (result.kind === 'bot_disabled') {
    const { clinicId, clinicNumber, patientPhone } = result;
    after(async () => {
      try {
        await replyBotDisabled(supabase, { clinicId, clinicNumber, patientPhone });
      } catch (error) {
        reportError('Error respondiendo a un consultorio sin bot:', error, {
          where: 'webhook.replyBotDisabled',
          clinicId,
        });
      }
      await Sentry.flush(2000);
    });
  }

  // TwiML vacío de inmediato: la respuesta (bot o texto fijo) sale por la API REST.
  return new Response(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}
