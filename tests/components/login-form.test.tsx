import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginForm } from '@/components/auth/login-form';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
const signInWithPassword = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
}));

async function fillAndSubmit(email: string, password: string) {
  if (email) await userEvent.type(screen.getByLabelText('Correo electrónico'), email);
  if (password) await userEvent.type(screen.getByLabelText('Contraseña'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
}

describe('LoginForm', () => {
  beforeEach(() => {
    signInWithPassword.mockResolvedValue({ error: null });
  });

  it('pide correo y contraseña sin llamar a Supabase', async () => {
    render(<LoginForm />);

    await fillAndSubmit('dentista@demo.local', '');

    expect(screen.getByText('Escribe tu correo y tu contraseña')).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('entra con credenciales válidas y lleva a la agenda', async () => {
    render(<LoginForm />);

    await fillAndSubmit('  dentista@demo.local ', 'demo1234');

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'dentista@demo.local',
      password: 'demo1234',
    });
    expect(router.replace).toHaveBeenCalledWith('/agenda');
    expect(router.refresh).toHaveBeenCalled();
  });

  it.each([
    [{ message: 'Invalid login credentials', code: 'invalid_credentials' }, 'Correo o contraseña incorrectos'],
    [{ message: 'Email not confirmed' }, 'El correo aún no está confirmado'],
    [{ message: 'Too many requests', status: 429 }, 'Demasiados intentos. Espera un momento e intenta de nuevo.'],
    [{ message: 'Something else' }, 'No se pudo iniciar sesión. Intenta de nuevo.'],
  ])('traduce el error de Supabase %o', async (error, expected) => {
    signInWithPassword.mockResolvedValue({ error });
    render(<LoginForm />);

    await fillAndSubmit('dentista@demo.local', 'mala');

    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    // Se puede volver a intentar.
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled();
  });

  it('avisa si no hay conexión con el servidor', async () => {
    signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<LoginForm />);

    await fillAndSubmit('dentista@demo.local', 'demo1234');

    expect(
      await screen.findByText('No se pudo conectar con el servidor. Revisa tu conexión.'),
    ).toBeInTheDocument();
  });

  it('deshabilita el botón mientras inicia sesión', async () => {
    signInWithPassword.mockReturnValue(new Promise(() => {}));
    render(<LoginForm />);

    await fillAndSubmit('dentista@demo.local', 'demo1234');

    expect(screen.getByRole('button', { name: 'Entrando…' })).toBeDisabled();
  });

  it('enlaza la recuperación de contraseña', () => {
    render(<LoginForm />);
    expect(screen.getByRole('link', { name: 'Olvidé mi contraseña' })).toHaveAttribute(
      'href',
      '/login/recuperar',
    );
  });
});
