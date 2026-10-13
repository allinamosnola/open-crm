'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

// Pide el enlace para definir una contraseña nueva. La respuesta es la misma exista
// o no el correo, para no revelar qué correos tienen cuenta.
export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '')
      .trim()
      .toLowerCase();
    if (!email) {
      setError('Escribe tu correo');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { error: resetError } = await createClient().auth.resetPasswordForEmail(email);
      if (resetError && (resetError.code === 'over_email_send_rate_limit' || resetError.status === 429)) {
        setError('Demasiados intentos. Espera un momento e intenta de nuevo.');
      } else {
        // Cualquier otro error (p. ej. correo inexistente) se trata como enviado.
        setSent(true);
      }
    } catch {
      setError('No se pudo conectar con el servidor. Revisa tu conexión.');
    }
    setPending(false);
  }

  if (sent) {
    return (
      <div className="grid gap-4">
        <Alert>
          <AlertDescription>
            Si el correo tiene una cuenta, te enviamos un enlace para definir tu contraseña. Puede
            tardar un par de minutos; revisa también el spam.
          </AlertDescription>
        </Alert>
        <Link href="/login" className="text-center text-sm font-semibold text-primary underline">
          Volver a iniciar sesión
        </Link>
      </div>
    );
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
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Enviando…' : 'Enviarme el enlace'}
      </Button>
      <Link href="/login" className="text-center text-sm text-muted-foreground underline">
        Volver a iniciar sesión
      </Link>
    </form>
  );
}
