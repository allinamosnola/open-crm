import { randomBytes } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';
import twilio from 'twilio';

// Simula a Twilio llamando al webhook de WhatsApp. La firma se calcula igual que
// la valida src/lib/whatsapp/twilio.ts (isValidTwilioRequest): HMAC del Auth Token
// sobre PUBLIC_BASE_URL + ruta + parámetros del formulario. Ese módulo importa
// 'server-only', así que aquí se usa directamente el SDK de Twilio.

export function twilioSignature(path: string, params: Record<string, string>): string {
  const token = process.env.E2E_TWILIO_AUTH_TOKEN!;
  return twilio.getExpectedTwilioSignature(token, `${process.env.E2E_BASE_URL}${path}`, params);
}

export function inboundParams(opts: { from: string; to: string; body: string }) {
  return {
    MessageSid: `SM${randomBytes(16).toString('hex')}`,
    AccountSid: 'ACe2e00000000000000000000000000000',
    From: `whatsapp:${opts.from}`,
    To: `whatsapp:${opts.to}`,
    Body: opts.body,
    NumMedia: '0',
  };
}

export async function postTwilioWebhook(
  request: APIRequestContext,
  params: Record<string, string>,
  signature = twilioSignature('/api/whatsapp', params),
) {
  return request.post('/api/whatsapp', {
    form: params,
    headers: { 'X-Twilio-Signature': signature },
  });
}
