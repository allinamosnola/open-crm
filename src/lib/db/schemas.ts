// Esquemas zod de entrada de las server actions. Sin 'use server' para que el
// frontend también pueda usarlos en validación del lado del cliente.

import { z } from 'zod';

import { normalizePhone } from '@/lib/whatsapp/phone';
import { Constants } from '@/types/database';

import { WEEKDAY_KEYS, type WeekdayKey } from './types';

const Enums = Constants.public.Enums;

// UUID "laxo": z.uuid() exige versión/variante RFC y rechaza ids válidos de Postgres
// como los del seed ('11111111-1111-...').
const id = z.guid('Identificador inválido');

// Convierte '' (inputs vacíos de formularios) en null.
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = z.preprocess(emptyToNull, z.string().trim().nullish());
const optionalId = z.preprocess(emptyToNull, id.nullish());

// Fecha y hora ISO 8601 con zona (p. ej. 2026-09-22T10:00:00-06:00 o ...Z).
const timestamp = z.iso.datetime({ offset: true, error: 'Fecha y hora inválidas' });

export const patientSchema = z.object({
  full_name: z.string().trim().min(1, 'El nombre es obligatorio'),
  // Se guarda normalizado: +521 + 10 dígitos (celular de México) pasa a +52 + 10 dígitos.
  phone: z.preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9]{7,14}$/, 'Teléfono en formato internacional, p. ej. +525512345678')
      .transform(normalizePhone)
      .nullish(),
  ),
  email: z.preprocess(emptyToNull, z.email('Correo inválido').nullish()),
  birthdate: z.preprocess(emptyToNull, z.iso.date('Fecha inválida').nullish()),
  allergies: optionalText,
  notes_admin: optionalText,
});
export type PatientInput = z.input<typeof patientSchema>;

const appointmentFields = z.object({
  patient_id: id,
  dentist_id: id,
  plan_item_id: optionalId,
  starts_at: timestamp,
  ends_at: timestamp,
  status: z.enum(Enums.appt_status).optional(),
  reason: optionalText,
});

const validRange = (a: { starts_at?: string; ends_at?: string }) =>
  !a.starts_at || !a.ends_at || new Date(a.ends_at) > new Date(a.starts_at);
const rangeError = {
  message: 'La hora de fin debe ser posterior a la de inicio',
  path: ['ends_at'],
};

export const appointmentSchema = appointmentFields.refine(validRange, rangeError);
export type AppointmentInput = z.input<typeof appointmentSchema>;

// Edición parcial (p. ej. mover la cita en el calendario solo cambia las horas).
// Si cambia una de las dos horas, deben enviarse ambas.
export const appointmentUpdateSchema = appointmentFields
  .partial()
  .refine((a) => (a.starts_at === undefined) === (a.ends_at === undefined), {
    message: 'Envía la hora de inicio y la de fin',
    path: ['ends_at'],
  })
  .refine(validRange, rangeError);
export type AppointmentUpdateInput = z.input<typeof appointmentUpdateSchema>;

export const planItemSchema = z.object({
  treatment_id: id,
  tooth: optionalText,
  price: z.coerce.number().min(0, 'El precio no puede ser negativo'),
  status: z.enum(Enums.item_status).optional(),
  sort_order: z.coerce.number().int().optional(),
});
export type PlanItemInput = z.input<typeof planItemSchema>;

export const planSchema = z.object({
  patient_id: id,
  dentist_id: id,
  title: z.string().trim().min(1, 'El título es obligatorio'),
  status: z.enum(Enums.plan_status).optional(),
  items: z.array(planItemSchema).min(1, 'Agrega al menos un tratamiento'),
});
export type PlanInput = z.input<typeof planSchema>;

export const paymentSchema = z.object({
  patient_id: id,
  plan_id: optionalId,
  amount: z.coerce.number().positive('El monto debe ser mayor a 0'),
  method: z.enum(Enums.payment_method),
  paid_at: z.preprocess(emptyToNull, timestamp.nullish()),
  notes: optionalText,
});
export type PaymentInput = z.input<typeof paymentSchema>;

export const clinicalNoteSchema = z.object({
  patient_id: id,
  appointment_id: optionalId,
  body: z.string().trim().min(1, 'La nota no puede estar vacía'),
});
export type ClinicalNoteInput = z.input<typeof clinicalNoteSchema>;

export const staffInviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Correo inválido')),
  full_name: z.string().trim().min(1, 'El nombre es obligatorio'),
  role: z.enum(['dentist', 'receptionist'], 'Elige dentista o recepcionista'),
});
export type StaffInviteInput = z.input<typeof staffInviteSchema>;

export const staffMessageSchema = z.object({
  conversation_id: id,
  body: z.string().trim().min(1, 'Escribe un mensaje').max(1600, 'Máximo 1600 caracteres'),
});
export type StaffMessageInput = z.input<typeof staffMessageSchema>;

// ---------------------------------------------------------------------------
// Configuración del consultorio (solo owner)
// ---------------------------------------------------------------------------

const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Hora inválida (HH:MM)');
const timeRange = z
  .tuple([hhmm, hhmm])
  .refine(([start, end]) => start < end, 'La hora de inicio debe ser anterior a la de fin');
const dayRanges = z
  .array(timeRange)
  .max(4, 'Máximo 4 rangos por día')
  .refine((ranges) => {
    // Sin traslapes entre rangos del mismo día (se permite que uno empiece
    // justo cuando termina el otro).
    const sorted = [...ranges].sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.every((range, i) => i === 0 || sorted[i - 1][1] <= range[0]);
  }, 'Los horarios del día se traslapan');

// { mon: [["09:00","14:00"], ["16:00","20:00"]], ... }. Un día sin llave o con
// lista vacía está cerrado. Los días vacíos se omiten al guardar.
export const businessHoursSchema = z
  .object(
    Object.fromEntries(WEEKDAY_KEYS.map((day) => [day, dayRanges.optional()])) as Record<
      WeekdayKey,
      z.ZodOptional<typeof dayRanges>
    >,
  )
  .strict()
  .transform((hours) =>
    Object.fromEntries(Object.entries(hours).filter(([, ranges]) => ranges && ranges.length > 0)),
  );

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('es-MX', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const clinicSettingsSchema = z.object({
  timezone: z.string().trim().refine(isValidTimeZone, 'Zona horaria inválida'),
  business_hours: businessHoursSchema,
  default_appointment_minutes: z.coerce
    .number()
    .int('Debe ser un número entero de minutos')
    .min(10, 'Mínimo 10 minutos')
    .max(240, 'Máximo 240 minutos'),
  reception_email: z.preprocess(
    emptyToNull,
    z.string().trim().toLowerCase().pipe(z.email('Correo inválido')).nullish(),
  ),
});
export type ClinicSettingsInput = z.input<typeof clinicSettingsSchema>;

export const passwordSchema = z
  .object({
    password: z.string().min(8, 'Mínimo 8 caracteres'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Las contraseñas no coinciden',
    path: ['confirm'],
  });
export type PasswordInput = z.input<typeof passwordSchema>;

// Consultorio al que se cambia el usuario (selector de consultorio).
export const clinicIdSchema = id;
