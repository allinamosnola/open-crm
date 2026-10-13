// Cálculo de huecos disponibles para citas (funciones puras, sin base de datos).
// Reglas (plan de las semanas 3-4):
//   * dentro del horario del consultorio y con la duración de cita por defecto;
//   * sin traslapes con las citas no canceladas de cada dentista;
//   * no en el pasado, con anticipación mínima de 2 h y horizonte de 14 días;
//   * con preferencia por el dentista habitual del paciente.
// Todas las horas del horario están en la zona horaria del consultorio.

import type { BusinessHours, WeekdayKey } from '@/lib/db/types';

export const MIN_LEAD_MINUTES = 120;
export const HORIZON_DAYS = 14;
export const SLOTS_TO_OFFER = 3;

// Día de la semana según Date#getUTCDay() (0 = domingo).
const WEEKDAY_BY_INDEX: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export type PartOfDay = 'manana' | 'tarde' | 'noche';

// Límites de cada parte del día por hora de inicio de la cita (hora local).
const PART_OF_DAY_RANGE: Record<PartOfDay, [from: string, to: string]> = {
  manana: ['00:00', '12:00'],
  tarde: ['12:00', '19:00'],
  noche: ['19:00', '24:00'],
};

// ---------------------------------------------------------------------------
// Zona horaria (sin dependencias: Intl.DateTimeFormat)
// ---------------------------------------------------------------------------

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

// Fecha y hora locales de un instante en una zona horaria.
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
  };
}

// Diferencia (ms) entre la hora local de la zona y UTC en ese instante.
function offsetMs(instant: number, timeZone: string): number {
  const p = zonedParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(instant / 60_000) * 60_000;
}

