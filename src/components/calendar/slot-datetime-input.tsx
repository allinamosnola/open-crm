'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BusinessHours, WeekdayKey } from '@/lib/db/types';

// La cuadrícula de la agenda es de 30 min: solo se ofrecen :00 y :30.
const STEP_MINUTES = 30;
const WEEKDAY_BY_INDEX: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const pad = (n: number) => String(n).padStart(2, '0');

// Horas "HH:MM" que se pueden elegir en una fecha según el horario del consultorio:
// un inicio cabe en [desde, hasta) de un rango y un fin en (desde, hasta]. Sin horario
// configurado se ofrece todo el día; un día cerrado no ofrece nada.
function allowedTimes(
  hours: BusinessHours | undefined,
  date: string,
  kind: 'start' | 'end',
): string[] {
  const all: string[] = [];
  for (let m = 0; m < 24 * 60; m += STEP_MINUTES) all.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  if (!hours || !WEEKDAY_BY_INDEX.some((d) => hours[d]?.length)) return all;
  const [y, mo, d] = date.split('-').map(Number);
  if (!y || !mo || !d) return all;
  const ranges = hours[WEEKDAY_BY_INDEX[new Date(y, mo - 1, d).getDay()]] ?? [];
  return all.filter((t) =>
    ranges.some(([from, to]) => (kind === 'start' ? from <= t && t < to : from < t && t <= to)),
  );
}

// Fecha + hora + minutos en lugar de <input type="datetime-local">, que no permite
// limitar las opciones. El valor es "AAAA-MM-DDTHH:mm" (hora local). Las horas siguen el
// horario del consultorio. Si el valor actual no está entre las opciones (p. ej. una cita
// con :15 por un arrastre) se conserva como opción.
export function SlotDateTimeInput({
  id,
  value,
  onChange,
  businessHours,
  kind,
  ...ariaProps
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  businessHours?: BusinessHours;
  kind: 'start' | 'end';
} & React.AriaAttributes) {
  const [date = '', time = ''] = value.split('T');
  const [hour = '', minute = ''] = time.split(':');

  const times = allowedTimes(businessHours, date, kind);
  if (time && !times.includes(time)) times.push(time);
  times.sort();
  const hourOptions = [...new Set(times.map((t) => t.slice(0, 2)))];
  const minuteOptions = times.filter((t) => t.startsWith(`${hour}:`)).map((t) => t.slice(3));

  function update(next: { date?: string; hour?: string; minute?: string }) {
    const d = next.date ?? date;
    if (!d) return onChange('');
    const available = allowedTimes(businessHours, d, kind);
    let h = next.hour ?? hour;
    let m = next.minute ?? minute;
    if (next.hour !== undefined || next.date !== undefined) {
      // Si la combinación no es válida, se salta a la opción más cercana de esa hora/día.
      const candidates = available.filter((t) => (next.hour ? t.startsWith(`${h}:`) : true));
      const wanted = `${h || '00'}:${m || '00'}`;
      const pick = available.includes(wanted) ? wanted : (candidates[0] ?? wanted);
      [h, m] = pick.split(':');
    }
    onChange(`${d}T${h || '09'}:${m || '00'}`);
  }

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        type="date"
        value={date}
        onChange={(e) => update({ date: e.target.value })}
        className="min-w-0 flex-1"
        {...ariaProps}
      />
      <Select value={hour} onValueChange={(h) => update({ hour: h })}>
        <SelectTrigger aria-label="Hora" className="w-[4.5rem]">
          <SelectValue placeholder="hh" />
        </SelectTrigger>
        <SelectContent>
          {hourOptions.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={minute} onValueChange={(m) => update({ minute: m })}>
        <SelectTrigger aria-label="Minutos" className="w-[4.5rem]">
          <SelectValue placeholder="mm" />
        </SelectTrigger>
        <SelectContent>
          {minuteOptions.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
