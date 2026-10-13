'use client';

import { InfoIcon, MailPlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';

import { errorProps, FormField, zodFieldErrors, type FieldErrors } from '@/components/form-field';
import { READ_ONLY_HINT, useReadOnly } from '@/components/layout/read-only';
import { inviteLimitMessage } from '@/components/plan/limits';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { inviteStaff } from '@/lib/db/staff';
import { staffInviteSchema, type StaffInviteInput } from '@/lib/db/schemas';
import { INVITABLE_ROLES, type Entitlements, type InvitableRole } from '@/lib/db/types';
import { ROLE_LABEL } from '@/lib/format';

// Invita por correo a un dentista o recepcionista (solo owner). Con
// `entitlements` (uso vs. tope del plan) avisa de los topes alcanzados y no deja
// enviar una invitación que el servidor rechazaría; sin ellos (no se pudieron
// leer) el servidor sigue aplicando los topes y su error llega en español.
export function InviteStaffDialog({ entitlements }: { entitlements: Entitlements | null }) {
  const router = useRouter();
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<InvitableRole | ''>('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

  const limits = Object.fromEntries(
    INVITABLE_ROLES.map((r) => [r, entitlements ? inviteLimitMessage(entitlements, r) : null]),
  ) as Record<InvitableRole, string | null>;
  const blockedRoles = INVITABLE_ROLES.filter((r) => limits[r]);
  const allBlocked = blockedRoles.length === INVITABLE_ROLES.length;
  const roleBlocked = role !== '' && limits[role] !== null;

  function reset() {
    setEmail('');
    setFullName('');
    setRole('');
    setErrors({});
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (allBlocked || roleBlocked) return;
    const input = { email, full_name: fullName, role } as StaffInviteInput;
    const parsed = staffInviteSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await inviteStaff(input);
      if (!result.ok) {
        const fe: FieldErrors = { ...result.fieldErrors };
        // "Ese correo ya tiene una cuenta" se muestra junto al campo.
        if (result.error.includes('correo ya tiene')) fe.email = [result.error];
        else toast.error(result.error);
        setErrors(fe);
        return;
      }
      toast.success(`Invitación enviada a ${parsed.data.email}`);
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined}>
          <MailPlusIcon />
          Invitar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Invitar al personal</DialogTitle>
            <DialogDescription>
              Le llegará un correo con un enlace para definir su contraseña y entrar al panel.
            </DialogDescription>
          </DialogHeader>
          {blockedRoles.length > 0 && (
            <Alert>
              <InfoIcon />
              <AlertTitle>
                {allBlocked
                  ? 'Ya no puedes invitar a más personal'
                  : blockedRoles[0] === 'dentist'
                    ? 'Llegaste al tope de doctores'
                    : 'Este consultorio ya tiene recepcionista'}
              </AlertTitle>
              <AlertDescription>
                {blockedRoles.map((r) => (
                  <p key={r}>{limits[r]}</p>
                ))}
              </AlertDescription>
            </Alert>
          )}
          <FormField id="invite-email" label="Correo electrónico *" error={errors.email}>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              {...errorProps('invite-email', errors.email)}
            />
          </FormField>
          <FormField id="invite-name" label="Nombre completo *" error={errors.full_name}>
            <Input
              id="invite-name"
              autoComplete="off"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              {...errorProps('invite-name', errors.full_name)}
            />
          </FormField>
          <FormField id="invite-role" label="Rol *" error={errors.role}>
            <Select value={role} onValueChange={(v) => setRole(v as InvitableRole)}>
              <SelectTrigger
                id="invite-role"
                className="w-full"
                aria-invalid={errors.role ? true : undefined}
              >
                <SelectValue placeholder="Elegir rol" />
              </SelectTrigger>
              <SelectContent>
                {INVITABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r} disabled={limits[r] !== null}>
                    {ROLE_LABEL[r]}
                    {limits[r] !== null && ' (tope alcanzado)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={pending || allBlocked || roleBlocked}
              title={allBlocked ? 'Alcanzaste el tope de personal de tu plan' : undefined}
            >
              {pending ? 'Enviando…' : 'Enviar invitación'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
