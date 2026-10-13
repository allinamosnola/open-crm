import { describe, expect, it } from 'vitest';

import { buildContextPrompt, SYSTEM_PROMPT } from '@/lib/bot/prompt';
import type { ClinicInfo, PatientInfo } from '@/lib/bot/repository';
import type { OfferedSlot } from '@/lib/bot/state';

const clinic: ClinicInfo = {
  id: 'clinic-a',
  name: 'Consultorio Sonrisas',
  timezone: 'America/Mexico_City',
  business_hours: { mon: [['09:00', '14:00']] },
  default_appointment_minutes: 30,
  reception_email: null,
};

const patient: PatientInfo = { id: 'p1', full_name: 'Juan Pérez', status: 'active', phone: '+525500000001' };

const base = { now: new Date('2026-09-24T18:00:00Z'), clinic, patient, upcoming: [] };

const slot = (id: string, label: string, dentist: string): OfferedSlot => ({
  id,
  dentist_id: 'd1',
  dentist_name: dentist,
  starts_at: '2026-09-24T22:00:00Z',
  ends_at: '2026-09-24T22:30:00Z',
  label,
});

describe('buildContextPrompt: horarios ya ofrecidos', () => {
  it('lista los horarios ofrecidos con su hueco_id para que el modelo no tenga que volver a buscar', () => {
    const text = buildContextPrompt({
      ...base,
      offeredSlots: [
        slot('H1', 'jueves 24 de septiembre a las 16:00', 'Dra. Ana'),
        slot('H2', 'jueves 24 de septiembre a las 16:30', 'Dra. Ana'),
      ],
    });
    expect(text).toContain('jueves 24 de septiembre a las 16:00 con Dra. Ana (hueco_id: H1)');
    expect(text).toContain('jueves 24 de septiembre a las 16:30 con Dra. Ana (hueco_id: H2)');
  });

  it('indica que no hay ninguno cuando no se ha ofrecido nada', () => {
    expect(buildContextPrompt(base)).toMatch(/ya ofreciste[^\n]*\n- ninguno/);
  });

  it('la instrucción fija manda usar el hueco_id sin volver a buscar', () => {
    expect(SYSTEM_PROMPT).toContain('sin volver a buscar');
  });
});
