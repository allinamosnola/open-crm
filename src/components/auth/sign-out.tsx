'use client';

import { LogOutIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

function useSignOut() {
  const router = useRouter();
  return async () => {
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  };
}

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const signOut = useSignOut();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      className="w-full justify-start"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await signOut();
      }}
      title="Cerrar sesión"
    >
      <LogOutIcon />
      <span className={compact ? 'sr-only lg:not-sr-only' : undefined}>Cerrar sesión</span>
    </Button>
  );
}

// Hay sesión pero la cuenta no es personal activo del consultorio: se cierra la
// sesión en cuanto se muestra el aviso.
export function NoAccess() {
  const router = useRouter();
  const [done, setDone] = useState(false);

  useEffect(() => {
    createClient()
      .auth.signOut()
      .finally(() => setDone(true));
  }, []);

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold">Cuenta sin acceso</h1>
        <p className="text-muted-foreground">
          Tu cuenta no está dada de alta como personal activo del consultorio. Pide a la
          administración que te dé acceso. Tu sesión se cerró.
        </p>
        <Button
          disabled={!done}
          onClick={() => {
            router.replace('/login');
            router.refresh();
          }}
        >
          Volver a iniciar sesión
        </Button>
      </div>
    </main>
  );
}
