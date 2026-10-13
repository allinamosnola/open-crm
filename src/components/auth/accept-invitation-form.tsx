'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';

import { errorProps, FormField, zodFieldErrors, type FieldErrors } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updatePassword } from '@/lib/db/account';
import { passwordSchema } from '@/lib/db/schemas';

export function AcceptInvitationForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const input = { password, confirm };
    const parsed = passwordSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setError(null);
    startTransition(async () => {
      const result = await updatePassword(input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setError(result.error);
        return;
      }
      toast.success('Contraseña guardada');
      router.replace('/agenda');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FormField
        id="new-password"
        label="Contraseña"
        error={errors.password}
        hint="Mínimo 8 caracteres."
      >
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
          {...errorProps('new-password', errors.password)}
        />
      </FormField>
      <FormField id="confirm-password" label="Confirmar contraseña" error={errors.confirm}>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          {...errorProps('confirm-password', errors.confirm)}
        />
      </FormField>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Guardando…' : 'Guardar y entrar'}
      </Button>
    </form>
  );
}
