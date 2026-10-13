import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanCheckoutForm } from '@/components/marketing/plan-checkout-form';
import { startPublicCheckout } from '@/lib/stripe/public-checkout';

// La server action real llama a Stripe; aquí se sustituye por un mock.
vi.mock('@/lib/stripe/public-checkout', () => ({ startPublicCheckout: vi.fn() }));

const action = vi.mocked(startPublicCheckout);

function lastFormData(): FormData {
  const call = action.mock.calls.at(-1);
  if (!call) throw new Error('startPublicCheckout no se llamó');
  return call[1];
}

describe('PlanCheckoutForm', () => {
  beforeEach(() => {
    action.mockResolvedValue(null);
  });

  it('envía el plan elegido sin el complemento cuando no se ofrece', async () => {
    render(<PlanCheckoutForm plan="pro" cta="Contratar Pro" className="" />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Contratar Pro' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const data = lastFormData();
    expect(data.get('plan')).toBe('pro');
    expect(data.get('botAddon')).toBeNull();
    // El campo trampa va vacío cuando lo envía una persona.
    expect(data.get('sitio_web')).toBe('');
  });

  it('en Básico ofrece el bot con su precio y lo envía si se marca', async () => {
    render(<PlanCheckoutForm plan="basic" cta="Contratar Básico" className="" botPrice={899} />);

    const addon = screen.getByRole('checkbox', { name: /Añadir bot de WhatsApp/ });
    expect(addon).toHaveAccessibleName(expect.stringContaining('899'));
    await userEvent.click(addon);
    await userEvent.click(screen.getByRole('button', { name: 'Contratar Básico' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(lastFormData().get('plan')).toBe('basic');
    expect(lastFormData().get('botAddon')).toBe('on');
  });

  it('deshabilita el botón y avisa mientras se abre el pago', async () => {
    let finish: (value: null) => void = () => {};
    action.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<PlanCheckoutForm plan="plus" cta="Contratar Plus" className="" />);

    await userEvent.click(screen.getByRole('button', { name: 'Contratar Plus' }));

    const button = await screen.findByRole('button', { name: 'Abriendo el pago…' });
    expect(button).toBeDisabled();

    // React entrelaza las acciones asíncronas pendientes: hay que terminarla para
    // no bloquear las de los tests siguientes.
    finish(null);
    expect(await screen.findByRole('button', { name: 'Contratar Plus' })).toBeEnabled();
  });

  it('muestra el error que devuelve la acción y permite reintentar', async () => {
    action.mockResolvedValue({ error: 'No se pudo abrir el pago. Intenta de nuevo.' });
    render(<PlanCheckoutForm plan="pro" cta="Contratar Pro" className="" />);

    await userEvent.click(screen.getByRole('button', { name: 'Contratar Pro' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo abrir el pago. Intenta de nuevo.',
    );
    expect(screen.getByRole('button', { name: 'Contratar Pro' })).toBeEnabled();
  });
});
