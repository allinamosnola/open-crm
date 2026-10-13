import { describe, expect, it } from 'vitest';

import { ProvisioningError, buildSlug, createAccountWithOwner } from '@/lib/provisioning/account';

import { createFakeAdmin } from '../stubs/fake-admin';

const input = {
  name: 'Consultorio Sonrisas',
  slug: 'sonrisas-ab12',
  plan: 'pro' as const,
  botAddon: false,
  ownerEmail: 'dra@ejemplo.com',
  ownerName: 'Dra. Ana',
  subscriptionStatus: 'trial' as const,
};

describe('buildSlug', () => {
  it('quita acentos y símbolos y agrega el sufijo', () => {
    expect(buildSlug('Clínica Dental «Niño» & Cía.', 'ab12')).toBe('clinica-dental-nino-cia-ab12');
  });
  it('cae a «consultorio» si el nombre no deja letras ni números', () => {
    expect(buildSlug('¿¿??', 'ab12')).toBe('consultorio-ab12');
  });
  it('acorta nombres largos y cumple el formato de la base', () => {
    const slug = buildSlug('a'.repeat(100), 'ab12');
    expect(slug.length).toBeLessThanOrEqual(45);
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(buildSlug('Hola')).toMatch(/^hola-[a-z0-9]{4}$/);
  });
});

describe('createAccountWithOwner', () => {
  it('crea cuenta, consultorio, invitación y owner', async () => {
    const { admin, state } = createFakeAdmin();
    const created = await createAccountWithOwner(admin as never, input);
    expect(state.tables.accounts).toHaveLength(1);
    expect(state.tables.accounts[0]).toMatchObject({ plan: 'pro', bot_addon: false });
    expect(state.tables.clinics[0]).toMatchObject({ slug: 'sonrisas-ab12', subscription_status: 'trial' });
    expect(state.tables.staff[0]).toMatchObject({ role: 'owner', email: 'dra@ejemplo.com', id: created.ownerId });
    expect(state.invites).toEqual(['dra@ejemplo.com']);
  });

  it('con el correo ya registrado no deja nada creado', async () => {
    const { admin, state } = createFakeAdmin();
    state.authUsers.set('dra@ejemplo.com', 'user_previo');
    await expect(createAccountWithOwner(admin as never, input)).rejects.toMatchObject({
      code: 'email_exists',
    });
    expect(state.tables.accounts).toHaveLength(0);
    expect(state.tables.clinics).toHaveLength(0);
  });

  it('un correo que ya es personal (aunque no haya confirmado) no liga la persona a otra cuenta', async () => {
    const { admin, state } = createFakeAdmin();
    await createAccountWithOwner(admin as never, input);
    await expect(
      createAccountWithOwner(admin as never, { ...input, slug: 'otro-cd34', name: 'Otro' }),
    ).rejects.toMatchObject({ code: 'email_exists' });
    expect(state.tables.accounts).toHaveLength(1);
    expect(state.invites).toHaveLength(1);
  });

  it('si falla el staff borra el usuario invitado, el consultorio y la cuenta', async () => {
    const { admin, state } = createFakeAdmin();
    state.fail['staff.insert'] = { message: 'boom' };
    await expect(createAccountWithOwner(admin as never, input)).rejects.toBeInstanceOf(ProvisioningError);
    expect(state.authUsers.size).toBe(0);
    expect(state.tables.clinics).toHaveLength(0);
    expect(state.tables.accounts).toHaveLength(0);
  });

  it('un slug repetido se reporta como slug_taken y deshace la cuenta', async () => {
    const { admin, state } = createFakeAdmin();
    await createAccountWithOwner(admin as never, input);
    await expect(
      createAccountWithOwner(admin as never, { ...input, ownerEmail: 'otro@ejemplo.com' }),
    ).rejects.toMatchObject({ code: 'slug_taken' });
    expect(state.tables.accounts).toHaveLength(1);
  });
});
