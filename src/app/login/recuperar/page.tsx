import type { Metadata } from 'next';

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Olvidé mi contraseña · CitaBot Dental',
  robots: { index: false },
};

// Pública (cuelga de /login en el middleware). El enlace del correo pasa por
// /auth/confirm (type=recovery) y lleva a /auth/aceptar-invitacion para elegir la contraseña.
export default function ForgotPasswordPage() {
  return (
    <main className="relative flex flex-1 items-center justify-center bg-gradient-to-br from-section-agenda-soft via-background to-section-pacientes-soft p-4">
      <div className="absolute top-3 right-3">
        <ThemeToggle compact />
      </div>
      <Card className="w-full max-w-sm border-t-4 border-t-primary">
        <CardHeader>
          <CardTitle className="text-xl text-primary">Olvidé mi contraseña</CardTitle>
          <CardDescription>
            Escribe el correo de tu cuenta y te enviamos un enlace para definir una nueva.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}
