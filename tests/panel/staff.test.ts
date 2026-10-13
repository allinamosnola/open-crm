import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entitlements } from '@/lib/db/types';

import { createAdminFake, createServerFake, fake, type FakeError } from './fake-supabase';

// Mocks: clientes de Supabase en memoria, revalidatePath de Next y Sentry.
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => createServerFake() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => createAdminFake() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: vi.fn() }));

const { getCurrentStaff, inviteStaff, setStaffActive } = await import('@/lib/db/staff');

// Cuenta A (Pro) con dos sedes; cuenta B (Pro) con una.
const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';
const A1 = 'clinic-a1';
const A2 = 'clinic-a2';
const B1 = 'clinic-b1';
const ANA = 'user-ana'; // owner de A1 y A2
const LAURA = 'user-laura'; // recepcionista de A1
const JORGE = 'user-jorge'; // owner de B1

function entitlements(clinicId: string, overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    clinic_id: clinicId,
    account_id: ACCOUNT_A,
    plan: 'pro',
    bot_addon: false,
    bot_enabled: true,
    max_clinics: 3,
    max_doctors: 3,
    max_receptionists_per_clinic: 1,
    clinics_used: 2,
    doctors_used: 1,
    receptionists_used: 0,
    ...overrides,
  };
}

const triggerError = (hint: string): FakeError => ({
  code: 'P0001',
  message: 'tope',
  hint,
  details: null,
});

beforeEach(() => {
  fake.reset();
  fake.clinics.push(
    { id: A1, name: 'Sonrisas Centro', subscription_status: 'active', account_id: ACCOUNT_A },
    { id: A2, name: 'Sonrisas Sur', subscription_status: 'active', account_id: ACCOUNT_A },
    { id: B1, name: 'Dental Norte', subscription_status: 'active', account_id: ACCOUNT_B },
  );
  fake.staff.push(
    { id: ANA, clinic_id: A1, full_name: 'Dra. Ana', email: 'ana@demo.local', role: 'owner', active: true },
    { id: ANA, clinic_id: A2, full_name: 'Dra. Ana', email: 'ana@demo.local', role: 'owner', active: true },
    { id: LAURA, clinic_id: A1, full_name: 'Laura', email: 'laura@demo.local', role: 'receptionist', active: true },
    { id: JORGE, clinic_id: B1, full_name: 'Dr. Jorge', email: 'jorge@demo.local', role: 'owner', active: true },
  );
  for (const email of ['ana@demo.local', 'laura@demo.local', 'jorge@demo.local']) fake.authEmails.add(email);
  // Ana tiene activa la sede Sur.
  fake.userId = ANA;
  fake.entitlements = entitlements(A2);
});

describe('getCurrentStaff', () => {
  it('con dos membresías devuelve la del consultorio activo, con el plan de su cuenta', async () => {
    const me = await getCurrentStaff();
    expect(me).toEqual({
      id: ANA,
      full_name: 'Dra. Ana',
      role: 'owner',
      clinic: expect.objectContaining({
        id: A2,
        name: 'Sonrisas Sur',
        subscription_status: 'active',
        account: {
          account_id: ACCOUNT_A,
          plan: 'pro',
          bot_addon: false,
          bot_enabled: true,
          max_clinics: 3,
          max_doctors: 3,
        },
      }),
    });

    fake.entitlements = entitlements(A1);
    expect((await getCurrentStaff())?.clinic.id).toBe(A1);
  });

  it('sin sesión o sin membresía activa devuelve null', async () => {
    fake.userId = null;
    expect(await getCurrentStaff()).toBeNull();

    fake.userId = ANA;
    fake.entitlements = null;
    expect(await getCurrentStaff()).toBeNull();
  });

  it('si el consultorio activo no está entre sus membresías activas devuelve null', async () => {
    fake.entitlements = entitlements(B1, { account_id: ACCOUNT_B });
    expect(await getCurrentStaff()).toBeNull();
  });
});

