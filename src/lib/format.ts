// Formato regional (es-MX, MXN) y etiquetas en español de los enums de la base
// de datos. Sin dependencias de servidor: se usa en Server y Client Components.

import type { Enums } from '@/types/database';

export const LOCALE = 'es-MX';

const currency = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'MXN' });

export function formatCurrency(value: number | string | null | undefined): string {
  return currency.format(Number(value ?? 0));
}

// Fechas sin hora (columna `date`, p. ej. 1990-05-12): se formatean sin pasar por la
// zona horaria para que no se recorran un día.
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function ageFrom(birthdate: string | null | undefined): number | null {
  if (!birthdate) return null;
  const [y, m, d] = birthdate.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

// <input type="datetime-local"> trabaja en hora local sin zona ("2026-09-22T10:00").
export function toLocalInputValue(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convierte el valor de un datetime-local (hora del navegador) a ISO con zona.
export function fromLocalInputValue(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export const ROLE_LABEL: Record<Enums<'staff_role'>, string> = {
  owner: 'Dueño',
  dentist: 'Dentista',
  receptionist: 'Recepción',
};

export const APPT_STATUS_LABEL: Record<Enums<'appt_status'>, string> = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  completed: 'Atendida',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
};

export const APPT_SOURCE_LABEL: Record<Enums<'appt_source'>, string> = {
  panel: 'Panel',
  whatsapp: 'WhatsApp',
};

export const PLAN_STATUS_LABEL: Record<Enums<'plan_status'>, string> = {
  draft: 'Borrador',
  active: 'Activo',
  completed: 'Terminado',
  cancelled: 'Cancelado',
};

export const ITEM_STATUS_LABEL: Record<Enums<'item_status'>, string> = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  done: 'Hecho',
  cancelled: 'Cancelado',
};

export const PAYMENT_METHOD_LABEL: Record<Enums<'payment_method'>, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

// Motivo por el que el bot pasó la conversación a la recepción ("Requiere atención").
export const ATTENTION_CATEGORY_LABEL: Record<Enums<'attention_category'>, string> = {
  human_requested: 'Pidió una persona',
  urgent: 'Urgencia',
  policy: 'Cancelar o reagendar con menos de 24 h',
  not_understood: 'El bot no entendió',
  other: 'Pregunta fuera de agenda',
};

// Días del horario del consultorio (clinics.business_hours), de lunes a domingo.
export const WEEKDAY_LABEL: Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', string> = {
  mon: 'Lunes',
  tue: 'Martes',
  wed: 'Miércoles',
  thu: 'Jueves',
  fri: 'Viernes',
  sat: 'Sábado',
  sun: 'Domingo',
};

// Pacientes "por identificar": llegaron por WhatsApp y aún no tienen nombre.
export const UNIDENTIFIED_LABEL = 'Por identificar';

export function patientName(patient: { full_name: string | null } | null | undefined): string {
  return patient?.full_name ?? UNIDENTIFIED_LABEL;
}

// Hora si es de hoy; si no, fecha corta y hora (lista y burbujas de conversaciones).
export function formatSmartDateTime(value: string | Date): string {
  const d = new Date(value);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(d);
  return d.toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}
