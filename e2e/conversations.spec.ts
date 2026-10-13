import { expect, test } from '@playwright/test';

import { login } from './support/auth';
import { CLINIC_A_WHATSAPP, MARIA_CONVERSATION, PATIENTS, USERS } from './support/seed';
import { inboundParams, postTwilioWebhook } from './support/twilio';

const body = `E2E: ¿tienen cita el sábado? ${Date.now().toString(36)}`;

test.describe('Bandeja de conversaciones con el webhook de Twilio simulado', () => {
  test('rechaza un webhook con firma inválida', async ({ request }) => {
    const params = inboundParams({ from: MARIA_CONVERSATION.from, to: CLINIC_A_WHATSAPP, body });
    const response = await postTwilioWebhook(request, params, 'firma-falsa');
    expect(response.status()).toBe(403);
  });

  test('un mensaje entrante firmado llega a la bandeja una sola vez', async ({ page, request }) => {
    const params = inboundParams({ from: MARIA_CONVERSATION.from, to: CLINIC_A_WHATSAPP, body });

    const first = await postTwilioWebhook(request, params);
    expect(first.status()).toBe(200);
    expect(first.headers()['content-type']).toContain('text/xml');
    // Twilio reintenta con el mismo MessageSid: se responde 200 sin duplicar.
    const retry = await postTwilioWebhook(request, params);
    expect(retry.status()).toBe(200);

    await login(page, USERS.receptionA);
    await page.goto('/conversaciones');
    await page.getByRole('link', { name: new RegExp(PATIENTS.mariaA.name) }).first().click();
    await expect(page).toHaveURL(new RegExp(`c=${MARIA_CONVERSATION.id}`));

    const thread = page.getByRole('list', { name: 'Mensajes' });
    await expect(thread.getByText(body)).toHaveCount(1);
    // El bot estaba pausado: no hay respuesta automática después del mensaje.
    await expect(thread.getByRole('listitem').last()).toContainText(body);
    await expect(page.getByRole('button', { name: 'Reanudar bot' })).toBeVisible();
  });
});
