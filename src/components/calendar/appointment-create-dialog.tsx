'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';

import { PatientPicker, type PickedPatient } from '@/components/calendar/patient-picker';
import { SlotDateTimeInput } from '@/components/calendar/slot-datetime-input';
import { errorProps, FormField, zodFieldErrors, type FieldErrors } from '@/components/form-field';
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
import { createAppointment } from '@/lib/db/appointments';
import { appointmentSchema, type AppointmentInput } from '@/lib/db/schemas';
import type { BusinessHours } from '@/lib/db/types';
import { fromLocalInputValue, toLocalInputValue } from '@/lib/format';

export type DentistOption = { id: string; full_name: string };
export type NewAppointmentSlot = { start: Date; end: Date; dentistId: string | null };

// Se monta con key distinta por cada hueco seleccionado, así el estado inicial
// sale de las props sin efectos.
export function AppointmentCreateDialog({
  slot,
  dentists,
  onClose,
  onCreated,
  businessHours,
}: {
  slot: NewAppointmentSlot;
  dentists: DentistOption[];
  onClose: () => void;
  onCreated: () => void;
  businessHours?: BusinessHours;
}) {
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [dentistId, setDentistId] = useState(slot.dentistId ?? '');
  const [start, setStart] = useState(toLocalInputValue(slot.start));
  const [end, setEnd] = useState(toLocalInputValue(slot.end));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

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
    const input: AppointmentInput = {
      patient_id: patient?.id ?? '',
      dentist_id: dentistId,
      starts_at: fromLocalInputValue(start),
      ends_at: fromLocalInputValue(end),
      reason,
    };
    const parsed = appointmentSchema.safeParse(input);
    if (!parsed.success) {
      const fe = zodFieldErrors(parsed.error.issues);
      if (fe.patient_id) fe.patient_id = ['Elige un paciente'];
      if (fe.dentist_id) fe.dentist_id = ['Elige un dentista'];
      setErrors(fe);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await createAppointment(input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error); // incluye el traslape de horario
        return;
      }
      toast.success('Cita agendada');
      onCreated();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Nueva cita</DialogTitle>
            <DialogDescription>Busca al paciente y confirma el horario.</DialogDescription>
          </DialogHeader>

          <FormField id="appt-patient" label="Paciente *" error={errors.patient_id}>
            <PatientPicker
              id="appt-patient"
              value={patient}
              onChange={setPatient}
              invalid={!!errors.patient_id}
            />
          </FormField>

          <FormField id="appt-dentist" label="Dentista *" error={errors.dentist_id}>
            <Select value={dentistId} onValueChange={setDentistId}>
              <SelectTrigger
                id="appt-dentist"
                className="w-full"
                aria-invalid={errors.dentist_id ? true : undefined}
              >
                <SelectValue placeholder="Elegir dentista" />
              </SelectTrigger>
              <SelectContent>
                {dentists.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <div className="grid gap-4">
            <FormField id="appt-start" label="Inicio *" error={errors.starts_at}>
              <SlotDateTimeInput
                id="appt-start"
                kind="start"
                businessHours={businessHours}
                value={start}
                onChange={onStartChange}
                {...errorProps('appt-start', errors.starts_at)}
              />
            </FormField>
            <FormField id="appt-end" label="Fin *" error={errors.ends_at}>
              <SlotDateTimeInput
                id="appt-end"
                kind="end"
                businessHours={businessHours}
                value={end}
                onChange={setEnd}
                {...errorProps('appt-end', errors.ends_at)}
              />
            </FormField>
          </div>

          <FormField id="appt-reason" label="Motivo" error={errors.reason}>
            <Textarea
              id="appt-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="p. ej. Limpieza, revisión, dolor en muela…"
            />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Agendar cita'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
