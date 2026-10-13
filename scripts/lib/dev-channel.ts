// Canal de desarrollo compartido por scripts/bot-chat.ts (simulador en la
// terminal) y scripts/wechaty-dev.ts: hace lo mismo que el webhook de Twilio
// (registerInbound + replyToInbound) contra Supabase local, pero entrega la
// respuesta con la función del canal en vez de la API de Twilio.
//
// Estos scripts corren con `tsx --conditions=react-server` para que
// 'server-only' resuelva al módulo vacío fuera de Next.

import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { createAdminClient, type AdminClient } from '../../src/lib/supabase/admin';
import { registerInbound, replyToInbound } from '../../src/lib/whatsapp/inbound';
import type { Sender } from '../../src/lib/whatsapp/outbound';

export interface DevChannel {
  supabase: AdminClient;
  clinic: { id: string; name: string; whatsapp_from: string };
}

// Lee DEV_CLINIC_ID y el consultorio. Exige Supabase local (NEXT_PUBLIC_SUPABASE_URL
// + SUPABASE_SERVICE_ROLE_KEY) y que el consultorio tenga número de WhatsApp,
// que es con lo que el webhook identifica al consultorio.
export async function openDevChannel(): Promise<DevChannel> {
  const clinicId = process.env.DEV_CLINIC_ID;
  if (!clinicId) {
    throw new Error(
      'Falta DEV_CLINIC_ID en .env (id del consultorio de prueba; con el seed, f0000000-0000-0000-0000-00000000000a)',
    );
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url) && process.env.DEV_ALLOW_REMOTE_DB !== 'true') {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL (${url || 'vacía'}) no es Supabase local. Estos scripts escriben citas y ` +
        'mensajes: úsalos contra `npx supabase start` (o define DEV_ALLOW_REMOTE_DB=true si de verdad quieres otra base).',
    );
  }
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('clinics')
    .select('id, name, whatsapp_from')
    .eq('id', clinicId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el consultorio: ${error.message}`);
  if (!data) throw new Error(`No existe el consultorio ${clinicId}`);
  if (!data.whatsapp_from) {
    throw new Error(`El consultorio ${data.name} no tiene whatsapp_from; el canal lo necesita para identificarlo`);
  }
  return { supabase, clinic: { id: data.id, name: data.name, whatsapp_from: data.whatsapp_from } };
}

// Registra un mensaje entrante como si llegara por el webhook y responde con la
// misma lógica (bot, texto fijo o nada si el bot está pausado).
export async function simulateInbound(
  channel: DevChannel,
  params: { from: string; body: string; numMedia?: number; messageSid?: string },
  send: Sender,
): Promise<'replied' | 'paused' | 'ignored'> {
  const result = await registerInbound(channel.supabase, {
    MessageSid: params.messageSid ?? `SIM${randomUUID().replace(/-/g, '')}`,
    From: `whatsapp:${params.from}`,
    To: `whatsapp:${channel.clinic.whatsapp_from}`,
    Body: params.body,
    NumMedia: String(params.numMedia ?? 0),
  });
  // Sin bot en el plan ('bot_disabled') el canal de desarrollo no manda el texto
  // fijo de replyBotDisabled (eso solo lo hace el webhook de Twilio).
  if (result.kind !== 'stored') return 'ignored';
  if (!result.reply) return 'paused';
  await replyToInbound(
    channel.supabase,
    { conversationId: result.conversationId, text: result.text, reply: result.reply },
    { send },
  );
  return 'replied';
}
