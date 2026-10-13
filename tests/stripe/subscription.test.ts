import { describe, expect, it } from 'vitest';

import {
  PRICE_KEYS,
  clinicStatusFor,
  desiredItems,
  extraClinicsFor,
  planItemChanges,
  resolveSubscription,
} from '@/lib/stripe/subscription';

const item = (lookupKey: string | null, quantity = 1) => ({ lookupKey, quantity });

describe('resolveSubscription', () => {
  it('Básico sin complemento', () => {
    expect(resolveSubscription([item(PRICE_KEYS.basic)])).toEqual({
      plan: 'basic',
      botAddon: false,
      extraClinics: 0,
    });
  });

  it('Básico con complemento Bot', () => {
    const items = [
      item(PRICE_KEYS.basic),
      item(PRICE_KEYS.bot),
    ];
    expect(resolveSubscription(items)).toMatchObject({ plan: 'basic', botAddon: true });
  });

  it('Pro no registra el complemento aunque venga en los ítems', () => {
    const items = [
      item(PRICE_KEYS.pro),
      item(PRICE_KEYS.bot),
    ];
    expect(resolveSubscription(items)).toEqual({
      plan: 'pro',
      botAddon: false,
      extraClinics: 0,
    });
  });

  it('Plus cuenta los consultorios extra', () => {
    const items = [
      item(PRICE_KEYS.plus),
      item(PRICE_KEYS.extraClinic, 3),
    ];
    expect(resolveSubscription(items)).toEqual({
      plan: 'plus',
      botAddon: false,
      extraClinics: 3,
    });
  });

  it('el ítem extra no cuenta fuera de Plus', () => {
    const items = [
      item(PRICE_KEYS.pro),
      item(PRICE_KEYS.extraClinic, 2),
    ];
    expect(resolveSubscription(items).extraClinics).toBe(0);
  });

  it('un ítem sin lookup_key (precio ajeno) no cuenta como base', () => {
    expect(() => resolveSubscription([item(null), item('otro')])).toThrow();
    expect(resolveSubscription([item(PRICE_KEYS.pro), item(null)]).plan).toBe('pro');
  });

  it('lanza sin precio base o con dos', () => {
    expect(() => resolveSubscription([item(PRICE_KEYS.bot)])).toThrow();
    expect(() => resolveSubscription([item(PRICE_KEYS.basic), item(PRICE_KEYS.pro)])).toThrow();
  });
});

describe('clinicStatusFor', () => {
  it.each([
    ['active', 'active'],
    ['trialing', 'active'],
    ['past_due', 'past_due'],
    ['unpaid', 'past_due'],
    ['incomplete', 'past_due'],
    ['paused', 'past_due'],
    ['canceled', 'canceled'],
    ['incomplete_expired', 'canceled'],
    ['algo_nuevo', 'past_due'],
  ])('%s -> %s', (stripe, clinic) => {
    expect(clinicStatusFor(stripe)).toBe(clinic);
  });
});

describe('extraClinicsFor', () => {
  it('Plus incluye 5 consultorios', () => {
    expect(extraClinicsFor(0)).toBe(0);
    expect(extraClinicsFor(5)).toBe(0);
    expect(extraClinicsFor(6)).toBe(1);
    expect(extraClinicsFor(8)).toBe(3);
  });
});

describe('desiredItems', () => {
  it('Básico lleva el Bot solo si se pide', () => {
    expect(desiredItems('basic', false, 1)).toEqual([{ key: PRICE_KEYS.basic, quantity: 1 }]);
    expect(desiredItems('basic', true, 1)).toEqual([
      { key: PRICE_KEYS.basic, quantity: 1 },
      { key: PRICE_KEYS.bot, quantity: 1 },
    ]);
  });

  it('Pro y Plus ya incluyen el bot: no llevan el ítem Bot', () => {
    expect(desiredItems('pro', true, 2)).toEqual([{ key: PRICE_KEYS.pro, quantity: 1 }]);
    expect(desiredItems('plus', true, 2)).toEqual([{ key: PRICE_KEYS.plus, quantity: 1 }]);
  });

  it('Plus cobra los consultorios por encima de 5', () => {
    expect(desiredItems('plus', false, 5)).toHaveLength(1);
    expect(desiredItems('plus', false, 8)).toContainEqual({ key: PRICE_KEYS.extraClinic, quantity: 3 });
  });
});

describe('planItemChanges', () => {
  const ids: Record<string, string> = {
    [PRICE_KEYS.basic]: 'p_basic',
    [PRICE_KEYS.pro]: 'p_pro',
    [PRICE_KEYS.plus]: 'p_plus',
    [PRICE_KEYS.bot]: 'p_bot',
    [PRICE_KEYS.extraClinic]: 'p_extra',
  };
  const cur = (id: string, key: string | null, quantity = 1) => ({ id, lookupKey: key, quantity });

  it('sin cambios devuelve []', () => {
    const current = [cur('si_1', PRICE_KEYS.basic), cur('si_2', PRICE_KEYS.bot)];
    expect(planItemChanges(current, desiredItems('basic', true, 1), ids)).toEqual([]);
  });

  it('Básico -> Básico + Bot agrega el ítem Bot', () => {
    expect(
      planItemChanges([cur('si_1', PRICE_KEYS.basic)], desiredItems('basic', true, 1), ids),
    ).toEqual([{ price: 'p_bot', quantity: 1 }]);
  });

  it('Básico + Bot -> Pro cambia el precio base y quita el Bot', () => {
    const current = [cur('si_1', PRICE_KEYS.basic), cur('si_2', PRICE_KEYS.bot)];
    expect(planItemChanges(current, desiredItems('pro', false, 1), ids)).toEqual([
      { id: 'si_1', price: 'p_pro' },
      { id: 'si_2', deleted: true },
    ]);
  });

  it('Pro -> Plus con 7 consultorios agrega 2 extra', () => {
    expect(
      planItemChanges([cur('si_1', PRICE_KEYS.pro)], desiredItems('plus', false, 7), ids),
    ).toEqual([
      { id: 'si_1', price: 'p_plus' },
      { price: 'p_extra', quantity: 2 },
    ]);
  });

  it('Plus -> Pro quita los consultorios extra', () => {
    const current = [cur('si_1', PRICE_KEYS.plus), cur('si_2', PRICE_KEYS.extraClinic, 3)];
    expect(planItemChanges(current, desiredItems('pro', false, 8), ids)).toEqual([
      { id: 'si_1', price: 'p_pro' },
      { id: 'si_2', deleted: true },
    ]);
  });

  it('Plus ajusta la cantidad de extras sin tocar el precio base', () => {
    const current = [cur('si_1', PRICE_KEYS.plus), cur('si_2', PRICE_KEYS.extraClinic, 1)];
    expect(planItemChanges(current, desiredItems('plus', false, 9), ids)).toEqual([
      { id: 'si_2', quantity: 4 },
    ]);
  });

  it('no toca ítems ajenos y lanza si no hay precio base', () => {
    const current = [cur('si_1', PRICE_KEYS.basic), cur('si_9', null)];
    expect(planItemChanges(current, desiredItems('pro', false, 1), ids)).toEqual([
      { id: 'si_1', price: 'p_pro' },
    ]);
    expect(() => planItemChanges([cur('si_9', null)], desiredItems('pro', false, 1), ids)).toThrow();
  });
});
