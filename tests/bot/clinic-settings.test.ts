import { describe, expect, it } from 'vitest';

import { clinicSettingsSchema } from '@/lib/db/schemas';
import { parseBusinessHours } from '@/lib/db/types';

const valid = {
  timezone: 'America/Mexico_City',
  business_hours: { mon: [['09:00', '14:00'], ['16:00', '20:00']], sat: [['09:00', '13:00']], sun: [] },
  default_appointment_minutes: '45',
  reception_email: ' Recepcion@Demo.Local ',
};

describe('clinicSettingsSchema (configuración del consultorio)', () => {
  it('acepta un horario partido, omite días vacíos y normaliza el correo', () => {
    const parsed = clinicSettingsSchema.parse(valid);
    expect(parsed).toEqual({
      timezone: 'America/Mexico_City',
      business_hours: { mon: [['09:00', '14:00'], ['16:00', '20:00']], sat: [['09:00', '13:00']] },
      default_appointment_minutes: 45,
      reception_email: 'recepcion@demo.local',
    });
    expect(clinicSettingsSchema.parse({ ...valid, reception_email: '' }).reception_email).toBeNull();
  });

  it('rechaza horarios inválidos, traslapes, días desconocidos, zona y duración fuera de rango', () => {
    const bad = (overrides: Record<string, unknown>) => clinicSettingsSchema.safeParse({ ...valid, ...overrides }).success;
    expect(bad({ business_hours: { mon: [['14:00', '09:00']] } })).toBe(false);
    expect(bad({ business_hours: { mon: [['09:00', '14:00'], ['13:00', '15:00']] } })).toBe(false);
    expect(bad({ business_hours: { mon: [['9:00', '14:00']] } })).toBe(false);
    expect(bad({ business_hours: { lunes: [['09:00', '14:00']] } })).toBe(false);
    expect(bad({ timezone: 'Mexico/Narnia' })).toBe(false);
    expect(bad({ default_appointment_minutes: 5 })).toBe(false);
    expect(bad({ default_appointment_minutes: 30.5 })).toBe(false);
    expect(bad({ reception_email: 'no-es-correo' })).toBe(false);
    // Rangos contiguos sí se permiten.
    expect(bad({ business_hours: { mon: [['09:00', '14:00'], ['14:00', '15:00']] } })).toBe(true);
  });

  it('parseBusinessHours descarta lo que no tiene el formato esperado', () => {
    expect(
      parseBusinessHours({ mon: [['09:00', '14:00'], ['x', '10:00'], ['12:00', '11:00']], foo: [['09:00', '10:00']], tue: 'no' }),
    ).toEqual({ mon: [['09:00', '14:00']] });
    expect(parseBusinessHours(null)).toEqual({});
  });
});
