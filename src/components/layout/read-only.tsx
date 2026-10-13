'use client';

import Link from 'next/link';
import { createContext, useContext } from 'react';

import { Button } from '@/components/ui/button';

// Con la suscripción del consultorio en past_due o canceled la RLS rechaza las
// escrituras; el panel lo refleja deshabilitando los botones de crear, editar
// y enviar. Lo provee el layout del panel.
const ReadOnlyContext = createContext(false);

export function ReadOnlyProvider({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: React.ReactNode;
}) {
  return <ReadOnlyContext.Provider value={readOnly}>{children}</ReadOnlyContext.Provider>;
}

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

export const READ_ONLY_HINT = 'La suscripción no está activa: el panel está en modo solo lectura';

// Botón-enlace a una pantalla de alta (p. ej. "Nuevo paciente"). En solo
// lectura se muestra deshabilitado.
export function WriteLinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  const readOnly = useReadOnly();
  if (readOnly) {
    return (
      <Button disabled title={READ_ONLY_HINT}>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild>
      <Link href={href}>{children}</Link>
    </Button>
  );
}
