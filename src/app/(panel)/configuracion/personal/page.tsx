import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { InviteStaffDialog } from '@/components/staff/invite-staff-dialog';
import { StaffActiveToggle } from '@/components/staff/staff-active-toggle';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getEntitlements } from '@/lib/db/account';
import { getCurrentStaff, listStaff } from '@/lib/db/staff';
import { ROLE_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Personal · CitaBot Dental' };

// Solo el owner administra al personal (la RLS y las server actions también lo exigen).
export default async function StaffPage() {
  const me = await getCurrentStaff();
  if (!me || me.role !== 'owner') notFound();
  // Si no se puede leer el plan, la invitación sigue (el servidor aplica los topes).
  const [staff, entitlements] = await Promise.all([
    listStaff(),
    getEntitlements().catch(() => null),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Personal</h1>
          <p className="text-sm text-muted-foreground">
            Personal de {me.clinic.name}. Al desactivar a alguien pierde el acceso de inmediato.
          </p>
        </div>
        <InviteStaffDialog entitlements={entitlements} />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="hidden md:table-cell">Correo</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((s) => {
              const isMe = s.id === me.id;
              return (
                <TableRow key={s.id} className={cn(!s.active && 'text-muted-foreground')}>
                  <TableCell className="font-medium">
                    {s.full_name}
                    {isMe && <span className="ml-1 text-muted-foreground">(tú)</span>}
                    <span className="block text-xs font-normal text-muted-foreground md:hidden">
                      {s.email}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{s.email}</TableCell>
                  <TableCell>{ROLE_LABEL[s.role]}</TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        'border-transparent',
                        s.active
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {s.active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {isMe ? null : (
                      <StaffActiveToggle id={s.id} name={s.full_name} active={s.active} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
