'use client';

import { useSyncExternalStore } from 'react';

import { formatDateTime, formatSmartDateTime, formatTime } from '@/lib/format';

const subscribe = () => () => {};

// Formatea fechas con la zona horaria del navegador. En el servidor (cuya zona
// puede ser UTC) se renderiza vacío y se completa al hidratar, sin desajustes.
export function LocalDateTime({
  value,
  endValue,
  timeOnly = false,
  smart = false,
}: {
  value: string;
  // Si se indica, agrega " – HH:MM" con la hora de fin.
  endValue?: string;
  timeOnly?: boolean;
  // Solo la hora si es de hoy; si no, fecha corta y hora.
  smart?: boolean;
}) {
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!isClient) {
    return <time dateTime={value} className={smart ? 'inline-block min-w-10' : 'inline-block min-w-24'} />;
  }
  const text = smart
    ? formatSmartDateTime(value)
    : timeOnly
      ? formatTime(value)
      : formatDateTime(value);
  return (
    <time dateTime={value}>
      {text}
      {endValue && ` – ${formatTime(endValue)}`}
    </time>
  );
}
