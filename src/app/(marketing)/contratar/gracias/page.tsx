import { CheckCircle2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { CONTACTO } from '@/lib/planes-publicos';

export const metadata: Metadata = {
  title: 'Pago recibido · CitaBot Dental',
  robots: { index: false, follow: false },
};

// Destino de Stripe tras pagar desde la landing. No lee la sesión de Checkout: el
// webhook crea la cuenta y manda la invitación al correo con el que pagó.
export default function GraciasPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-sidebar px-6 py-20">
      <div className="flex w-full max-w-lg flex-col items-center gap-5 rounded-3xl border bg-card p-10 text-center text-card-foreground">
        <CheckCircle2 className="size-14 text-section-pacientes" aria-hidden />
        <h1 className="text-3xl font-extrabold tracking-tight">¡Pago recibido!</h1>
        <p className="text-[17px] leading-relaxed text-muted-foreground">
          Te enviamos un correo con un enlace para definir tu contraseña y entrar al panel de tu
          consultorio. Puede tardar un par de minutos; revisa también la carpeta de spam.
        </p>
        <p className="text-[15px] text-muted-foreground">
          Si el enlace venció o no te llegó, entra a{' '}
          <Link href="/login" className="font-semibold text-primary underline">
            Iniciar sesión
          </Link>{' '}
          y usa «Olvidé mi contraseña» con el mismo correo con el que pagaste. ¿Dudas? Escríbenos por{' '}
          <a href={CONTACTO.whatsappUrl} className="font-semibold text-primary underline">
            WhatsApp
          </a>
          .
        </p>
      </div>
    </main>
  );
}
