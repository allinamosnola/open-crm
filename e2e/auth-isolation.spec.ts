import { expect, test } from '@playwright/test';

import { login } from './support/auth';
import { PATIENTS, USERS } from './support/seed';

test.describe('Login y aislamiento entre consultorios', () => {
  test('sin sesión, el panel redirige al login', async ({ page }) => {
    await page.goto('/agenda');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
  });

  test('una contraseña incorrecta muestra el error y no entra', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(USERS.ownerA);
    await page.getByLabel('Contraseña').fill('incorrecta');
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();

    await expect(page.getByText('Correo o contraseña incorrectos')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('el consultorio A solo ve a sus pacientes', async ({ page }) => {
    await login(page, USERS.ownerA);
    await page.goto('/pacientes');

    const list = page.getByRole('main');
    await expect(list.getByRole('link', { name: PATIENTS.carlosA.name, exact: true })).toBeVisible();
    await expect(list.getByRole('link', { name: PATIENTS.mariaA.name })).toBeVisible();
    await expect(list.getByRole('link', { name: PATIENTS.anaB.name })).toHaveCount(0);
    await expect(list.getByRole('link', { name: PATIENTS.carlosB.name })).toHaveCount(0);

    // Ni con la URL directa: la RLS no devuelve el paciente de B.
    const response = await page.goto(`/pacientes/${PATIENTS.anaB.id}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText(PATIENTS.anaB.name)).toHaveCount(0);
  });

  test('el consultorio B solo ve a sus pacientes', async ({ page }) => {
    await login(page, USERS.ownerB);
    await page.goto('/pacientes');

    const list = page.getByRole('main');
    await expect(list.getByRole('link', { name: PATIENTS.anaB.name })).toBeVisible();
    await expect(list.getByRole('link', { name: PATIENTS.carlosB.name })).toBeVisible();
    await expect(list.getByRole('link', { name: PATIENTS.mariaA.name })).toHaveCount(0);

    const response = await page.goto(`/pacientes/${PATIENTS.mariaA.id}`);
    expect(response?.status()).toBe(404);
  });
});
