'use client';

import type {
  DateSelectArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core';
import esLocale from '@fullcalendar/core/locales/es';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { MessageCircleIcon, PlusIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  AppointmentCreateDialog,
  type DentistOption,
  type NewAppointmentSlot,
} from '@/components/calendar/appointment-create-dialog';
import {
  AppointmentEditDialog,
  type EditableAppointment,
} from '@/components/calendar/appointment-edit-dialog';
import { READ_ONLY_HINT, useReadOnly } from '@/components/layout/read-only';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { listAppointments, updateAppointment } from '@/lib/db/appointments';
import { actsAsDentist, type AppointmentWithRelations, type BusinessHours } from '@/lib/db/types';
import { buildAgendaGrid, GRID_MINUTES, resolveNewAppointmentEnd } from '@/lib/agenda';
import { isWithinBusinessHours } from '@/lib/bot/slots';
import { APPT_STATUS_LABEL, patientName } from '@/lib/format';
import type { Enums } from '@/types/database';

const ALL = 'all';

// Colores por dentista (vista "Todos"), con buen contraste para texto blanco.
const DENTIST_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#4d7c0f', '#b91c1c'];

// Colores por estado (vista de un solo dentista).
const STATUS_COLORS: Record<Enums<'appt_status'>, string> = {
  scheduled: '#2563eb',
  confirmed: '#059669',
  completed: '#64748b',
  no_show: '#d97706',
  cancelled: '#b91c1c',
};

// Filas de la cuadrícula del calendario; la duración de una cita nueva no sale de
// aquí sino de la configuración del consultorio (la misma que usa el bot).
const SLOT_MINUTES = GRID_MINUTES;
const FALLBACK_APPOINTMENT_MINUTES = 30;

// Próximo hueco desde ahora; con horario configurado, el primero que cabe dentro
// de él (la rejilla del calendario usa la zona del navegador).
function nextSlot(
  durationMinutes: number,
  hours: BusinessHours | undefined,
): { start: Date; end: Date } {
  const first = new Date();
  first.setSeconds(0, 0);
  first.setMinutes(Math.ceil(first.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES);
  const range = (start: Date) => ({
    start,
    end: new Date(start.getTime() + durationMinutes * 60_000),
  });
  if (!hours || !buildAgendaGrid(hours).businessHours) return range(first);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const maxSteps = (14 * 24 * 60) / SLOT_MINUTES;
  for (let i = 0; i < maxSteps; i++) {
    const { start, end } = range(new Date(first.getTime() + i * SLOT_MINUTES * 60_000));
    if (isWithinBusinessHours(start, end, hours, tz)) return { start, end };
  }
  return range(first);
}

export function AgendaCalendar({
  dentists,
  currentStaff,
  defaultAppointmentMinutes = FALLBACK_APPOINTMENT_MINUTES,
  businessHours,
}: {
  dentists: DentistOption[];
  currentStaff: { id: string; role: Enums<'staff_role'> };
  // Duración por defecto del consultorio (/configuracion/consultorio).
  defaultAppointmentMinutes?: number;
  // Horario del consultorio: lo que queda fuera se bloquea en la agenda.
  businessHours?: BusinessHours;
}) {
  const calendarRef = useRef<FullCalendar>(null);
  const [dentistFilter, setDentistFilter] = useState<string>(ALL);
  const [newSlot, setNewSlot] = useState<(NewAppointmentSlot & { key: number }) | null>(null);
  const [editing, setEditing] = useState<EditableAppointment | null>(null);
  const readOnly = useReadOnly();
  const grid = useMemo(() => buildAgendaGrid(businessHours), [businessHours]);

  const colorByDentist = useMemo(
    () => new Map(dentists.map((d, i) => [d.id, DENTIST_COLORS[i % DENTIST_COLORS.length]])),
    [dentists],
  );

  // Una función nueva por filtro: FullCalendar detecta el cambio y vuelve a pedir el rango.
  const fetchEvents = useCallback(
    async (info: { start: Date; end: Date }): Promise<EventInput[]> => {
      try {
        const appointments = await listAppointments({
          from: info.start.toISOString(),
          to: info.end.toISOString(),
          dentistId: dentistFilter === ALL ? null : dentistFilter,
        });
        return appointments
          .filter((a) => a.status !== 'cancelled')
          .map((a) => {
            const color =
              dentistFilter === ALL
                ? (colorByDentist.get(a.dentist_id) ?? '#475569')
                : STATUS_COLORS[a.status];
            return {
              id: a.id,
              title: a.patient ? patientName(a.patient) : 'Paciente',
              start: a.starts_at,
              end: a.ends_at,
              backgroundColor: color,
              borderColor: color,
              textColor: '#ffffff',
              extendedProps: { appointment: a },
            };
          });
      } catch {
        toast.error('No se pudieron cargar las citas');
        throw new Error('No se pudieron cargar las citas');
      }
    },
    [dentistFilter, colorByDentist],
  );

  const refetch = () => calendarRef.current?.getApi().refetchEvents();

  function defaultDentistId(): string | null {
    if (dentistFilter !== ALL) return dentistFilter;
    // El owner cuenta como dentista; si no está en la lista (p. ej. inactivo) no se sugiere.
    if (actsAsDentist(currentStaff.role) && dentists.some((d) => d.id === currentStaff.id)) {
      return currentStaff.id;
    }
    return dentists.length === 1 ? dentists[0].id : null;
  }

  function onSelect(info: DateSelectArg) {
    info.view.calendar.unselect();
    const end = resolveNewAppointmentEnd(info.start, info.end, defaultAppointmentMinutes);
    setNewSlot({ start: info.start, end, dentistId: defaultDentistId(), key: Date.now() });
  }

  function onEventClick(info: EventClickArg) {
    const appointment = info.event.extendedProps.appointment as AppointmentWithRelations;
    setEditing({
      appointment,
      start: info.event.start ?? new Date(appointment.starts_at),
      end: info.event.end ?? new Date(appointment.ends_at),
    });
  }

  // Arrastrar o redimensionar: se guarda; si falla (p. ej. traslape) se revierte.
  async function onEventChange(info: EventDropArg | EventResizeDoneArg) {
    const { event, revert } = info;
    if (!event.start || !event.end) {
      revert();
      return;
    }
    const result = await updateAppointment(event.id, {
      starts_at: event.start.toISOString(),
      ends_at: event.end.toISOString(),
    });
    if (!result.ok) {
      revert();
      toast.error(result.error);
      return;
    }
    toast.success('Horario actualizado');
    refetch();
  }

  function renderEvent(arg: EventContentArg) {
    const a = arg.event.extendedProps.appointment as AppointmentWithRelations | undefined;
    return (
      <div className="flex h-full flex-col overflow-hidden px-0.5 text-xs leading-tight">
        <span className="flex items-center gap-1 font-medium opacity-90">
          {arg.timeText}
          {a?.source === 'whatsapp' && (
            <span className="ml-auto inline-flex shrink-0" title="Agendada por WhatsApp">
              <MessageCircleIcon className="size-3" aria-hidden />
              <span className="sr-only">Agendada por WhatsApp</span>
            </span>
          )}
        </span>
        <span className="truncate font-semibold">{arg.event.title}</span>
        {a && dentistFilter === ALL && a.dentist && (
          <span className="truncate opacity-90">{a.dentist.full_name}</span>
        )}
        {a?.reason && <span className="truncate opacity-90">{a.reason}</span>}
        {a && a.status !== 'scheduled' && (
          <span className="truncate italic opacity-90">{APPT_STATUS_LABEL[a.status]}</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="dentist-filter">Dentista</Label>
          <Select value={dentistFilter} onValueChange={setDentistFilter}>
            <SelectTrigger id="dentist-filter" className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {dentists.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Legend
          items={
            dentistFilter === ALL
              ? dentists.map((d) => ({ label: d.full_name, color: colorByDentist.get(d.id)! }))
              : (['scheduled', 'confirmed', 'completed', 'no_show'] as const).map((s) => ({
                  label: APPT_STATUS_LABEL[s],
                  color: STATUS_COLORS[s],
                }))
          }
        />

        <Button
          disabled={readOnly}
          title={readOnly ? READ_ONLY_HINT : undefined}
          onClick={() =>
            setNewSlot({ ...nextSlot(defaultAppointmentMinutes, businessHours), dentistId: defaultDentistId(), key: Date.now() })
          }
        >
          <PlusIcon />
          Nueva cita
        </Button>
      </div>

      <div className="agenda-calendar rounded-lg border bg-card p-2 lg:p-3">
        <FullCalendar
          ref={calendarRef}
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          locale={esLocale}
          timeZone="local"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridDay,timeGridWeek,dayGridMonth',
          }}
          firstDay={1}
          hiddenDays={grid.hiddenDays}
          slotMinTime={grid.slotMinTime}
          slotMaxTime={grid.slotMaxTime}
          slotDuration="00:30:00"
          snapDuration="00:15:00"
          businessHours={grid.businessHours ?? false}
          selectConstraint={grid.businessHours ? 'businessHours' : undefined}
          eventConstraint={grid.businessHours ? 'businessHours' : undefined}
          allDaySlot={false}
          nowIndicator
          height="auto"
          expandRows
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          selectable={!readOnly}
          selectMirror
          selectAllow={(info) => !info.allDay}
          editable={!readOnly}
          eventDurationEditable={!readOnly}
          events={fetchEvents}
          select={onSelect}
          eventClick={onEventClick}
          eventDrop={onEventChange}
          eventResize={onEventChange}
          eventContent={renderEvent}
        />
      </div>

      {newSlot && (
        <AppointmentCreateDialog
          key={newSlot.key}
          slot={newSlot}
          dentists={dentists}
          businessHours={businessHours}
          onClose={() => setNewSlot(null)}
          onCreated={() => {
            setNewSlot(null);
            refetch();
          }}
        />
      )}
      {editing && (
        <AppointmentEditDialog
          key={editing.appointment.id}
          data={editing}
          businessHours={businessHours}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mr-auto flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Leyenda de colores">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ backgroundColor: it.color }} aria-hidden />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
