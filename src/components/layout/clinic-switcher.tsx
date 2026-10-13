'use client';

import { Building2Icon, CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { switchClinic } from '@/lib/db/account';
import type { MyClinic } from '@/lib/db/types';
import { cn } from '@/lib/utils';

// Al cambiar de consultorio, las pantallas de detalle (un paciente, una
// conversación) son del consultorio anterior: se vuelve a la lista de la sección.
function pathAfterSwitch(pathname: string): string {
  if (pathname.startsWith('/pacientes/')) return '/pacientes';
  if (pathname.startsWith('/conversaciones')) return '/conversaciones';
  return pathname;
}

// Selector del consultorio activo en el encabezado de la barra lateral. Solo
// se muestra con 2 o más consultorios (lo decide el layout). En tablet muestra
// las iniciales; en escritorio, el nombre completo.
export function ClinicSwitcher({
  clinics,
  activeName,
  initials,
}: {
  clinics: MyClinic[];
  activeName: string;
  initials: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function choose(clinic: MyClinic) {
    if (clinic.is_active || pending) return;
    startTransition(async () => {
      const result = await switchClinic(clinic.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Ahora trabajas en ${clinic.name}`);
      const next = pathAfterSwitch(pathname);
      if (next !== pathname) router.replace(next);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          title={`Consultorio: ${activeName}. Clic para cambiar de consultorio`}
          aria-label={`Consultorio activo: ${activeName}. Cambiar de consultorio`}
          className={cn(
            'mb-4 h-auto w-full justify-center px-1 py-2 text-sm font-semibold lg:justify-between lg:px-3 lg:text-base',
            pending && 'opacity-70',
          )}
        >
          <span className="lg:hidden" aria-hidden>
            {initials}
          </span>
          <span className="hidden min-w-0 truncate lg:block">{activeName}</span>
          <ChevronsUpDownIcon className="hidden size-4 shrink-0 opacity-60 lg:block" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{pending ? 'Cambiando de consultorio…' : 'Tus consultorios'}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {clinics.map((clinic) => (
          <DropdownMenuItem
            key={clinic.id}
            disabled={pending}
            aria-current={clinic.is_active ? 'true' : undefined}
            onSelect={() => choose(clinic)}
          >
            <Building2Icon />
            <span className="min-w-0 truncate">{clinic.name}</span>
            {clinic.is_active && <CheckIcon className="ml-auto" aria-label="Activo" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
