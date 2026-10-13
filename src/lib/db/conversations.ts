'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { describeMessageError } from '@/lib/whatsapp/errors';
import { deliverMessage } from '@/lib/whatsapp/outbound';

import { dbError, throwReadError, validationError } from './errors';
import { BOT_REQUIRED_TO_MANAGE, BOT_REQUIRED_TO_REPLY } from './plan-limits';
import { staffMessageSchema, type StaffMessageInput } from './schemas';
import type {
  ActionResult,
  ConversationListItem,
  ConversationWithPatient,
  MessageStatus,
  MessageWithStaff,
} from './types';
import { reportError } from '@/lib/observability';

// Bandeja de WhatsApp. Todo pasa por la RLS con la sesión del usuario: cada
// quien ve solo las conversaciones de su consultorio. Las crea el webhook.

const PATIENT_EMBED = 'patient:patients(id, full_name, phone, status)';

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

// Conversaciones con el paciente y su último mensaje, las más recientes primero.
export async function listConversations(): Promise<ConversationListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('conversations')
    .select(
      `*, ${PATIENT_EMBED}, last_message:messages(body, direction, sender, status, created_at)`,
    )
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { referencedTable: 'messages', ascending: false })
    .limit(1, { referencedTable: 'messages' })
    .limit(200);
  if (error) throwReadError(error, 'las conversaciones');
  return data;
}

// Conversación de un paciente (pestaña Conversación de la ficha), o null si
// nunca ha escrito.
export async function getConversation(patientId: string): Promise<ConversationWithPatient | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('conversations')
    .select(`*, ${PATIENT_EMBED}`)
    .eq('patient_id', patientId)
    .maybeSingle();
  if (error) throwReadError(error, 'la conversación');
  return data;
}

// Conversación por id (hilo de la bandeja).
export async function getConversationById(id: string): Promise<ConversationWithPatient | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('conversations')
    .select(`*, ${PATIENT_EMBED}`)
    .eq('id', id)
    .maybeSingle();
  if (error) throwReadError(error, 'la conversación');
  return data;
}

