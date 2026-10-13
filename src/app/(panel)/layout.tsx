import { AlertTriangleIcon } from 'lucide-react';

import { NoAccess, SignOutButton } from '@/components/auth/sign-out';
import { ClinicSwitcher } from '@/components/layout/clinic-switcher';
import { ReadOnlyProvider } from '@/components/layout/read-only';
import { SidebarNav } from '@/components/layout/sidebar-nav';
import { SoundToggle } from '@/components/layout/sound-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Separator } from '@/components/ui/separator';
import { listMyClinics } from '@/lib/db/account';
import { countNeedsAttention, countUnread } from '@/lib/db/conversations';
import { getCurrentStaff } from '@/lib/db/staff';
import { isSubscriptionActive } from '@/lib/db/types';
import { ROLE_LABEL } from '@/lib/format';

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || 'DC'
  );
}

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  // El middleware ya garantiza que hay sesión; aquí se comprueba que sea personal activo.
  const staff = await getCurrentStaff();
  if (!staff) return <NoAccess />;

  // Sin bot no hay bandeja: no se piden los contadores.
  const botEnabled = staff.clinic.account.bot_enabled;
  // Si falla un conteo no se cae el panel: el contador empieza en 0 y se vuelve
  // a pedir. Si falla la lista de consultorios solo se oculta el selector.
  const [unread, attention, clinics] = await Promise.all([
    botEnabled ? countUnread().catch(() => 0) : 0,
    botEnabled ? countNeedsAttention().catch(() => 0) : 0,
    listMyClinics().catch(() => []),
  ]);
  const readOnly = !isSubscriptionActive(staff.clinic.subscription_status);
  const clinicName = staff.clinic.name;

  return (
    <ReadOnlyProvider readOnly={readOnly}>
      <div className="flex min-h-screen flex-1">
        {/* En tablet la barra se reduce a iconos; en escritorio muestra los textos. */}
        <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r bg-sidebar p-2 lg:w-56 lg:p-3">
          {clinics.length >= 2 ? (
            <ClinicSwitcher
              clinics={clinics}
              activeName={clinicName}
              initials={initials(clinicName)}
            />
          ) : (
            <div
              className="mb-4 px-1 py-2 text-center text-sm font-semibold lg:px-3 lg:text-left lg:text-base"
              title={clinicName}
            >
              <span className="lg:hidden" aria-hidden>
                {initials(clinicName)}
              </span>
              <span className="sr-only lg:not-sr-only lg:block lg:truncate">{clinicName}</span>
            </div>
          )}
          {/* key: al cambiar de consultorio se reinician contadores y Realtime. */}
          <SidebarNav
            key={staff.clinic.id}
            isOwner={staff.role === 'owner'}
            botEnabled={botEnabled}
            unreadCount={unread}
            attentionCount={attention}
          />
          <div className="mt-auto space-y-2">
            <Separator />
            <div className="hidden px-3 py-1 lg:block">
              <p className="truncate text-sm font-medium" title={staff.full_name}>
                {staff.full_name}
              </p>
              <p className="text-xs text-muted-foreground">{ROLE_LABEL[staff.role]}</p>
            </div>
            {/* El sonido avisa de escalamientos del bot: sin bot no aplica. */}
            {botEnabled && <SoundToggle />}
            <ThemeToggle />
            <SignOutButton compact />
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 lg:p-6">
          {readOnly && (
            <div
              role="status"
              className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 lg:-mx-6 lg:-mt-6 lg:mb-6 lg:px-6 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
            >
              <AlertTriangleIcon className="size-4 shrink-0" />
              La suscripción del consultorio no está activa: el panel está en modo solo lectura
            </div>
          )}
          {children}
        </main>
      </div>
    </ReadOnlyProvider>
  );
}
