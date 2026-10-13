import { expect, type Page } from '@playwright/test';

import { PASSWORD } from './seed';

// Inicia sesión por el formulario y espera la agenda.
export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/agenda$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible();
}
