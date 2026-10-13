import type { Metadata } from 'next';

import { LoginForm } from '@/components/auth/login-form';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Iniciar sesión · CitaBot Dental' };

// Errores que llegan por la URL (p. ej. desde /auth/confirm).
const URL_ERRORS: Record<string, string> = {
  'enlace-invalido': 'El enlace de invitación no es válido o expiró',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;
  const urlError = code ? URL_ERRORS[code] : undefined;

  return (
    <main className="relative flex flex-1 items-center justify-center bg-gradient-to-br from-section-agenda-soft via-background to-section-pacientes-soft p-4">
      <div className="absolute top-3 right-3">
        <ThemeToggle compact />
      </div>
      <Card className="w-full max-w-sm border-t-4 border-t-primary">
        <CardHeader>
          <CardTitle className="text-xl text-primary">CitaBot Dental</CardTitle>
          <CardDescription>Inicia sesión con tu cuenta del consultorio.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {urlError && (
            <Alert variant="destructive">
              <AlertDescription>
                {urlError}. Pide al dueño del consultorio que te envíe una nueva invitación.
              </AlertDescription>
            </Alert>
          )}
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
