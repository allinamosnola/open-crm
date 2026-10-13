import { expect, test } from '@playwright/test';

import { login } from './support/auth';
import { USERS } from './support/seed';

test('el plan Básico sin bot no tiene bandeja de WhatsApp', async ({ page }) => {
  await login(page, USERS.ownerBasic);

  const nav = page.getByRole('navigation', { name: 'Secciones' });
  await expect(nav.getByRole('link', { name: /Agenda/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Conversaciones/ })).toHaveCount(0);

  // La URL directa muestra la invitación a activar el bot en lugar de la bandeja.
  await page.goto('/conversaciones');
  await expect(page.getByText('Activa el bot de WhatsApp')).toBeVisible();
  await expect(page.getByText('Tu plan Básico no incluye el bot de WhatsApp.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Mensajes' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Ver mi plan' }).click();
  await expect(page).toHaveURL(/\/configuracion\/plan$/);
  await expect(page.getByText('Plan Básico', { exact: false }).first()).toBeVisible();
});

test('un plan Pro sí ve la bandeja', async ({ page }) => {
  await login(page, USERS.ownerA);
  const nav = page.getByRole('navigation', { name: 'Secciones' });
  await expect(nav.getByRole('link', { name: /Conversaciones/ })).toBeVisible();
});
