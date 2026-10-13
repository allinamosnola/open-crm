import { describe, expect, it } from 'vitest';

import { buildAgendaGrid, resolveNewAppointmentEnd } from '@/lib/agenda';
import { isWithinBusinessHours } from '@/lib/bot/slots';
import type { BusinessHours } from '@/lib/db/types';

const start = new Date('2026-09-24T10:00:00');
const minutes = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60_000;

describe('resolveNewAppointmentEnd', () => {
  it('un clic (15 min de selección) usa la duración por defecto', () => {
    const end = resolveNewAppointmentEnd(start, new Date('2026-09-24T10:15:00'), 30);
    expect(minutes(start, end)).toBe(30);
  });

  it('un clic en una fila de 30 min usa la duración por defecto', () => {
    const end = resolveNewAppointmentEnd(start, new Date('2026-09-24T10:30:00'), 45);
    expect(minutes(start, end)).toBe(45);
  });

  it('respeta la duración por defecto menor que la fila', () => {
    const end = resolveNewAppointmentEnd(start, new Date('2026-09-24T10:15:00'), 20);
    expect(minutes(start, end)).toBe(20);
  });

  it('un arrastre de más de una fila conserva el rango elegido', () => {
    const dragged = new Date('2026-09-24T11:15:00');
    expect(resolveNewAppointmentEnd(start, dragged, 30)).toBe(dragged);
  });
});

describe('horario del consultorio', () => {
  const hours: BusinessHours = {
    mon: [
      ['09:00', '14:00'],
      ['16:00', '20:00'],
    ],
    sat: [['09:00', '13:00']],
  };
  const tz = 'America/Mexico_City';
  // 2026-09-28 es lunes; México (UTC-6, sin horario de verano) => 10:00 local = 16:00Z.
  const at = (day: string, hhmm: string) => new Date(`2026-09-${day}T${hhmm}:00-06:00`);

  it('acepta una cita dentro de un rango', () => {
    expect(isWithinBusinessHours(at('28', '10:00'), at('28', '10:30'), hours, tz)).toBe(true);
  });
  it('acepta terminar justo al cierre del rango', () => {
    expect(isWithinBusinessHours(at('28', '13:30'), at('28', '14:00'), hours, tz)).toBe(true);
  });
  it('rechaza el descanso y una cita que lo cruza', () => {
    expect(isWithinBusinessHours(at('28', '14:30'), at('28', '15:00'), hours, tz)).toBe(false);
    expect(isWithinBusinessHours(at('28', '13:45'), at('28', '14:15'), hours, tz)).toBe(false);
  });
  it('rechaza un día cerrado', () => {
    expect(isWithinBusinessHours(at('29', '10:00'), at('29', '10:30'), hours, tz)).toBe(false);
  });
  it('sin horario configurado no bloquea', () => {
    expect(isWithinBusinessHours(at('29', '03:00'), at('29', '03:30'), {}, tz)).toBe(true);
  });
  it('interpreta el horario en la zona del consultorio', () => {
    // 16:00Z del lunes es 10:00 en México pero 18:00 en Madrid (fuera del rango de la mañana).
    const s = new Date('2026-09-28T16:00:00Z');
    const e = new Date('2026-09-28T16:30:00Z');
    expect(isWithinBusinessHours(s, e, hours, tz)).toBe(true);
    expect(isWithinBusinessHours(s, e, { mon: [['09:00', '14:00']] }, 'Europe/Madrid')).toBe(false);
  });
});

describe('buildAgendaGrid', () => {
  it('sin horario usa la rejilla por defecto y no bloquea', () => {
    const grid = buildAgendaGrid({});
    expect(grid.businessHours).toBeNull();
    expect(grid.slotMinTime).toBe('08:00:00');
  });
  it('ajusta la rejilla y oculta los días cerrados', () => {
    const grid = buildAgendaGrid({ mon: [['09:00', '14:30']], sat: [['10:00', '13:00']] });
    expect(grid.businessHours).toHaveLength(2);
    expect(grid.businessHours![0]).toEqual({ daysOfWeek: [1], startTime: '09:00', endTime: '14:30' });
    expect(grid.slotMinTime).toBe('09:00:00');
    expect(grid.slotMaxTime).toBe('15:00:00');
    expect(grid.hiddenDays).toEqual([0, 2, 3, 4, 5]);
  });
});
