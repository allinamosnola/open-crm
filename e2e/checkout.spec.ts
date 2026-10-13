import { expect, test } from '@playwright/test';

// Checkout de la landing sin Stripe: el servidor de E2E no tiene STRIPE_SECRET_KEY,
// así que la acción falla antes de cualquier llamada de red. Se prueba lo que
// sí corre en la app (tarifas, complemento, envío, error recuperable, página de
// gracias y la puerta del webhook). La sesión de Checkout y el alta por webhook
// con firma real del SDK están cubiertas en tests/stripe (vitest).

test.describe('Checkout de la landing', () => {
  test('las tarifas abren el pago y muestran un error recuperable si Stripe no responde', async ({
    page,
  }) => {
    await page.goto('/#tarifas');
    const tarifas = page.locator('#tarifas');

    // Solo Básico ofrece el complemento Bot.
    await expect(tarifas.getByRole('checkbox', { name: /Añadir bot de WhatsApp/ })).toHaveCount(1);
    await expect(tarifas.getByRole('button', { name: 'Elegir Pro' })).toBeVisible();
    await expect(tarifas.getByRole('button', { name: 'Elegir Plus' })).toBeVisible();

    await tarifas.getByRole('checkbox', { name: /Añadir bot de WhatsApp/ }).check();
    await tarifas.getByRole('button', { name: 'Empezar con Básico' }).click();

    await expect(tarifas.getByRole('alert')).toHaveText('No se pudo abrir el pago. Intenta de nuevo.');
    await expect(page).toHaveURL(/\/(#tarifas)?$/);
    await expect(tarifas.getByRole('button', { name: 'Empezar con Básico' })).toBeEnabled();
  });

  test('la página de regreso de Stripe confirma el pago', async ({ page }) => {
    await page.goto('/contratar/gracias');
    await expect(page.getByRole('heading', { name: '¡Pago recibido!' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login');
  });

  test('el webhook de Stripe exige la firma', async ({ request }) => {
    const response = await request.post('/api/stripe/webhook', {
      data: { id: 'evt_e2e', type: 'checkout.session.completed' },
    });
    expect(response.status()).toBe(400);
    expect(await response.text()).toBe('Falta la firma');
  });
});
