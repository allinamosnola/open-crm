'use client';

import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';

import { errorProps, FormField, zodFieldErrors, type FieldErrors } from '@/components/form-field';
import { READ_ONLY_HINT, useReadOnly } from '@/components/layout/read-only';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateClinicSettings } from '@/lib/db/clinic';
import { clinicSettingsSchema, type ClinicSettingsInput } from '@/lib/db/schemas';
import {
  WEEKDAY_KEYS,
  type BusinessHours,
  type ClinicSettings,
  type TimeRange,
  type WeekdayKey,
} from '@/lib/db/types';
import { WEEKDAY_LABEL } from '@/lib/format';

const MAX_RANGES = 4;
const DEFAULT_RANGE: TimeRange = ['09:00', '18:00'];

// Zonas horarias IANA comunes de México y Latinoamérica.
const TIMEZONE_GROUPS: { label: string; zones: { value: string; label: string }[] }[] = [
  {
    label: 'México',
    zones: [
      { value: 'America/Mexico_City', label: 'Ciudad de México (centro)' },
      { value: 'America/Monterrey', label: 'Monterrey (centro)' },
      { value: 'America/Merida', label: 'Mérida (centro)' },
      { value: 'America/Cancun', label: 'Cancún (Quintana Roo)' },
      { value: 'America/Chihuahua', label: 'Chihuahua' },
      { value: 'America/Mazatlan', label: 'Mazatlán (Pacífico)' },
      { value: 'America/Hermosillo', label: 'Hermosillo (Sonora)' },
      { value: 'America/Tijuana', label: 'Tijuana (Baja California)' },
    ],
  },
  {
    label: 'Centroamérica y el Caribe',
    zones: [
      { value: 'America/Guatemala', label: 'Guatemala' },
      { value: 'America/El_Salvador', label: 'San Salvador' },
      { value: 'America/Tegucigalpa', label: 'Tegucigalpa' },
      { value: 'America/Managua', label: 'Managua' },
      { value: 'America/Costa_Rica', label: 'San José de Costa Rica' },
      { value: 'America/Panama', label: 'Panamá' },
      { value: 'America/Havana', label: 'La Habana' },
      { value: 'America/Santo_Domingo', label: 'Santo Domingo' },
      { value: 'America/Puerto_Rico', label: 'Puerto Rico' },
    ],
  },
  {
    label: 'Sudamérica',
    zones: [
      { value: 'America/Bogota', label: 'Bogotá' },
      { value: 'America/Lima', label: 'Lima' },
      { value: 'America/Guayaquil', label: 'Guayaquil' },
      { value: 'America/Caracas', label: 'Caracas' },
      { value: 'America/La_Paz', label: 'La Paz' },
      { value: 'America/Santiago', label: 'Santiago de Chile' },
      { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
      { value: 'America/Montevideo', label: 'Montevideo' },
      { value: 'America/Asuncion', label: 'Asunción' },
      { value: 'America/Sao_Paulo', label: 'São Paulo' },
    ],
  },
];
const KNOWN_ZONES = new Set(TIMEZONE_GROUPS.flatMap((g) => g.zones.map((z) => z.value)));

type DayState = { open: boolean; ranges: TimeRange[] };
type HoursState = Record<WeekdayKey, DayState>;

function toHoursState(hours: BusinessHours): HoursState {
  return Object.fromEntries(
    WEEKDAY_KEYS.map((day) => {
      const ranges = hours[day] ?? [];
      return [day, { open: ranges.length > 0, ranges: ranges.map(([a, b]) => [a, b]) }];
    }),
  ) as HoursState;
}

// Los días cerrados se mandan vacíos (el esquema los omite al guardar).
function toBusinessHours(state: HoursState): Record<WeekdayKey, TimeRange[]> {
  return Object.fromEntries(
    WEEKDAY_KEYS.map((day) => [day, state[day].open ? state[day].ranges : []]),
  ) as Record<WeekdayKey, TimeRange[]>;
}

// Errores del horario: los de un rango ("business_hours.mon.0", ".0.1") y los
// del día completo ("business_hours.mon": traslapes, máximo de rangos).
function dayErrors(errors: FieldErrors, day: WeekdayKey) {
  const prefix = `business_hours.${day}`;
  const byRange = new Map<number, string>();
  let dayMessage: string | undefined;
  for (const [key, messages] of Object.entries(errors)) {
    if (!messages?.length) continue;
    if (key === prefix) dayMessage ??= messages[0];
    else if (key.startsWith(`${prefix}.`)) {
      const index = Number(key.slice(prefix.length + 1).split('.')[0]);
      if (!byRange.has(index)) byRange.set(index, messages[0]);
    }
  }
  return { dayMessage, byRange };
}

// Con botEnabled = false (plan sin bot) se ocultan los ajustes que solo usa el
// bot (correo de avisos a la recepción) y los textos hablan de la agenda. El
// correo guardado se conserva al guardar.
export function ClinicSettingsForm({
  settings,
  botEnabled,
}: {
  settings: ClinicSettings;
  botEnabled: boolean;
}) {
  const router = useRouter();
  const readOnly = useReadOnly();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});

  const [hours, setHours] = useState<HoursState>(() => toHoursState(settings.business_hours));
  const [timezone, setTimezone] = useState(settings.timezone);
  const [minutes, setMinutes] = useState(String(settings.default_appointment_minutes));
  const [email, setEmail] = useState(settings.reception_email ?? '');

  const allClosed = WEEKDAY_KEYS.every((day) => !hours[day].open || hours[day].ranges.length === 0);

  function updateDay(day: WeekdayKey, update: (d: DayState) => DayState) {
    setHours((h) => ({ ...h, [day]: update(h[day]) }));
  }

  function setOpen(day: WeekdayKey, open: boolean) {
    updateDay(day, (d) => ({
      open,
      ranges: open && d.ranges.length === 0 ? [[...DEFAULT_RANGE]] : d.ranges,
    }));
  }

  function setRange(day: WeekdayKey, index: number, position: 0 | 1, value: string) {
    updateDay(day, (d) => ({
      ...d,
      ranges: d.ranges.map((r, i) => {
        if (i !== index) return r;
        const next: TimeRange = [r[0], r[1]];
        next[position] = value;
        return next;
      }),
    }));
  }

  function addRange(day: WeekdayKey) {
    updateDay(day, (d) => {
      const last = d.ranges.at(-1);
      // El nuevo rango empieza donde terminó el anterior (el usuario lo ajusta).
      const start = last ? last[1] : DEFAULT_RANGE[0];
      const end = !last ? DEFAULT_RANGE[1] : start < '23:00' ? addHours(start, 1) : '23:59';
      return { ...d, ranges: [...d.ranges, [start, end]] };
    });
  }

  function removeRange(day: WeekdayKey, index: number) {
    updateDay(day, (d) => {
      const ranges = d.ranges.filter((_, i) => i !== index);
      return { open: ranges.length > 0 && d.open, ranges };
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const input: ClinicSettingsInput = {
      timezone,
      business_hours: toBusinessHours(hours),
      default_appointment_minutes: minutes,
      reception_email: email,
    };
    const parsed = clinicSettingsSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error.issues));
      toast.error('Revisa los datos del formulario');
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await updateClinicSettings(input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success('Configuración guardada');
      router.refresh();
    });
  }

  const e = errors;
  const hoursRootError = e.business_hours?.[0];

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Horario de atención</CardTitle>
          <CardDescription>
            {botEnabled
              ? 'El bot y la agenda solo permiten citas dentro de este horario, en la zona horaria del consultorio.'
              : 'La agenda solo permite citas dentro de este horario, en la zona horaria del consultorio.'}{' '}
            Puedes partir el día en varios horarios (p. ej. de 9:00 a 14:00 y de 16:00 a 20:00).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1">
          {hoursRootError && (
            <p className="text-sm text-destructive" role="alert">
              {hoursRootError}
            </p>
          )}
          <ul className="divide-y">
            {WEEKDAY_KEYS.map((day) => {
              const state = hours[day];
              const { dayMessage, byRange } = dayErrors(e, day);
              const openId = `open-${day}`;
              const dayErrorId = `hours-${day}-error`;
              return (
                <li key={day} className="grid gap-2 py-3 sm:grid-cols-[9rem_1fr] sm:items-start">
                  <div className="flex items-center gap-2 sm:pt-1.5">
                    <input
                      id={openId}
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={state.open}
                      onChange={(ev) => setOpen(day, ev.target.checked)}
                    />
                    <label htmlFor={openId} className="text-sm font-medium">
                      {WEEKDAY_LABEL[day]}
                    </label>
                  </div>
                  {state.open ? (
                    <div className="grid gap-2">
                      {state.ranges.map((range, i) => {
                        const rangeError = byRange.get(i);
                        const rangeErrorId = `hours-${day}-${i}-error`;
                        const describedBy =
                          [rangeError && rangeErrorId, dayMessage && dayErrorId]
                            .filter(Boolean)
                            .join(' ') || undefined;
                        const invalid = rangeError || dayMessage ? true : undefined;
                        return (
                          <div key={i} className="grid gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Input
                                type="time"
                                step={300}
                                aria-label={`${WEEKDAY_LABEL[day]}, horario ${i + 1}: inicio`}
                                value={range[0]}
                                onChange={(ev) => setRange(day, i, 0, ev.target.value)}
                                aria-invalid={invalid}
                                aria-describedby={describedBy}
                                className="w-32"
                              />
                              <span className="text-sm text-muted-foreground">a</span>
                              <Input
                                type="time"
                                step={300}
                                aria-label={`${WEEKDAY_LABEL[day]}, horario ${i + 1}: fin`}
                                value={range[1]}
                                onChange={(ev) => setRange(day, i, 1, ev.target.value)}
                                aria-invalid={invalid}
                                aria-describedby={describedBy}
                                className="w-32"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeRange(day, i)}
                                aria-label={`Quitar horario ${i + 1} del ${WEEKDAY_LABEL[day].toLowerCase()}`}
                                title="Quitar horario"
                              >
                                <Trash2Icon />
                              </Button>
                            </div>
                            {rangeError && (
                              <p id={rangeErrorId} className="text-sm text-destructive" role="alert">
                                {rangeError}
                              </p>
                            )}
                          </div>
                        );
                      })}
                      {dayMessage && (
                        <p id={dayErrorId} className="text-sm text-destructive" role="alert">
                          {dayMessage}
                        </p>
                      )}
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addRange(day)}
                          disabled={state.ranges.length >= MAX_RANGES}
                          title={
                            state.ranges.length >= MAX_RANGES
                              ? `Máximo ${MAX_RANGES} horarios por día`
                              : undefined
                          }
                        >
                          <PlusIcon />
                          Agregar horario
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground sm:pt-1.5">Cerrado</p>
                  )}
                </li>
              );
            })}
          </ul>
          {allClosed && (
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {botEnabled
                ? 'Con todos los días cerrados el bot no podrá proponer citas.'
                : 'Con todos los días cerrados no se podrán agendar citas.'}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{botEnabled ? 'Citas y avisos' : 'Citas'}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="timezone"
            label="Zona horaria"
            error={e.timezone}
            hint="Las horas del horario de atención están en esta zona."
          >
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="timezone" className="w-full" {...errorProps('timezone', e.timezone)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!KNOWN_ZONES.has(settings.timezone) && (
                  <SelectGroup>
                    <SelectLabel>Actual</SelectLabel>
                    <SelectItem value={settings.timezone}>{settings.timezone}</SelectItem>
                  </SelectGroup>
                )}
                {TIMEZONE_GROUPS.map((group) => (
                  <SelectGroup key={group.label}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {group.zones.map((zone) => (
                      <SelectItem key={zone.value} value={zone.value}>
                        {zone.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField
            id="default_appointment_minutes"
            label="Duración de la cita (minutos)"
            error={e.default_appointment_minutes}
            hint={
              botEnabled
                ? 'Duración de las citas que agenda el bot, de 10 a 240 minutos.'
                : 'Duración inicial de las citas nuevas en la agenda, de 10 a 240 minutos.'
            }
          >
            <Input
              id="default_appointment_minutes"
              type="number"
              inputMode="numeric"
              min={10}
              max={240}
              step={5}
              value={minutes}
              onChange={(ev) => setMinutes(ev.target.value)}
              {...errorProps('default_appointment_minutes', e.default_appointment_minutes)}
            />
          </FormField>
          {botEnabled && (
            <FormField
              id="reception_email"
              label="Correo de la recepción"
              error={e.reception_email}
              hint="Opcional. Recibe un aviso cuando el bot pasa una conversación a la recepción."
              className="sm:col-span-2"
            >
              <Input
                id="reception_email"
                type="email"
                autoComplete="email"
                placeholder="recepcion@consultorio.mx"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                {...errorProps('reception_email', e.reception_email)}
              />
            </FormField>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending || readOnly}
          title={readOnly ? READ_ONLY_HINT : undefined}
        >
          {pending ? 'Guardando…' : 'Guardar configuración'}
        </Button>
      </div>
    </form>
  );
}

function addHours(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${String(Math.min(h + hours, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
