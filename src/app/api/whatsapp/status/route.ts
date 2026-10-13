import { createAdminClient } from '@/lib/supabase/admin';
import { applyStatusUpdate } from '@/lib/whatsapp/repository';
import { isValidTwilioRequest, mapTwilioStatus, readTwilioParams } from '@/lib/whatsapp/twilio';
import { reportError } from '@/lib/observability';

// Callback de estado de Twilio (statusCallback de los mensajes salientes):
// sent / delivered / read / failed (+ ErrorCode). También valida la firma.
export async function POST(request: Request) {
  const params = await readTwilioParams(request);
  if (!isValidTwilioRequest(request, params)) {
    return new Response('Firma inválida', { status: 403 });
  }

  const sid = params.MessageSid ?? params.SmsSid;
  const status = mapTwilioStatus(params.MessageStatus ?? params.SmsStatus);
  if (!sid || !status) return new Response(null, { status: 204 });

  try {
    await applyStatusUpdate(createAdminClient(), {
      sid,
      status,
      errorCode: params.ErrorCode || null,
    });
  } catch (error) {
    reportError('Error actualizando el estado del mensaje:', error, { where: 'webhook.status' });
    return new Response('Error interno', { status: 500 });
  }
  return new Response(null, { status: 204 });
}
