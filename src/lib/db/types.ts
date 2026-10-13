// Tipos compartidos de la capa de datos (sin 'use server': se pueden importar
// desde Client Components).

import type { Enums, Tables } from '@/types/database';

export type StaffRole = Enums<'staff_role'>;
export type SubscriptionStatus = Enums<'subscription_status'>;
export type PatientStatus = Enums<'patient_status'>;
export type Clinic = Tables<'clinics'>;
export type Staff = Tables<'staff'>;
export type AccountPlan = Enums<'account_plan'>;

// Plan, topes y uso de la cuenta del consultorio activo (función SQL
// my_entitlements; los topes salen de account_entitlements, el único origen de
// verdad). null = ilimitado.
export type Entitlements = {
  clinic_id: string;
  account_id: string;
  plan: AccountPlan;
  bot_addon: boolean;
  bot_enabled: boolean;
  max_clinics: number | null;
  max_doctors: number | null;
  max_receptionists_per_clinic: number;
  clinics_used: number;
  doctors_used: number;
  // Recepcionistas activos del consultorio activo.
  receptionists_used: number;
};

// Consultorio donde el usuario es personal activo (selector de consultorio).
export type MyClinic = { id: string; name: string; is_active: boolean };

// Usuario de la sesión con su membresía del consultorio activo (un usuario
// puede ser personal de varios consultorios; ver user_active_clinic) y el plan
// de la cuenta de ese consultorio.
export type CurrentStaff = Pick<Staff, 'id' | 'full_name' | 'role'> & {
  clinic: Pick<Clinic, 'id' | 'name' | 'subscription_status'> & {
    account: Pick<
      Entitlements,
      'account_id' | 'plan' | 'bot_addon' | 'bot_enabled' | 'max_clinics' | 'max_doctors'
    >;
  };
};
export type Patient = Tables<'patients'>;
export type Treatment = Tables<'treatments'>;
export type TreatmentPlan = Tables<'treatment_plans'>;
export type TreatmentPlanItem = Tables<'treatment_plan_items'>;
export type Appointment = Tables<'appointments'>;
export type Payment = Tables<'payments'>;
export type ClinicalNote = Tables<'clinical_notes'>;
export type PatientBalance = Tables<'patient_balances'>;
export type Conversation = Tables<'conversations'>;
export type Message = Tables<'messages'>;
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
// Motivo por el que el bot pasó la conversación a la recepción.
export type AttentionCategory = Enums<'attention_category'>;

// Horario de atención del consultorio (clinics.business_hours): por día, lista de
// rangos ["HH:MM", "HH:MM"] en la zona horaria del consultorio. Un día sin
// llave o con lista vacía está cerrado.
export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];
export type TimeRange = [start: string, end: string];
export type BusinessHours = Partial<Record<WeekdayKey, TimeRange[]>>;

// Configuración del consultorio que edita el owner (/configuracion/consultorio).
export type ClinicSettings = Pick<
  Clinic,
  'id' | 'name' | 'timezone' | 'default_appointment_minutes' | 'reception_email'
> & { business_hours: BusinessHours };

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

// Lee clinics.business_hours (jsonb) tolerando datos inválidos: descarta los
// días y rangos que no tienen el formato esperado.
export function parseBusinessHours(value: unknown): BusinessHours {
  const hours: BusinessHours = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return hours;
  for (const day of WEEKDAY_KEYS) {
    const ranges = (value as Record<string, unknown>)[day];
    if (!Array.isArray(ranges)) continue;
    const valid = ranges.filter(
      (r): r is TimeRange =>
        Array.isArray(r) &&
        r.length === 2 &&
        typeof r[0] === 'string' &&
        typeof r[1] === 'string' &&
        HHMM.test(r[0]) &&
        HHMM.test(r[1]) &&
        r[0] < r[1],
    );
    if (valid.length) hours[day] = valid.map(([a, b]) => [a, b]);
  }
  return hours;
}

// Con la suscripción en past_due o canceled el consultorio queda en solo
// lectura (la RLS rechaza las escrituras); el panel deshabilita las acciones.
export function isSubscriptionActive(status: SubscriptionStatus): boolean {
  return status === 'trial' || status === 'active';
}

// El owner cuenta como dentista: aparece en la agenda, puede tener citas y
// ve/escribe notas clínicas y planes (igual que en la RLS).
export function actsAsDentist(role: StaffRole): boolean {
  return role === 'dentist' || role === 'owner';
}

// Roles que el owner puede asignar al invitar (no se invita a otro owner).
export const INVITABLE_ROLES = ['dentist', 'receptionist'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export type AppointmentWithRelations = Appointment & {
  patient: Pick<Patient, 'id' | 'full_name' | 'phone' | 'status'> | null;
  dentist: Pick<Staff, 'id' | 'full_name'> | null;
};

export type PlanItemWithTreatment = TreatmentPlanItem & {
  treatment: Pick<Treatment, 'id' | 'name'> | null;
};

export type PlanWithItems = TreatmentPlan & {
  dentist: Pick<Staff, 'id' | 'full_name'> | null;
  items: PlanItemWithTreatment[];
};

export type PaymentWithReceiver = Payment & {
  receiver: Pick<Staff, 'id' | 'full_name'> | null;
};

export type ClinicalNoteWithAuthor = ClinicalNote & {
  author: Pick<Staff, 'id' | 'full_name'> | null;
};

export type ConversationListItem = Conversation & {
  patient: Pick<Patient, 'id' | 'full_name' | 'phone' | 'status'> | null;
  // Último mensaje (arreglo de 0 o 1 elemento, por el embed de PostgREST).
  last_message: Pick<Message, 'body' | 'direction' | 'sender' | 'status' | 'created_at'>[];
};

export type ConversationWithPatient = Conversation & {
  patient: Pick<Patient, 'id' | 'full_name' | 'phone' | 'status'> | null;
};

export type MessageWithStaff = Message & {
  staff: Pick<Staff, 'id' | 'full_name'> | null;
};

// Resultado de todas las server actions: nunca lanzan por errores esperados
// (validación, permisos, traslapes); devuelven el mensaje para mostrarlo en la UI.
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
