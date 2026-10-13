import { describe, expect, it } from 'vitest';

import { SAMPLE_BUSINESS_HOURS } from '@/lib/bot/memory-repository';
import {
  describeBusinessHours,
  findSlots,
  formatSlotLabel,
  zonedTimeToUtc,
  type SlotSearch,
} from '@/lib/bot/slots';

import { ANA, NOW, PABLO } from './helpers';

// NOW = lunes 5 de octubre de 2026, 06:00 en Ciudad de México (UTC-6).
const TZ = 'America/Mexico_City';
const ana = { id: ANA, full_name: 'Dra. Ana López' };
const pablo = { id: PABLO, full_name: 'Dr. Pablo Ruiz' };

// "2026-10-05 09:00" hora de CDMX -> ISO UTC.
const cdmx = (date: string, time: string) => new Date(`${date}T${time}:00-06:00`).toISOString();

function search(overrides: Partial<SlotSearch> = {}): SlotSearch {
  return {
    now: NOW,
    timeZone: TZ,
    businessHours: SAMPLE_BUSINESS_HOURS,
    durationMinutes: 30,
    dentists: [ana, pablo],
    busy: [],
    ...overrides,
  };
}

describe('findSlots', () => {
  it('propone 3 huecos, uno por día, dentro del horario', () => {
    const slots = findSlots(search());
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => [s.local_date, s.local_time])).toEqual([
      ['2026-10-05', '09:00'],
      ['2026-10-06', '09:00'],
      ['2026-10-07', '09:00'],
    ]);
    expect(slots[0].starts_at).toBe(cdmx('2026-10-05', '09:00'));
    expect(slots[0].ends_at).toBe(cdmx('2026-10-05', '09:30'));
  });

  it('respeta el horario partido: nada entre 14:00 y 16:00 y ninguna cita termina después del cierre', () => {
    const slots = findSlots(search({ from: '2026-10-05', to: '2026-10-05', durationMinutes: 45, limit: 50 }));
    const times = slots.map((s) => s.local_time);
    // 13:30 terminaría a las 14:15 (fuera del rango de la mañana); 19:00 termina a las 19:45 (cabe).
    expect(times).toEqual(['09:00', '09:45', '10:30', '11:15', '12:00', '12:45', '16:00', '16:45', '17:30', '18:15', '19:00']);
  });

  it('filtra por parte del día', () => {
    const manana = findSlots(search({ from: '2026-10-05', to: '2026-10-05', partOfDay: 'manana', limit: 50 }));
    expect(manana.every((s) => s.local_time < '12:00')).toBe(true);
    // La tarde empieza a las 12:00 (el rango de 09:00-14:00 también cuenta).
    const tarde = findSlots(search({ from: '2026-10-05', to: '2026-10-05', partOfDay: 'tarde', limit: 50 }));
    expect(tarde[0].local_time).toBe('12:00');
    expect(tarde.map((s) => s.local_time)).toContain('16:00');
    expect(tarde.every((s) => s.local_time >= '12:00' && s.local_time < '19:00')).toBe(true);
    const noche = findSlots(search({ from: '2026-10-05', to: '2026-10-05', partOfDay: 'noche' }));
    expect(noche.map((s) => s.local_time)).toEqual(['19:00', '19:30']);
  });

  it('no traslapa con citas existentes del dentista y usa a otro dentista si está libre', () => {
    const onlyAna = findSlots(
      search({
        dentists: [ana],
        from: '2026-10-05',
        to: '2026-10-05',
        busy: [{ dentist_id: ANA, starts_at: cdmx('2026-10-05', '09:00'), ends_at: cdmx('2026-10-05', '10:15') }],
      }),
    );
    expect(onlyAna[0].local_time).toBe('10:30');

    const both = findSlots(
      search({
        from: '2026-10-05',
        to: '2026-10-05',
        busy: [{ dentist_id: ANA, starts_at: cdmx('2026-10-05', '09:00'), ends_at: cdmx('2026-10-05', '09:30') }],
      }),
    );
    expect(both[0]).toMatchObject({ local_time: '09:00', dentist_id: PABLO });
    expect(both[1]).toMatchObject({ local_time: '09:30', dentist_id: ANA });
  });

  it('no propone en el pasado y exige 2 horas de anticipación', () => {
    // Lunes 10:10 en CDMX: lo más pronto es 12:10 -> primer hueco 12:30.
    const now = new Date(cdmx('2026-10-05', '10:10'));
    const slots = findSlots(search({ now, from: '2026-10-05', to: '2026-10-05' }));
    expect(slots[0].local_time).toBe('12:30');
    expect(findSlots(search({ from: '2026-10-04', to: '2026-10-04' }))).toEqual([]);
  });

  it('no pasa del horizonte de 14 días', () => {
    // Límite: lunes 19 de octubre a las 06:00; el domingo 18 está cerrado.
    const slots = findSlots(search({ from: '2026-10-17', to: '2026-10-25', limit: 50 }));
    expect(slots.length).toBeGreaterThan(0);
    expect(new Set(slots.map((s) => s.local_date))).toEqual(new Set(['2026-10-17']));
    expect(findSlots(search({ from: '2026-10-19' }))).toEqual([]);
  });

  it('usa la zona horaria del consultorio', () => {
    // Tijuana en octubre de 2026: UTC-7 (horario de verano hasta el 1 de noviembre).
    const slots = findSlots(search({ timeZone: 'America/Tijuana' }));
    expect(slots[0]).toMatchObject({ local_date: '2026-10-05', local_time: '09:00' });
    expect(slots[0].starts_at).toBe('2026-10-05T16:00:00.000Z');
  });

  it('prefiere al dentista habitual y completa con otros si no alcanza', () => {
    const withPablo = findSlots(search({ preferredDentistId: PABLO }));
    expect(withPablo.map((s) => s.dentist_id)).toEqual([PABLO, PABLO, PABLO]);

    // Pablo solo tiene libre el martes de 16:00 a 16:30.
    const busyPablo = [
      { dentist_id: PABLO, starts_at: cdmx('2026-10-05', '00:00'), ends_at: cdmx('2026-10-06', '16:00') },
      { dentist_id: PABLO, starts_at: cdmx('2026-10-06', '16:30'), ends_at: cdmx('2026-10-31', '00:00') },
    ];
    const mixed = findSlots(search({ preferredDentistId: PABLO, busy: busyPablo }));
    expect(mixed).toHaveLength(3);
    expect(mixed).toContainEqual(expect.objectContaining({ dentist_id: PABLO, local_date: '2026-10-06', local_time: '16:00' }));
    expect(mixed.filter((s) => s.dentist_id === ANA)).toHaveLength(2);

    // Un dentista habitual que ya no está activo se ignora.
    const inactive = findSlots(search({ dentists: [ana], preferredDentistId: PABLO }));
    expect(inactive.every((s) => s.dentist_id === ANA)).toBe(true);
  });

  it('sin horario o sin dentistas no hay huecos', () => {
    expect(findSlots(search({ businessHours: {} }))).toEqual([]);
    expect(findSlots(search({ dentists: [] }))).toEqual([]);
  });
});

describe('zona horaria y etiquetas', () => {
  it('convierte hora local a UTC y detecta horas que no existen (horario de verano)', () => {
    expect(zonedTimeToUtc({ year: 2026, month: 11, day: 1, hour: 9, minute: 0 }, 'America/New_York')?.toISOString()).toBe(
      '2026-11-01T14:00:00.000Z',
    );
    // 8 de marzo de 2026: en Nueva York el reloj salta de 02:00 a 03:00.
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York')).toBeNull();
  });

  it('formatea en español con la hora del consultorio', () => {
    expect(formatSlotLabel(cdmx('2026-10-05', '09:00'), TZ)).toBe('lunes 5 de octubre, 09:00');
    expect(describeBusinessHours({ mon: [['09:00', '14:00'], ['16:00', '20:00']] })).toBe(
      'lunes: 09:00-14:00 y 16:00-20:00; martes: cerrado; miércoles: cerrado; jueves: cerrado; viernes: cerrado; sábado: cerrado; domingo: cerrado',
    );
  });
});
