'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Último recurso: errores del layout raíz, donde no llega el error.tsx del panel.
export default function GlobalError({
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
    <html lang="es">
      <body>
        <div style={{ maxWidth: 420, margin: '4rem auto', textAlign: 'center' }}>
          <h1>Algo salió mal</h1>
          <button onClick={reset}>Reintentar</button>
        </div>
      </body>
    </html>
  );
}