// Mensajes del hilo en orden cronológico (los últimos 500).
export async function listMessages(conversationId: string): Promise<MessageWithStaff[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('messages')
    .select('*, staff:staff(id, full_name)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throwReadError(error, 'los mensajes');
  return data.reverse();
}

// Conversaciones que el bot pasó a la recepción y siguen sin resolver
// (sección "Requiere atención" de la bandeja), las más recientes primero.
// Traen attention_category, attention_reason y escalated_at.
export async function listNeedsAttention(): Promise<ConversationListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('conversations')
    .select(
      `*, ${PATIENT_EMBED}, last_message:messages(body, direction, sender, status, created_at)`,
    )
    .eq('needs_attention', true)
    .order('escalated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { referencedTable: 'messages', ascending: false })
    .limit(1, { referencedTable: 'messages' })
    .limit(100);
  if (error) throwReadError(error, 'las conversaciones que requieren atención');
  return data;
}

// Número de conversaciones que requieren atención (contador de la barra lateral).
export async function countNeedsAttention(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('needs_attention', true);
  if (error) throwReadError(error, 'las conversaciones que requieren atención');
  return count ?? 0;
}

// Total de mensajes sin leer del consultorio (contador de la barra lateral).
export async function countUnread(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('conversations')
    .select('unread_count')
    .gt('unread_count', 0);
  if (error) throwReadError(error, 'los mensajes sin leer');
  return data.reduce((total, c) => total + c.unread_count, 0);
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

// Sin bot en el plan (p. ej. bajó de plan y conservó el número) el panel oculta
// la bandeja, pero las server actions se pueden llamar directo: se comprueba
// también aquí, con my_entitlements() del consultorio activo, antes de tocar la
// conversación o de llamar a Twilio. Devuelve null si el consultorio activo
// tiene bot; si no, el ActionResult de error.
async function requireBot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<{ ok: false; error: string } | null> {
  const { data, error } = await supabase.rpc('my_entitlements');
  if (error) return dbError(error);
  if (!data[0]?.bot_enabled) return { ok: false, error: message };
  return null;
}

function revalidateInbox(patientId?: string) {
  revalidatePath('/conversaciones');
  if (patientId) revalidatePath(`/pacientes/${patientId}`);
}

export async function markRead(conversationId: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const denied = await requireBot(supabase, BOT_REQUIRED_TO_MANAGE);
  if (denied) return denied;
  const { data, error } = await supabase
    .from('conversations')
    .update({ unread_count: 0 })
    .eq('id', conversationId)
    .select('id, patient_id')
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return { ok: false, error: 'La conversación no existe o no se puede modificar' };

  revalidateInbox(data.patient_id);
  return { ok: true, data: { id: data.id } };
}

export async function setBotPaused(
  conversationId: string,
  paused: boolean,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const denied = await requireBot(supabase, BOT_REQUIRED_TO_MANAGE);
  if (denied) return denied;
  const { data, error } = await supabase
    .from('conversations')
    .update({ bot_paused: paused })
    .eq('id', conversationId)
    .select('id, patient_id')
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return { ok: false, error: 'La conversación no existe o no se puede modificar' };

  revalidateInbox(data.patient_id);
  return { ok: true, data: { id: data.id } };
}

// "Marcar resuelto": quita la marca de "requiere atención" (se conservan el
// motivo, la categoría y la fecha del último escalamiento). Con
// resumeBot = true también reanuda el bot, que el escalamiento había pausado.
export async function markResolved(
  conversationId: string,
  options: { resumeBot?: boolean } = {},
): Promise<ActionResult<{ id: string; botPaused: boolean }>> {
  const supabase = await createClient();
  const denied = await requireBot(supabase, BOT_REQUIRED_TO_MANAGE);
  if (denied) return denied;
  const { data, error } = await supabase
    .from('conversations')
    .update({
      needs_attention: false,
      ...(options.resumeBot ? { bot_paused: false } : {}),
    })
    .eq('id', conversationId)
    .select('id, patient_id, bot_paused')
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return { ok: false, error: 'La conversación no existe o no se puede modificar' };

  revalidateInbox(data.patient_id);
  return { ok: true, data: { id: data.id, botPaused: data.bot_paused } };
}

// Responde desde el panel (solo si el plan incluye el bot; si no, se rechaza
// sin guardar nada ni llamar a Twilio):
//   1. guarda el mensaje con la sesión del usuario (la RLS comprueba consultorio,
//      suscripción activa y staff_id = auth.uid()) en estado 'queued';
//   2. pausa el bot de esa conversación (la recepción la tomó);
//   3. lo envía por Twilio y registra sid/estado con la service role (el
//      personal no puede cambiar estados de mensajes).
// Si Twilio lo rechaza (p. ej. 63016, fuera de la ventana de 24 h) el mensaje
// queda 'failed' y se devuelve el error para mostrarlo.
export async function sendStaffMessage(
  input: StaffMessageInput,
): Promise<ActionResult<{ id: string; status: MessageStatus }>> {
  const parsed = staffMessageSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { conversation_id, body } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
  const denied = await requireBot(supabase, BOT_REQUIRED_TO_REPLY);
  if (denied) return denied;

  const { data: conversation, error: readError } = await supabase
    .from('conversations')
    .select('id, patient_id, phone, clinic:clinics(whatsapp_from)')
    .eq('id', conversation_id)
    .maybeSingle();
  if (readError) return dbError(readError);
  if (!conversation) return { ok: false, error: 'La conversación no existe' };
  const clinicNumber = conversation.clinic?.whatsapp_from;
  if (!clinicNumber) {
    return { ok: false, error: 'El consultorio no tiene un número de WhatsApp configurado' };
  }

  const { data: message, error: insertError } = await supabase
    .from('messages')
    .insert({
      conversation_id,
      direction: 'out',
      sender: 'staff',
      staff_id: user.id,
      body,
      status: 'queued',
    })
    .select('id')
    .single();
  if (insertError) return dbError(insertError);

  const { error: pauseError } = await supabase
    .from('conversations')
    .update({ bot_paused: true })
    .eq('id', conversation_id);
  if (pauseError) reportError('No se pudo pausar el bot:', pauseError, { where: 'conversations.pauseBot' });

  let result;
  try {
    result = await deliverMessage(createAdminClient(), {
      messageId: message.id,
      from: clinicNumber,
      to: conversation.phone,
      body,
    });
  } catch (error) {
    // Falló al registrar el resultado del envío (el mensaje queda 'queued').
    reportError('Error registrando el envío:', error, { where: 'conversations.deliver' });
    revalidateInbox(conversation.patient_id);
    return { ok: false, error: 'No se pudo confirmar el envío del mensaje' };
  }

  revalidateInbox(conversation.patient_id);
  if (result.status === 'failed') {
    return {
      ok: false,
      error: describeMessageError(result.errorCode) ?? 'No se pudo enviar el mensaje',
    };
  }
  return { ok: true, data: { id: message.id, status: result.status } };
}
