'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

// Traduce los errores de Supabase Auth más comunes.
function authErrorMessage(error: { message: string; code?: string; status?: number }): string {
  const code = error.code ?? '';
  const msg = error.message.toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'Correo o contraseña incorrectos';
  }
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return 'El correo aún no está confirmado';
  }
  if (code === 'over_request_rate_limit' || error.status === 429) {
    return 'Demasiados intentos. Espera un momento e intenta de nuevo.';
  }
  if (code === 'user_banned') return 'La cuenta está deshabilitada';
  if (msg.includes('fetch') || msg.includes('network')) {
    return 'No se pudo conectar con el servidor. Revisa tu conexión.';
  }
  return 'No se pudo iniciar sesión. Intenta de nuevo.';
}

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    if (!email || !password) {
      setError('Escribe tu correo y tu contraseña');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(authErrorMessage(authError));
        setPending(false);
        return;
      }
      router.replace('/agenda');
      router.refresh();
    } catch (e) {
      setError(authErrorMessage(e instanceof Error ? e : { message: String(e) }));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-2">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Entrando…' : 'Iniciar sesión'}
      </Button>
      <Link
        href="/login/recuperar"
        className="text-center text-sm text-muted-foreground underline hover:text-foreground"
      >
        Olvidé mi contraseña
      </Link>
    </form>
  );
}
