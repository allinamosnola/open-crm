import 'server-only';

import { parseBusinessHours } from '@/lib/db/types';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/types/database';

import type { BotRepository, UpcomingAppointment, WriteResult } from './repository';

// BotRepository sobre Supabase con la service role (el webhook no tiene sesión
// de usuario). La RLS no aplica aquí: cada consulta filtra explícitamente por
// consultorio y, cuando corresponde, por el paciente de la conversación.

// exclusion_violation de appointments_no_overlap.
const OVERLAP = '23P01';

const DENTIST_ROLES = ['dentist', 'owner'] as const;
const ACTIVE_APPT_STATUSES = ['scheduled', 'confirmed'] as const;

export function createSupabaseBotRepository(supabase: AdminClient): BotRepository {
  return {
    async acquireTurn(conversationId, leaseSeconds) {
      const { data, error } = await supabase.rpc('bot_acquire_turn', {
        p_conversation_id: conversationId,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(`bot_acquire_turn: ${error.message}`);
      const row = data?.[0];
      if (!row?.acquired) return { acquired: false };
      return { acquired: true, token: row.token, state: row.bot_state };
    },

    async releaseTurn(conversationId, token, state) {
      const { data, error } = await supabase.rpc('bot_release_turn', {
        p_conversation_id: conversationId,
        p_token: token,
        ...(state ? { p_bot_state: state as unknown as Json } : {}),
      });
      if (error) throw new Error(`bot_release_turn: ${error.message}`);
      return data === true;
    },

    async loadTurnContext(conversationId, historyLimit) {
      const { data, error } = await supabase
        .from('conversations')
        .select(
          'id, bot_paused, patient:patients(id, full_name, status, phone), clinic:clinics(id, name, timezone, business_hours, default_appointment_minutes, reception_email)',
        )
        .eq('id', conversationId)
        .maybeSingle();
      if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`);
      if (!data?.patient || !data.clinic) return null;

      const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('direction, sender, body, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(historyLimit);
      if (messagesError) throw new Error(`No se pudieron leer los mensajes: ${messagesError.message}`);

      return {
        conversationId: data.id,
        botPaused: data.bot_paused,
        clinic: { ...data.clinic, business_hours: parseBusinessHours(data.clinic.business_hours) },
        patient: data.patient,
        history: messages.reverse(),
      };
    },

    async listDentists(clinicId) {
      const { data, error } = await supabase
        .from('staff')
        .select('id, full_name')
        .eq('clinic_id', clinicId)
        .in('role', DENTIST_ROLES)
        .eq('active', true)
        .order('full_name');
      if (error) throw new Error(`No se pudieron leer los dentistas: ${error.message}`);
      return data;
    },

    async listBusy(clinicId, from, to) {
      const { data, error } = await supabase
        .from('appointments')
        .select('dentist_id, starts_at, ends_at')
        .eq('clinic_id', clinicId)
        .neq('status', 'cancelled')
        .lt('starts_at', to)
        .gt('ends_at', from);
      if (error) throw new Error(`No se pudieron leer las citas: ${error.message}`);
      return data;
    },

    async findUsualDentistId(clinicId, patientId) {
      const { data, error } = await supabase
        .from('appointments')
        .select('dentist_id')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .in('status', ['completed', ...ACTIVE_APPT_STATUSES])
        .order('starts_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`No se pudo leer el dentista habitual: ${error.message}`);
      return data?.dentist_id ?? null;
    },

    async listUpcomingAppointments(clinicId, patientId, now) {
      const { data, error } = await supabase
        .from('appointments')
        .select('id, dentist_id, starts_at, ends_at, status, dentist:staff!appointments_dentist_id_fkey(full_name)')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .in('status', ACTIVE_APPT_STATUSES)
        .gt('starts_at', now)
        .order('starts_at')
        .limit(10);
      if (error) throw new Error(`No se pudieron leer las citas del paciente: ${error.message}`);
      return data.map(
        (a): UpcomingAppointment => ({
          id: a.id,
          dentist_id: a.dentist_id,
          dentist_name: a.dentist?.full_name ?? null,
          starts_at: a.starts_at,
          ends_at: a.ends_at,
          status: a.status as UpcomingAppointment['status'],
        }),
      );
    },

    async createAppointment(params): Promise<WriteResult> {
      const { data, error } = await supabase
        .from('appointments')
        .insert({
          clinic_id: params.clinicId,
          patient_id: params.patientId,
          dentist_id: params.dentistId,
          starts_at: params.startsAt,
          ends_at: params.endsAt,
          status: 'scheduled',
          source: 'whatsapp',
          // La agenda el bot, no una persona del consultorio.
          created_by: null,
        })
        .select('id')
        .single();
      if (error?.code === OVERLAP) return { ok: false, reason: 'overlap' };
      if (error) throw new Error(`No se pudo agendar la cita: ${error.message}`);
      return { ok: true, id: data.id };
    },

    async cancelAppointment(params): Promise<WriteResult> {
      const { data, error } = await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', params.appointmentId)
        .eq('clinic_id', params.clinicId)
        .eq('patient_id', params.patientId)
        .in('status', ACTIVE_APPT_STATUSES)
        .select('id')
        .maybeSingle();
      if (error) throw new Error(`No se pudo cancelar la cita: ${error.message}`);
      return data ? { ok: true, id: data.id } : { ok: false, reason: 'not_found' };
    },

    async rescheduleAppointment(params): Promise<WriteResult> {
      // Un solo update: la restricción de traslapes compara contra las demás
      // citas, así que no hay una ventana en la que el paciente pierda su cita.
      const { data, error } = await supabase
        .from('appointments')
        .update({
          dentist_id: params.dentistId,
          starts_at: params.startsAt,
          ends_at: params.endsAt,
          status: 'scheduled',
        })
        .eq('id', params.appointmentId)
        .eq('clinic_id', params.clinicId)
        .eq('patient_id', params.patientId)
        .in('status', ACTIVE_APPT_STATUSES)
        .select('id')
        .maybeSingle();
      if (error?.code === OVERLAP) return { ok: false, reason: 'overlap' };
      if (error) throw new Error(`No se pudo reagendar la cita: ${error.message}`);
      return data ? { ok: true, id: data.id } : { ok: false, reason: 'not_found' };
    },

    async savePatientName(params) {
      const { data, error } = await supabase
        .from('patients')
        .update({ full_name: params.fullName, status: 'active' })
        .eq('id', params.patientId)
        .eq('clinic_id', params.clinicId)
        .eq('status', 'unidentified')
        .select('id')
        .maybeSingle();
      if (error) throw new Error(`No se pudo guardar el nombre: ${error.message}`);
      return data !== null;
    },

    async escalate(params) {
      const { error } = await supabase
        .from('conversations')
        .update({
          bot_paused: true,
          needs_attention: true,
          attention_category: params.category,
          attention_reason: params.reason,
          escalated_at: new Date().toISOString(),
        })
        .eq('id', params.conversationId);
      if (error) throw new Error(`No se pudo escalar la conversación: ${error.message}`);
    },
  };
}
