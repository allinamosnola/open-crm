'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { READ_ONLY_HINT, useReadOnly } from '@/components/layout/read-only';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { setStaffActive } from '@/lib/db/staff';

// Activar/Desactivar a alguien del personal, con confirmación.
export function StaffActiveToggle({
  id,
  name,
  active,
}: {
  id: string;
  name: string;
  active: boolean;
}) {
  const router = useRouter();
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await setStaffActive(id, !active);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(active ? `${name} fue desactivado` : `${name} fue activado`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={active ? 'outline' : 'default'}
          size="sm"
          disabled={readOnly}
          title={readOnly ? READ_ONLY_HINT : undefined}
        >
          {active ? 'Desactivar' : 'Activar'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{active ? `¿Desactivar a ${name}?` : `¿Activar a ${name}?`}</DialogTitle>
          <DialogDescription>
            {active
              ? 'Perderá el acceso al panel de inmediato. Podrás volver a activarlo después.'
              : 'Recuperará el acceso al panel con su cuenta y su rol actuales.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant={active ? 'destructive' : 'default'}
            onClick={confirm}
            disabled={pending}
          >
            {pending ? 'Guardando…' : active ? 'Sí, desactivar' : 'Sí, activar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
