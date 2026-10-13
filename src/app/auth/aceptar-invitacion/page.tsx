import type { Metadata } from 'next';

import { AcceptInvitationForm } from '@/components/auth/accept-invitation-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Aceptar invitación · CitaBot Dental' };

// Destino de /auth/confirm tras abrir la sesión con el enlace de la invitación.
// Requiere sesión (el middleware manda a /login si no la hay).
export default function AcceptInvitationPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Bienvenido a CitaBot Dental</CardTitle>
          <CardDescription>
            Define la contraseña con la que vas a entrar al panel del consultorio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AcceptInvitationForm />
        </CardContent>
      </Card>
    </main>
  );
}
