import { AlertTriangleIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ClinicSettingsForm } from '@/components/clinic/clinic-settings-form';
import { BotUpsellCard } from '@/components/plan/bot-upsell-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getClinicSettings } from '@/lib/db/clinic';
import { getCurrentStaff } from '@/lib/db/staff';

export const metadata: Metadata = { title: 'Consultorio · CitaBot Dental' };

// Configuración del consultorio (horario, zona horaria, duración de la cita)
// que usan la agenda y, si el plan lo incluye, el bot de WhatsApp. Solo el
// owner la ve y la edita (la RLS y la server action también lo exigen).
export default async function ClinicSettingsPage() {
  const me = await getCurrentStaff();
  if (!me || me.role !== 'owner') notFound();
  const settings = await getClinicSettings();
  if (!settings) notFound();

  const botEnabled = me.clinic.account.bot_enabled;
  const hasHours = Object.values(settings.business_hours).some((ranges) => ranges?.length);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Consultorio</h1>
        <p className="text-sm text-muted-foreground">
          {botEnabled
            ? `Horario de atención y datos que usa el bot de WhatsApp de ${settings.name} para proponer citas y avisar a la recepción.`
            : `Horario de atención y duración de las citas de ${settings.name}.`}
        </p>
      </div>

      {!hasHours && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50">
          <AlertTriangleIcon />
          <AlertTitle>No hay horario configurado</AlertTitle>
          <AlertDescription className="text-amber-900 dark:text-amber-100">
            {botEnabled
              ? 'Mientras no configures el horario de atención, el bot no puede proponer citas a los pacientes.'
              : 'Configura el horario de atención para que la agenda muestre cuándo atiende el consultorio.'}
          </AlertDescription>
        </Alert>
      )}

      <ClinicSettingsForm settings={settings} botEnabled={botEnabled} />

      {!botEnabled && <BotUpsellCard plan={me.clinic.account.plan} isOwner />}
    </div>
  );
}
