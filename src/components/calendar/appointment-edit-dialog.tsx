'use client';

import { ExternalLinkIcon } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';

import { SlotDateTimeInput } from '@/components/calendar/slot-datetime-input';
import { errorProps, FormField, zodFieldErrors, type FieldErrors } from '@/components/form-field';
import { READ_ONLY_HINT, useReadOnly } from '@/components/layout/read-only';
import {
  AppointmentStatusBadge,
  UnidentifiedBadge,
  WhatsAppBadge,
} from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cancelAppointment, updateAppointment } from '@/lib/db/appointments';
import { appointmentUpdateSchema, type AppointmentUpdateInput } from '@/lib/db/schemas';
import type { AppointmentWithRelations, BusinessHours } from '@/lib/db/types';
import {
  APPT_SOURCE_LABEL,
  APPT_STATUS_LABEL,
  fromLocalInputValue,
  patientName,
  toLocalInputValue,
} from '@/lib/format';
import type { Enums } from '@/types/database';

// "Cancelada" no se elige aquí: tiene su propio botón (cancelAppointment).
const EDITABLE_STATUSES: Enums<'appt_status'>[] = ['scheduled', 'confirmed', 'completed', 'no_show'];

export type EditableAppointment = {
  appointment: AppointmentWithRelations;
  // Horas actuales del evento en el calendario (pueden venir de un arrastre reciente).
  start: Date;
  end: Date;
};

export function AppointmentEditDialog({
  data,
  onClose,
  onChanged,
  businessHours,
}: {
  data: EditableAppointment;
  onClose: () => void;
  businessHours?: BusinessHours;
  onChanged: () => void;
}) {
  const { appointment } = data;
  const [start, setStart] = useState(toLocalInputValue(data.start));
  const [end, setEnd] = useState(toLocalInputValue(data.end));
  const [status, setStatus] = useState(appointment.status);
  const [reason, setReason] = useState(appointment.reason ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pending, startTransition] = useTransition();
  const readOnly = useReadOnly();

  // Al cambiar el inicio, el fin se mueve igual para conservar la duración de la cita.
  function onStartChange(next: string) {
    const oldStart = new Date(start).getTime();
    const oldEnd = new Date(end).getTime();
    const newStart = new Date(next).getTime();
    setStart(next);
    if ([oldStart, oldEnd, newStart].some(Number.isNaN)) return;
    setEnd(toLocalInputValue(new Date(newStart + (oldEnd - oldStart))));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const input: AppointmentUpdateInput = {
      starts_at: fromLocalInputValue(start),
      ends_at: fromLocalInputValue(end),
      status,
      reason,
    };
    const parsed = appointmentUpdateSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await updateAppointment(appointment.id, input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success('Cita actualizada');
      onChanged();
    });
  }

  function onCancelAppointment() {
    startTransition(async () => {
      const result = await cancelAppointment(appointment.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Cita cancelada');
      onChanged();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {appointment.patient ? patientName(appointment.patient) : 'Paciente'}
              <AppointmentStatusBadge status={appointment.status} />
              {appointment.patient?.status === 'unidentified' && <UnidentifiedBadge />}
              {appointment.source === 'whatsapp' && <WhatsAppBadge />}
            </DialogTitle>
            <DialogDescription>
              {appointment.dentist?.full_name ?? '—'}
              {appointment.patient?.phone && ` · ${appointment.patient.phone}`} · Origen:{' '}
              {APPT_SOURCE_LABEL[appointment.source]}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <FormField id="edit-start" label="Inicio" error={errors.starts_at}>
              <SlotDateTimeInput
                id="edit-start"
                kind="start"
                businessHours={businessHours}
                value={start}
                onChange={onStartChange}
                {...errorProps('edit-start', errors.starts_at)}
              />
            </FormField>
            <FormField id="edit-end" label="Fin" error={errors.ends_at}>
              <SlotDateTimeInput
                id="edit-end"
                kind="end"
                businessHours={businessHours}
                value={end}
                onChange={setEnd}
                {...errorProps('edit-end', errors.ends_at)}
              />
            </FormField>
          </div>

          <FormField id="edit-status" label="Estado" error={errors.status}>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as Enums<'appt_status'>)}
            >
              <SelectTrigger id="edit-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDITABLE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {APPT_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField id="edit-reason" label="Motivo" error={errors.reason}>
            <Textarea
              id="edit-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>

          {confirmCancel ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <span className="mr-auto">¿Cancelar esta cita? El horario quedará libre.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmCancel(false)}
                disabled={pending}
              >
                No
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onCancelAppointment}
                disabled={pending}
              >
                Sí, cancelar cita
              </Button>
            </div>
          ) : null}

          <DialogFooter className="sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                onClick={() => setConfirmCancel(true)}
                disabled={pending || confirmCancel || readOnly}
              >
                Cancelar cita
              </Button>
              {appointment.patient && (
                <Button type="button" variant="outline" asChild>
                  <Link href={`/pacientes/${appointment.patient.id}`}>
                    <ExternalLinkIcon />
                    Ver ficha
                  </Link>
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cerrar
              </Button>
              <Button
                type="submit"
                disabled={pending || readOnly}
                title={readOnly ? READ_ONLY_HINT : undefined}
              >
                {pending ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
