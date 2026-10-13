// Acceso a datos del bot detrás de una interfaz, para que el agente y sus
// herramientas se prueben sin base de datos:
//   - repository-supabase.ts: implementación real (service role);
//   - memory-repository.ts: en memoria (tests con vitest y eval del modelo).
// Todas las operaciones van acotadas al consultorio y, cuando aplica, al
// paciente de la conversación: el modelo nunca elige de quién son los datos.

import type { AttentionCategory, BusinessHours, PatientStatus } from '@/lib/db/types';

import type { BusyInterval, Dentist } from './slots';
import type { BotState } from './state';

export interface ClinicInfo {
  id: string;
  name: string;
  timezone: string;
  business_hours: BusinessHours;
  default_appointment_minutes: number;
  reception_email: string | null;
}

export interface PatientInfo {
  id: string;
  full_name: string | null;
  status: PatientStatus;
  phone: string | null;
}

export interface HistoryMessage {
  direction: 'in' | 'out';
  sender: 'patient' | 'bot' | 'staff';
  body: string;
  created_at: string;
}

export interface TurnContext {
  conversationId: string;
  botPaused: boolean;
  clinic: ClinicInfo;
  patient: PatientInfo;
  // Últimos mensajes de la conversación en orden cronológico (incluye el que
  // acaba de llegar).
  history: HistoryMessage[];
}

export interface UpcomingAppointment {
  id: string;
  dentist_id: string;
  dentist_name: string | null;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'confirmed';
}

export type WriteResult = { ok: true; id: string } | { ok: false; reason: 'overlap' | 'not_found' };

export type TurnLock =
  | { acquired: true; token: string; state: unknown }
  | { acquired: false };

export interface BotRepository {
  // Candado por conversación (ver bot_acquire_turn / bot_release_turn).
  acquireTurn(conversationId: string, leaseSeconds: number): Promise<TurnLock>;
  releaseTurn(conversationId: string, token: string, state: BotState | null): Promise<boolean>;

  loadTurnContext(conversationId: string, historyLimit: number): Promise<TurnContext | null>;

  // Dentistas activos del consultorio (el owner cuenta como dentista).
  listDentists(clinicId: string): Promise<Dentist[]>;
  // Citas no canceladas que se traslapan con [from, to).
  listBusy(clinicId: string, from: string, to: string): Promise<BusyInterval[]>;
  // Dentista de la última cita completada o agendada del paciente.
  findUsualDentistId(clinicId: string, patientId: string): Promise<string | null>;
  // Citas futuras (scheduled/confirmed) del paciente, las más próximas primero.
  listUpcomingAppointments(clinicId: string, patientId: string, now: string): Promise<UpcomingAppointment[]>;

  // Agenda con source = 'whatsapp' y created_by = null. 'overlap' si la
  // restricción de traslapes lo rechaza (otra persona tomó el horario).
  createAppointment(params: {
    clinicId: string;
    patientId: string;
    dentistId: string;
    startsAt: string;
    endsAt: string;
  }): Promise<WriteResult>;
  cancelAppointment(params: { clinicId: string; patientId: string; appointmentId: string }): Promise<WriteResult>;
  rescheduleAppointment(params: {
    clinicId: string;
    patientId: string;
    appointmentId: string;
    dentistId: string;
    startsAt: string;
    endsAt: string;
  }): Promise<WriteResult>;

  // Guarda el nombre de un paciente "por identificar" y lo pasa a active.
  // false si el paciente ya estaba identificado.
  savePatientName(params: { clinicId: string; patientId: string; fullName: string }): Promise<boolean>;

  // Pausa el bot y marca la conversación como "requiere atención".
  escalate(params: { conversationId: string; category: AttentionCategory; reason: string }): Promise<void>;
}
