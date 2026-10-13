import 'server-only';

import twilio from 'twilio';

import { toWhatsAppAddress } from './phone';
import { reportError } from '@/lib/observability';

// Estados que guardamos en messages.status (check de la migración).
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';

let client: twilio.Twilio | null = null;

// Cliente REST de Twilio, creado al primer uso (el build no necesita las variables).
function getClient(): twilio.Twilio {
  if (!client) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error('Faltan TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN');
    }
    client = twilio(accountSid, authToken);
  }
  return client;
}

// URL pública de la app (ngrok en desarrollo), sin "/" final. Twilio firma la
// URL que él llamó, no la que ve Next detrás del proxy.
export function publicUrl(path: string): string {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '');
  if (!base) throw new Error('Falta PUBLIC_BASE_URL');
  return `${base}${path}`;
}

// Lee el body application/x-www-form-urlencoded que manda Twilio.
export async function readTwilioParams(request: Request): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === 'string') params[key] = value;
  });
  return params;
}

// Valida X-Twilio-Signature contra PUBLIC_BASE_URL + ruta (+ query) de la petición.
export function isValidTwilioRequest(request: Request, params: Record<string, string>): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.headers.get('x-twilio-signature');
  if (!authToken || !signature) return false;
  const { pathname, search } = new URL(request.url);
  return twilio.validateRequest(authToken, signature, publicUrl(`${pathname}${search}`), params);
}

// Traduce los estados de Twilio a los que guardamos. null = ignorar.
export function mapTwilioStatus(status: string | null | undefined): MessageStatus | null {
  switch (status) {
    case 'accepted':
    case 'scheduled':
    case 'queued':
    case 'sending':
      return 'queued';
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
    case 'undelivered':
    case 'canceled':
      return 'failed';
    default:
      return null;
  }
}

export interface SendResult {
  sid: string | null;
  status: MessageStatus;
  errorCode: string | null;
}

// Envía un WhatsApp por la API REST con statusCallback. No lanza por errores de
// Twilio (p. ej. 63016 fuera de la ventana de 24 h): los devuelve como 'failed'.
export async function sendWhatsApp(params: {
  from: string; // E.164 del consultorio
  to: string; // E.164 del paciente
  body: string;
}): Promise<SendResult> {
  try {
    const message = await getClient().messages.create({
      from: toWhatsAppAddress(params.from),
      to: toWhatsAppAddress(params.to),
      body: params.body,
      statusCallback: publicUrl('/api/whatsapp/status'),
    });
    return {
      sid: message.sid,
      status: mapTwilioStatus(message.status) ?? 'queued',
      errorCode: message.errorCode != null ? String(message.errorCode) : null,
    };
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    reportError('Twilio rechazó el envío:', error, {
      where: 'twilio.send',
      extra: { twilioCode: code != null ? String(code) : 'unknown' },
    });
    return { sid: null, status: 'failed', errorCode: code != null ? String(code) : 'unknown' };
  }
}