// Instante que corresponde a una fecha y hora locales en la zona. Devuelve null
// si esa hora no existe (salto del horario de verano).
export function zonedTimeToUtc(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date | null {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let instant = guess - offsetMs(guess, timeZone);
  const second = guess - offsetMs(instant, timeZone);
  if (second !== instant) instant = second;
  const check = zonedParts(new Date(instant), timeZone);
  if (
    check.year !== local.year ||
    check.month !== local.month ||
    check.day !== local.day ||
    check.hour !== local.hour ||
    check.minute !== local.minute
  ) {
    return null;
  }
  return new Date(instant);
}

// "AAAA-MM-DD" de un día del calendario (sin zona).
export function formatLocalDate(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

// Suma días a una fecha del calendario (sin zona).
function addDays(d: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function weekdayOf(d: { year: number; month: number; day: number }): WeekdayKey {
  return WEEKDAY_BY_INDEX[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ¿La cita [startsAt, endsAt] cabe entera en un rango del horario del consultorio?
// Inicio y fin deben caer el mismo día local y en el mismo rango (un descanso o el
// cierre parten el horario). Sin horario configurado no se bloquea nada.
export function isWithinBusinessHours(
  startsAt: Date,
  endsAt: Date,
  hours: BusinessHours,
  timeZone: string,
): boolean {
  if (!WEEKDAY_BY_INDEX.some((day) => (hours[day]?.length ?? 0) > 0)) return true;
  const start = zonedParts(startsAt, timeZone);
  const end = zonedParts(endsAt, timeZone);
  if (start.year !== end.year || start.month !== end.month || start.day !== end.day) return false;
  const startMin = start.hour * 60 + start.minute;
  const endMin = end.hour * 60 + end.minute;
  return (hours[weekdayOf(start)] ?? []).some(
    ([from, to]) => toMinutes(from) <= startMin && endMin <= toMinutes(to),
  );
}

function toHhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Etiquetas en español (hora del consultorio)
// ---------------------------------------------------------------------------

const labelFormatters = new Map<string, Intl.DateTimeFormat>();

// "martes 24 de septiembre, 10:00" en la zona del consultorio.
export function formatSlotLabel(iso: string | Date, timeZone: string): string {
  let formatter = labelFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('es-MX', {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    labelFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(iso))) parts[part.type] = part.value;
  return `${parts.weekday} ${parts.day} de ${parts.month}, ${parts.hour}:${parts.minute}`;
}

// "martes 23 de septiembre de 2026, 07:30" (fecha y hora actuales para el prompt).
export function formatNowLabel(now: Date, timeZone: string): string {
  const date = new Intl.DateTimeFormat('es-MX', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  const p = zonedParts(now, timeZone);
  return `${date}, ${toHhmm(p.hour * 60 + p.minute)}`;
}

// ---------------------------------------------------------------------------
// Huecos
// ---------------------------------------------------------------------------

export interface Dentist {
  id: string;
  full_name: string;
}

export interface BusyInterval {
  dentist_id: string;
  starts_at: string;
  ends_at: string;
}

export interface CandidateSlot {
  dentist_id: string;
  dentist_name: string;
  starts_at: string; // ISO UTC
  ends_at: string;
  local_date: string; // AAAA-MM-DD en la zona del consultorio
  local_time: string; // HH:MM
}

export interface SlotSearch {
  now: Date;
  timeZone: string;
  businessHours: BusinessHours;
  durationMinutes: number;
  dentists: Dentist[];
  busy: BusyInterval[];
  preferredDentistId?: string | null;
  // Filtros opcionales del paciente (fechas locales, inclusivas).
  from?: string | null;
  to?: string | null;
  partOfDay?: PartOfDay | null;
  limit?: number;
  minLeadMinutes?: number;
  horizonDays?: number;
}

// Ventana en la que se pueden proponer citas: [now + 2 h, now + 14 días).
export function bookingWindow(now: Date, minLeadMinutes = MIN_LEAD_MINUTES, horizonDays = HORIZON_DAYS) {
  return {
    earliest: new Date(now.getTime() + minLeadMinutes * 60_000),
    latest: new Date(now.getTime() + horizonDays * 24 * 60 * 60_000),
  };
}

// Todos los inicios posibles en orden cronológico, con los dentistas libres en
// cada uno. El paso entre inicios es la duración de la cita, a partir del
// inicio de cada rango del horario.
function listCandidates(search: SlotSearch): { start: Date; end: Date; localDate: string; localTime: string; free: Dentist[] }[] {
  const { now, timeZone, businessHours, durationMinutes, dentists, busy } = search;
  const { earliest, latest } = bookingWindow(now, search.minLeadMinutes, search.horizonDays);
  const busyByDentist = new Map<string, { start: number; end: number }[]>();
  for (const b of busy) {
    const list = busyByDentist.get(b.dentist_id) ?? [];
    list.push({ start: new Date(b.starts_at).getTime(), end: new Date(b.ends_at).getTime() });
    busyByDentist.set(b.dentist_id, list);
  }
  const isFree = (dentistId: string, start: number, end: number) =>
    !(busyByDentist.get(dentistId) ?? []).some((b) => start < b.end && b.start < end);

  const partRange = search.partOfDay ? PART_OF_DAY_RANGE[search.partOfDay] : null;
  const today = zonedParts(now, timeZone);
  const out: { start: Date; end: Date; localDate: string; localTime: string; free: Dentist[] }[] = [];

  // Un día de más cubre el final del horizonte en cualquier zona horaria.
  for (let offset = 0; offset <= (search.horizonDays ?? HORIZON_DAYS) + 1; offset++) {
    const day = addDays(today, offset);
    const localDate = formatLocalDate(day);
    if (search.from && localDate < search.from) continue;
    if (search.to && localDate > search.to) continue;

    for (const [rangeStart, rangeEnd] of businessHours[weekdayOf(day)] ?? []) {
      const endMinutes = toMinutes(rangeEnd);
      for (let m = toMinutes(rangeStart); m + durationMinutes <= endMinutes; m += durationMinutes) {
        const localTime = toHhmm(m);
        if (partRange && !(localTime >= partRange[0] && localTime < partRange[1])) continue;
        const start = zonedTimeToUtc({ ...day, hour: Math.floor(m / 60), minute: m % 60 }, timeZone);
        if (!start) continue;
        const end = new Date(start.getTime() + durationMinutes * 60_000);
        if (start < earliest || start >= latest) continue;
        const free = dentists.filter((d) => isFree(d.id, start.getTime(), end.getTime()));
        if (free.length) out.push({ start, end, localDate, localTime, free });
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Elige hasta `limit` huecos: primero el más temprano de cada día distinto (para
// dar opciones variadas) y después, si faltan, los más tempranos restantes.
function pickSpread<T extends { localDate: string; start: Date }>(items: T[], limit: number): T[] {
  const picked: T[] = [];
  const days = new Set<string>();
  for (const item of items) {
    if (picked.length >= limit) break;
    if (!days.has(item.localDate)) {
      days.add(item.localDate);
      picked.push(item);
    }
  }
  for (const item of items) {
    if (picked.length >= limit) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Hasta 3 huecos. Si el paciente tiene dentista habitual (y sigue activo), se
// buscan primero huecos con él; si no alcanzan, se completan con los demás
// dentistas en otros horarios.
export function findSlots(search: SlotSearch): CandidateSlot[] {
  const limit = search.limit ?? SLOTS_TO_OFFER;
  if (search.durationMinutes <= 0 || !search.dentists.length) return [];
  const candidates = listCandidates(search);
  const preferred = search.dentists.find((d) => d.id === search.preferredDentistId) ?? null;

  const toSlot = (c: (typeof candidates)[number], dentist: Dentist): CandidateSlot & { start: Date; localDate: string } => ({
    dentist_id: dentist.id,
    dentist_name: dentist.full_name,
    starts_at: c.start.toISOString(),
    ends_at: c.end.toISOString(),
    local_date: c.localDate,
    local_time: c.localTime,
    start: c.start,
    localDate: c.localDate,
  });

  let chosen: ReturnType<typeof toSlot>[] = [];
  if (preferred) {
    const withPreferred = candidates
      .filter((c) => c.free.some((d) => d.id === preferred.id))
      .map((c) => toSlot(c, preferred));
    chosen = pickSpread(withPreferred, limit);
  }
  if (chosen.length < limit) {
    const taken = new Set(chosen.map((s) => s.starts_at));
    const others = candidates
      .filter((c) => !taken.has(c.start.toISOString()))
      .map((c) => toSlot(c, c.free.find((d) => d.id === preferred?.id) ?? c.free[0]));
    chosen = [...chosen, ...pickSpread(others, limit - chosen.length)].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
  }

  return chosen.map(({ dentist_id, dentist_name, starts_at, ends_at, local_date, local_time }) => ({
    dentist_id,
    dentist_name,
    starts_at,
    ends_at,
    local_date,
    local_time,
  }));
}

// Texto del horario semanal para el prompt ("lunes: 09:00-14:00 y 16:00-20:00; …").
const WEEKDAY_ES: Record<WeekdayKey, string> = {
  mon: 'lunes',
  tue: 'martes',
  wed: 'miércoles',
  thu: 'jueves',
  fri: 'viernes',
  sat: 'sábado',
  sun: 'domingo',
};

export function describeBusinessHours(hours: BusinessHours): string {
  return (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as WeekdayKey[])
    .map((day) => {
      const ranges = hours[day] ?? [];
      const text = ranges.length ? ranges.map(([a, b]) => `${a}-${b}`).join(' y ') : 'cerrado';
      return `${WEEKDAY_ES[day]}: ${text}`;
    })
    .join('; ');
}
