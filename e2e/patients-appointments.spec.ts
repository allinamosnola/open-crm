import { expect, test } from '@playwright/test';

import { adminClient } from './support/admin';
import { login } from './support/auth';
import { USERS } from './support/seed';

// Paciente y cita propios de esta corrida; se borran al final para poder repetir
// la prueba sobre la misma base sin traslapes.
const runId = Date.now().toString(36);
const patientName = `E2E Paciente ${runId}`;
const reason = `E2E cita ${runId}`;
// Teléfono único (+52 + 10 dígitos) derivado de la hora.
const phone = `+5255${String(Date.now()).slice(-8)}`;

// Próximo día hábil del consultorio A (lun-vie) a 3 semanas, 17:00 (horario 16:00-20:00).
function appointmentDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 21);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test.afterAll(async () => {
  const admin = adminClient();
  await admin.from('appointments').delete().eq('reason', reason);
  await admin.from('patients').delete().eq('full_name', patientName);
});

test('la recepción registra un paciente y le agenda una cita', async ({ page }) => {
  await login(page, USERS.receptionA);

  // Alta del paciente
  await page.goto('/pacientes');
  await page.getByRole('link', { name: 'Nuevo paciente' }).click();
  await page.getByRole('button', { name: 'Registrar paciente' }).click();
  await expect(page.getByText('El nombre es obligatorio')).toBeVisible();

  await page.getByLabel('Nombre completo *').fill(patientName);
  await page.getByLabel('Teléfono (WhatsApp)').fill(phone);
  await page.getByRole('button', { name: 'Registrar paciente' }).click();

  await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}$/);
  const patientUrl = page.url();
  await expect(page.getByLabel('Nombre completo *')).toHaveValue(patientName);
  await expect(page.getByRole('tab', { name: 'Citas (0)' })).toBeVisible();

  // Cita desde la agenda
  await page.goto('/agenda');
  await page.getByRole('button', { name: 'Nueva cita' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva cita' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('combobox', { name: 'Paciente *' }).click();
  await page.getByPlaceholder('Nombre o teléfono').fill(runId);
  await page.getByRole('option', { name: new RegExp(patientName) }).click();

  await dialog.getByLabel('Inicio *').fill(appointmentDate());
  await dialog.getByRole('combobox', { name: 'Hora' }).first().click();
  await page.getByRole('option', { name: '17', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Minutos' }).first().click();
  await page.getByRole('option', { name: '00', exact: true }).click();
  await dialog.getByLabel('Motivo').fill(reason);

  await dialog.getByRole('button', { name: 'Agendar cita' }).click();
  await expect(page.getByText('Cita agendada')).toBeVisible();
  await expect(dialog).toBeHidden();

  // La ficha del paciente muestra la cita.
  await page.goto(patientUrl);
  await page.getByRole('tab', { name: 'Citas (1)' }).click();
  await expect(page.getByRole('cell', { name: reason })).toBeVisible();
});
