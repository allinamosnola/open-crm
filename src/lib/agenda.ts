import { WEEKDAY_KEYS, type BusinessHours, type WeekdayKey } from '@/lib/db/types';

// Filas de la cuadrícula del calendario (minutos). Un clic simple selecciona una
// unidad de ajuste (15 min) y un arrastre selecciona un rango más largo.
export const GRID_MINUTES = 30;

// Fin de una cita nueva a partir de la selección del calendario: un clic simple
// (selección de una fila de la cuadrícula o menos) usa la duración por defecto del
// consultorio; si se arrastró para elegir un rango más largo, se respeta ese rango.
export function resolveNewAppointmentEnd(
  start: Date,
  end: Date,
  defaultMinutes: number,
): Date {
  const isSimpleClick = end.getTime() - start.getTime() <= GRID_MINUTES * 60_000;
  return isSimpleClick ? new Date(start.getTime() + defaultMinutes * 60_000) : end;
}

const FC_DAY_BY_KEY: Record<WeekdayKey, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const FALLBACK_SLOT_MIN = '08:00:00';
const FALLBACK_SLOT_MAX = '20:00:00';

export interface AgendaGrid {
  // Entradas para la opción businessHours de FullCalendar (una por rango); null si
  // el consultorio no tiene horario, y entonces no se bloquea nada.
  businessHours: { daysOfWeek: number[]; startTime: string; endTime: string }[] | null;
  slotMinTime: string;
  slotMaxTime: string;
  // Días (0 = domingo) que se ocultan porque el consultorio no abre.
  hiddenDays: number[];
}

// Rejilla de la agenda a partir del horario del consultorio.
export function buildAgendaGrid(hours: BusinessHours | undefined): AgendaGrid {
  const entries: NonNullable<AgendaGrid['businessHours']> = [];
  let min = Infinity;
  let max = -Infinity;
  const open = new Set<number>();
  for (const key of WEEKDAY_KEYS) {
    for (const [startTime, endTime] of hours?.[key] ?? []) {
      entries.push({ daysOfWeek: [FC_DAY_BY_KEY[key]], startTime, endTime });
      open.add(FC_DAY_BY_KEY[key]);
      min = Math.min(min, Number(startTime.slice(0, 2)));
      max = Math.max(max, Math.ceil(Number(endTime.slice(0, 2)) + Number(endTime.slice(3)) / 60));
    }
  }
  if (entries.length === 0) {
    return { businessHours: null, slotMinTime: FALLBACK_SLOT_MIN, slotMaxTime: FALLBACK_SLOT_MAX, hiddenDays: [0] };
  }
  const pad = (h: number) => `${String(h).padStart(2, '0')}:00:00`;
  return {
    businessHours: entries,
    slotMinTime: pad(min),
    slotMaxTime: pad(max),
    hiddenDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => !open.has(d)),
  };
}
