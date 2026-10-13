'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';

import { errorProps, FormField, zodFieldErrors, type FieldErrors } from '@/components/form-field';
import { READ_ONLY_HINT, useReadOnly } from '@/components/layout/read-only';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createPatient, updatePatient } from '@/lib/db/patients';
import { patientSchema, type PatientInput } from '@/lib/db/schemas';
import type { Patient } from '@/lib/db/types';

type Props =
  | { mode: 'create'; patient?: undefined; onCancelHref?: string }
  | { mode: 'edit'; patient: Patient; onCancelHref?: string };

export function PatientForm({ mode, patient, onCancelHref }: Props) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const readOnly = useReadOnly();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: PatientInput = {
      full_name: String(form.get('full_name') ?? ''),
      phone: String(form.get('phone') ?? '').replace(/[\s-]/g, ''),
      email: String(form.get('email') ?? ''),
      birthdate: String(form.get('birthdate') ?? ''),
      allergies: String(form.get('allergies') ?? ''),
      notes_admin: String(form.get('notes_admin') ?? ''),
    };

    const parsed = patientSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});

    startTransition(async () => {
      const result =
        mode === 'create' ? await createPatient(input) : await updatePatient(patient.id, input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      if (mode === 'create') {
        toast.success('Paciente registrado');
        router.push(`/pacientes/${result.data.id}`);
      } else {
        toast.success('Datos guardados');
        router.refresh();
      }
    });
  }

  const e = errors;
  return (
    <form onSubmit={onSubmit} noValidate className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <FormField id="full_name" label="Nombre completo *" error={e.full_name} className="sm:col-span-2">
        <Input
          id="full_name"
          name="full_name"
          defaultValue={patient?.full_name ?? ''}
          autoComplete="off"
          required
          {...errorProps('full_name', e.full_name)}
        />
      </FormField>
      <FormField
        id="phone"
        label="Teléfono (WhatsApp)"
        error={e.phone}
        hint="Formato internacional, p. ej. +5215512345678"
      >
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          placeholder="+52…"
          defaultValue={patient?.phone ?? ''}
          {...errorProps('phone', e.phone)}
        />
      </FormField>
      <FormField id="email" label="Correo electrónico" error={e.email}>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={patient?.email ?? ''}
          {...errorProps('email', e.email)}
        />
      </FormField>
      <FormField id="birthdate" label="Fecha de nacimiento" error={e.birthdate}>
        <Input
          id="birthdate"
          name="birthdate"
          type="date"
          defaultValue={patient?.birthdate ?? ''}
          {...errorProps('birthdate', e.birthdate)}
        />
      </FormField>
      <FormField id="allergies" label="Alergias" error={e.allergies} className="sm:col-span-2">
        <Textarea
          id="allergies"
          name="allergies"
          rows={2}
          defaultValue={patient?.allergies ?? ''}
          {...errorProps('allergies', e.allergies)}
        />
      </FormField>
      <FormField
        id="notes_admin"
        label="Notas administrativas"
        error={e.notes_admin}
        className="sm:col-span-2"
        hint="Visibles para todo el personal (no son notas clínicas)."
      >
        <Textarea
          id="notes_admin"
          name="notes_admin"
          rows={3}
          defaultValue={patient?.notes_admin ?? ''}
          {...errorProps('notes_admin', e.notes_admin)}
        />
      </FormField>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending || readOnly} title={readOnly ? READ_ONLY_HINT : undefined}>
          {pending ? 'Guardando…' : mode === 'create' ? 'Registrar paciente' : 'Guardar cambios'}
        </Button>
        {onCancelHref && (
          <Button type="button" variant="outline" onClick={() => router.push(onCancelHref)}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
