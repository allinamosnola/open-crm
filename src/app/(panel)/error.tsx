'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

// Las lecturas de src/lib/db lanzan Error con un mensaje en español.
export default function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-lg font-semibold">Algo salió mal</h1>
      <p className="text-muted-foreground">
        {/* En producción Next oculta el mensaje de errores del servidor. */}
        {error.digest ? 'No se pudo cargar la información.' : error.message}
      </p>
      <Button onClick={reset}>Reintentar</Button>
    </div>
  );
}
