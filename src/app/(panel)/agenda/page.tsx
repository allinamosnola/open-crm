import type { Metadata } from 'next';

import { AgendaCalendar } from '@/components/calendar/agenda-calendar';
import { getClinicSettings } from '@/lib/db/clinic';
import { getCurrentStaff, listDentists } from '@/lib/db/staff';

export const metadata: Metadata = { title: 'Agenda · CitaBot Dental' };

export default async function AgendaPage() {
  const [staff, dentists, clinic] = await Promise.all([
    getCurrentStaff(),
    listDentists(),
    getClinicSettings(),
  ]);
  // El layout del panel ya muestra "cuenta sin acceso" si no hay staff.
  if (!staff) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Agenda</h1>
      <AgendaCalendar
        dentists={dentists}
        currentStaff={{ id: staff.id, role: staff.role }}
        defaultAppointmentMinutes={clinic?.default_appointment_minutes}
        businessHours={clinic?.business_hours}
      />
    </div>
  );
}