describe('inviteStaff', () => {
  it('un correo de otra sede de la misma cuenta se agrega sin invitar de nuevo', async () => {
    const result = await inviteStaff({ email: 'Laura@Demo.local', full_name: 'Laura', role: 'receptionist' });

    expect(result).toEqual({ ok: true, data: { id: LAURA } });
    expect(fake.invited).toEqual([]);
    expect(fake.staff.filter((s) => s.id === LAURA).map((s) => s.clinic_id)).toEqual([A1, A2]);
    expect(fake.staff.find((s) => s.id === LAURA && s.clinic_id === A2)).toMatchObject({
      email: 'laura@demo.local',
      role: 'receptionist',
    });
  });

  it('un correo de otra cuenta se rechaza y no se agrega', async () => {
    const result = await inviteStaff({ email: 'jorge@demo.local', full_name: 'Jorge', role: 'dentist' });
    expect(result).toEqual({ ok: false, error: 'Ese correo ya tiene una cuenta en la plataforma' });
    expect(fake.staff.filter((s) => s.id === JORGE)).toHaveLength(1);
    expect(fake.invited).toEqual([]);
  });

  it('un correo que ya es personal de este consultorio se rechaza', async () => {
    fake.entitlements = entitlements(A1);
    const result = await inviteStaff({ email: 'laura@demo.local', full_name: 'Laura', role: 'receptionist' });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('ya es parte del personal') });
  });

  it('al agregar de la misma cuenta, el tope del trigger se traduce a español', async () => {
    fake.nextWriteError = triggerError('max_receptionists');
    const result = await inviteStaff({ email: 'laura@demo.local', full_name: 'Laura', role: 'receptionist' });
    expect(result).toEqual({
      ok: false,
      error: 'Este consultorio ya tiene a su recepcionista activo. Desactívalo para agregar a otra persona.',
    });
  });

  it('una persona nueva con el tope de doctores alcanzado no recibe invitación', async () => {
    fake.entitlements = entitlements(A2, {
      plan: 'basic',
      max_clinics: 1,
      max_doctors: 1,
      doctors_used: 1,
    });
    const result = await inviteStaff({ email: 'nuevo@demo.local', full_name: 'Dr. Nuevo', role: 'dentist' });
    expect(result).toEqual({
      ok: false,
      error: 'Tu plan Básico incluye 1 doctor. Sube a Pro para agregar más.',
    });
    expect(fake.invited).toEqual([]);
  });

  it('una persona nueva dentro del tope se invita', async () => {
    const result = await inviteStaff({ email: 'nuevo@demo.local', full_name: 'Dr. Nuevo', role: 'dentist' });
    expect(result).toEqual({ ok: true, data: { id: 'user-nuevo@demo.local' } });
    expect(fake.invited).toEqual(['nuevo@demo.local']);
    expect(fake.staff.find((s) => s.id === 'user-nuevo@demo.local')).toMatchObject({ clinic_id: A2 });
  });

  it('si el trigger rechaza a la persona nueva, se borra el usuario y se explica el tope', async () => {
    fake.nextWriteError = triggerError('max_doctors');
    const result = await inviteStaff({ email: 'nuevo@demo.local', full_name: 'Dr. Nuevo', role: 'dentist' });
    expect(result).toEqual({
      ok: false,
      error: 'Tu plan Pro incluye 3 doctores. Sube a Plus para agregar más.',
    });
    expect(fake.deletedUsers).toEqual(['user-nuevo@demo.local']);
  });
});

describe('setStaffActive', () => {
  it('solo cambia la membresía del consultorio activo', async () => {
    fake.staff.push({
      id: LAURA,
      clinic_id: A2,
      full_name: 'Laura',
      email: 'laura@demo.local',
      role: 'receptionist',
      active: true,
    });
    expect(await setStaffActive(LAURA, false)).toEqual({ ok: true, data: { id: LAURA } });
    const laura = fake.staff.filter((s) => s.id === LAURA);
    expect(laura.find((s) => s.clinic_id === A2)?.active).toBe(false);
    expect(laura.find((s) => s.clinic_id === A1)?.active).toBe(true);
  });

  it('al reactivar, el tope del trigger se traduce a español', async () => {
    fake.staff.push({ id: 'user-x', clinic_id: A2, full_name: 'X', email: 'x@demo.local', role: 'dentist', active: false });
    fake.nextWriteError = triggerError('max_doctors');
    expect(await setStaffActive('user-x', true)).toEqual({
      ok: false,
      error: 'Tu plan Pro incluye 3 doctores. Sube a Plus para agregar más.',
    });
  });
});
