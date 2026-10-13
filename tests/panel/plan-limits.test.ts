import { describe, expect, it } from 'vitest';

import { planLimitError, planLimitHint, planLimitMessage } from '@/lib/db/plan-limits';

// Planes como los devuelve account_entitlements (null = ilimitado).
const BASIC = { plan: 'basic', max_clinics: 1, max_doctors: 1 } as const;
const PRO = { plan: 'pro', max_clinics: 3, max_doctors: 3 } as const;
const PLUS = { plan: 'plus', max_clinics: null, max_doctors: null } as const;

// Error de PostgREST tal como llega de los triggers de la Fase 1.
const triggerError = (hint: string) => ({
  code: 'P0001',
  hint,
  message: 'El plan de la cuenta permite 1 doctor(es) y ya tiene 1',
  details: null,
});

describe('planLimitHint', () => {
  it('reconoce los cuatro topes de los triggers', () => {
    for (const hint of ['max_clinics', 'max_doctors', 'max_receptionists', 'bot_required']) {
      expect(planLimitHint(triggerError(hint))).toBe(hint);
    }
  });

  it('ignora otros errores', () => {
    expect(planLimitHint(null)).toBeNull();
    expect(planLimitHint({ code: '23505', hint: 'max_doctors' })).toBeNull();
    expect(planLimitHint({ code: 'P0001', hint: null })).toBeNull();
    expect(planLimitHint({ code: 'P0001', hint: 'otro_tope' })).toBeNull();
  });
});

describe('planLimitMessage', () => {
  it('doctores: dice el tope del plan y a cuál subir', () => {
    expect(planLimitMessage('max_doctors', BASIC)).toBe(
      'Tu plan Básico incluye 1 doctor. Sube a Pro para agregar más.',
    );
    expect(planLimitMessage('max_doctors', PRO)).toBe(
      'Tu plan Pro incluye 3 doctores. Sube a Plus para agregar más.',
    );
  });

  it('consultorios: dice el tope del plan y a cuál subir', () => {
    expect(planLimitMessage('max_clinics', BASIC)).toBe(
      'Tu plan Básico incluye 1 consultorio. Sube a Pro para agregar más.',
    );
    expect(planLimitMessage('max_clinics', PRO)).toBe(
      'Tu plan Pro incluye 3 consultorios. Sube a Plus para agregar más.',
    );
  });

  it('recepción: no sugiere subir de plan (es igual en todos)', () => {
    const msg = planLimitMessage('max_receptionists', PRO);
    expect(msg).toContain('recepcionista');
    expect(msg).not.toContain('Sube a');
  });

  it('bot: sugiere el complemento o Pro', () => {
    expect(planLimitMessage('bot_required', BASIC)).toBe(
      'Tu plan Básico no incluye el bot de WhatsApp. Agrega el complemento Bot o sube a Pro.',
    );
  });

  it('sin datos del plan (o ilimitado) da un mensaje genérico en español', () => {
    expect(planLimitMessage('max_doctors')).toBe(
      'Tu plan no permite agregar más doctores. Sube de plan para agregar más.',
    );
    expect(planLimitMessage('max_doctors', PLUS)).toBe(
      'Tu plan no permite agregar más doctores. Sube de plan para agregar más.',
    );
    expect(planLimitMessage('max_clinics', null)).toContain('consultorios');
  });
});

describe('planLimitError', () => {
  it('traduce el error de tope y deja pasar los demás', () => {
    expect(planLimitError(triggerError('max_doctors'), BASIC)).toBe(
      'Tu plan Básico incluye 1 doctor. Sube a Pro para agregar más.',
    );
    expect(planLimitError({ code: '42501', hint: null }, BASIC)).toBeNull();
  });
});
