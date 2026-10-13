'use client';

import { CheckIcon, ChevronsUpDownIcon, UserPlusIcon } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { errorProps, FormField, zodFieldErrors, type FieldErrors } from '@/components/form-field';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { createPatient, listPatients } from '@/lib/db/patients';
import { patientSchema, type PatientInput } from '@/lib/db/schemas';
import type { Patient } from '@/lib/db/types';
import { patientName } from '@/lib/format';
import { cn } from '@/lib/utils';

export type PickedPatient = Pick<Patient, 'id' | 'full_name' | 'phone'>;

// Buscador de pacientes por nombre o teléfono (consulta al servidor con debounce).
export function PatientPicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id?: string;
  value: PickedPatient | null;
  onChange: (patient: PickedPatient) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedPatient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestId = useRef(0);
  // Alta rápida: null = cerrada; si no, valores iniciales tomados de la búsqueda.
  const [quickCreate, setQuickCreate] = useState<{ full_name: string; phone: string } | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    const current = ++requestId.current;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        try {
          const data = await listPatients(query.trim() || undefined);
          if (current !== requestId.current) return;
          setResults(data.slice(0, 30));
          setError(false);
        } catch {
          if (current === requestId.current) setError(true);
        } finally {
          if (current === requestId.current) setLoading(false);
        }
      },
      query ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, open]);

  const trimmed = query.trim();
  const showCreate = !loading && !error && (results.length === 0 || trimmed !== '');

  function startQuickCreate() {
    // Si lo buscado parece teléfono, se usa como teléfono; si no, como nombre.
    const looksLikePhone = /^\+?[\d\s-]{6,}$/.test(trimmed);
    setQuickCreate({
      full_name: looksLikePhone ? '' : trimmed,
      phone: looksLikePhone ? trimmed.replace(/[\s-]/g, '') : '',
    });
    setOpen(false);
  }

  if (quickCreate) {
    return (
      <QuickCreatePatient
        initial={quickCreate}
        onCancel={() => setQuickCreate(null)}
        onCreated={(p) => {
          setQuickCreate(null);
          setQuery('');
          onChange(p);
        }}
      />
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value ? patientName(value) : 'Buscar paciente…'}
          </span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Nombre o teléfono"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {loading ? 'Buscando…' : error ? 'No se pudo buscar. Intenta de nuevo.' : null}
            </CommandEmpty>
            {!loading && !error && results.length === 0 && (
              <p className="px-3 pt-3 pb-1 text-center text-sm text-muted-foreground">
                No se encontró el paciente.
              </p>
            )}
            <CommandGroup>
              {results.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => {
                    onChange(p);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn('size-4', value?.id === p.id ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className={cn('truncate', !p.full_name && 'italic text-muted-foreground')}>
                    {patientName(p)}
                  </span>
                  {p.phone && (
                    <span className="ml-auto text-xs text-muted-foreground">{p.phone}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {showCreate && (
              <CommandGroup>
                <CommandItem value="__nuevo__" onSelect={startQuickCreate}>
                  <UserPlusIcon className="size-4" />
                  Registrar paciente nuevo
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Mini formulario de alta rápida (nombre y teléfono). No es un <form> porque vive
// dentro del formulario de la cita; Enter guarda sin enviar la cita.
function QuickCreatePatient({
  initial,
  onCancel,
  onCreated,
}: {
  initial: { full_name: string; phone: string };
  onCancel: () => void;
  onCreated: (patient: PickedPatient) => void;
}) {
  const [fullName, setFullName] = useState(initial.full_name);
  const [phone, setPhone] = useState(initial.phone);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

  function save() {
    const input: PatientInput = {
      full_name: fullName,
      phone: phone.replace(/[\s-]/g, ''),
    };
    const parsed = patientSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await createPatient(input);
      if (!result.ok) {
        const fe: FieldErrors = { ...result.fieldErrors };
        // El teléfono duplicado llega como error general de la base.
        if (result.error.includes('teléfono')) fe.phone = [result.error];
        setErrors(fe);
        if (!fe.phone && !fe.full_name) toast.error(result.error);
        return;
      }
      toast.success('Paciente registrado');
      onCreated({
        id: result.data.id,
        full_name: parsed.data.full_name,
        phone: parsed.data.phone ?? null,
      });
    });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-3" role="group" aria-label="Registrar paciente nuevo">
      <p className="text-sm font-medium">Registrar paciente nuevo</p>
      <FormField id="quick-name" label="Nombre completo *" error={errors.full_name}>
        <Input
          id="quick-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
          autoComplete="off"
          {...errorProps('quick-name', errors.full_name)}
        />
      </FormField>
      <FormField
        id="quick-phone"
        label="Teléfono (WhatsApp)"
        error={errors.phone}
        hint="Opcional. Formato internacional, p. ej. +5215512345678"
      >
        <Input
          id="quick-phone"
          type="tel"
          inputMode="tel"
          placeholder="+52…"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={onKeyDown}
          {...errorProps('quick-phone', errors.phone)}
        />
      </FormField>
      <p className="text-xs text-muted-foreground">
        Los demás datos se completan después en la ficha del paciente.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Volver a buscar
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Guardando…' : 'Registrar y seleccionar'}
        </Button>
      </div>
    </div>
  );
}
