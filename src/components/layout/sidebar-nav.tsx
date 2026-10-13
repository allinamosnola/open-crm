'use client';

import {
  AlertTriangleIcon,
  Building2Icon,
  CalendarDaysIcon,
  CreditCardIcon,
  MessageSquareIcon,
  UserCogIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  installAudioUnlock,
  isSoundEnabled,
  playAttentionSound,
} from '@/components/layout/attention-sound';
import { detectNewEscalation, type ConversationChange } from '@/lib/attention';
import { countNeedsAttention, countUnread } from '@/lib/db/conversations';
import { ATTENTION_CATEGORY_LABEL } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

type Section = 'agenda' | 'pacientes' | 'conversaciones' | 'config';
type NavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  section: Section;
  ownerOnly?: boolean;
  // Solo con el bot de WhatsApp incluido en el plan.
  botOnly?: boolean;
};

// Cada sección tiene su color (tokens --section-* de globals.css) para que se
// reconozca a simple vista en cuál se está trabajando. Clases completas para que
// Tailwind las detecte.
const SECTION_STYLE: Record<Section, { active: string; icon: string; bar: string }> = {
  agenda: { active: 'bg-section-agenda-soft text-foreground hover:bg-section-agenda-soft', icon: 'text-section-agenda', bar: 'bg-section-agenda' },
  pacientes: { active: 'bg-section-pacientes-soft text-foreground hover:bg-section-pacientes-soft', icon: 'text-section-pacientes', bar: 'bg-section-pacientes' },
  conversaciones: { active: 'bg-section-conversaciones-soft text-foreground hover:bg-section-conversaciones-soft', icon: 'text-section-conversaciones', bar: 'bg-section-conversaciones' },
  config: { active: 'bg-section-config-soft text-foreground hover:bg-section-config-soft', icon: 'text-section-config', bar: 'bg-section-config' },
};

const LINKS: NavLink[] = [
  { href: '/agenda', label: 'Agenda', icon: CalendarDaysIcon, section: 'agenda' },
  { href: '/pacientes', label: 'Pacientes', icon: UsersIcon, section: 'pacientes' },
  { href: '/conversaciones', label: 'Conversaciones', icon: MessageSquareIcon, section: 'conversaciones', botOnly: true },
  { href: '/configuracion/personal', label: 'Personal', icon: UserCogIcon, section: 'config', ownerOnly: true },
  { href: '/configuracion/consultorio', label: 'Consultorio', icon: Building2Icon, section: 'config', ownerOnly: true },
  { href: '/configuracion/plan', label: 'Plan', icon: CreditCardIcon, section: 'config', ownerOnly: true },
];

type Counters = { unread: number; attention: number };

async function fetchCounters(): Promise<Counters> {
  const [unread, attention] = await Promise.all([countUnread(), countNeedsAttention()]);
  return { unread, attention };
}

// Contadores de la bandeja (mensajes sin leer y conversaciones que requieren
// atención): parten del valor del servidor y se vuelven a pedir al navegar y
// cuando Realtime avisa de cambios en las conversaciones. Si detecta un
// escalamiento nuevo llama a onEscalation. Con enabled = false (plan sin bot)
// no pide nada ni se suscribe.
function useInboxCounters(
  initial: Counters,
  onEscalation: (row: Record<string, unknown>) => void,
  enabled: boolean,
): Counters {
  const pathname = usePathname();
  const [counters, setCounters] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEscalationRef = useRef(onEscalation);
  useEffect(() => {
    onEscalationRef.current = onEscalation;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchCounters()
      .then((c) => !cancelled && setCounters(c))
      .catch(() => {}); // se conserva el último valor
    return () => {
      cancelled = true;
    };
  }, [pathname, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    const notified = new Map<string, string>();
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        fetchCounters()
          .then(setCounters)
          .catch(() => {});
      }, 400);
    };
    const onChange = (payload: ConversationChange) => {
      refresh();
      if (detectNewEscalation(payload, notified)) {
        onEscalationRef.current(payload.new as Record<string, unknown>);
      }
    };
    const channel = supabase
      .channel(`sidebar-inbox-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, onChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, onChange)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [enabled]);

  return counters;
}

// Aviso de escalamiento nuevo: sonido (si está activado y el navegador ya lo
// permite) y toast con enlace a la conversación.
function useEscalationAlert() {
  const router = useRouter();

  useEffect(() => installAudioUnlock(), []);

  return (row: Record<string, unknown>) => {
    if (isSoundEnabled()) playAttentionSound();
    const id = typeof row.id === 'string' ? row.id : null;
    const category = row.attention_category as Enums<'attention_category'> | null | undefined;
    const reason = typeof row.attention_reason === 'string' ? row.attention_reason : null;
    toast.warning('Una conversación requiere atención', {
      description: [category ? ATTENTION_CATEGORY_LABEL[category] : null, reason]
        .filter(Boolean)
        .join(': '),
      duration: 15_000,
      action: id
        ? { label: 'Ver', onClick: () => router.push(`/conversaciones?c=${id}`) }
        : undefined,
    });
  };
}

function countText(n: number): string {
  return n > 99 ? '99+' : String(n);
}

export function SidebarNav({
  isOwner,
  botEnabled,
  unreadCount,
  attentionCount,
}: {
  isOwner: boolean;
  botEnabled: boolean;
  unreadCount: number;
  attentionCount: number;
}) {
  const pathname = usePathname();
  const onEscalation = useEscalationAlert();
  const { unread, attention } = useInboxCounters(
    { unread: unreadCount, attention: attentionCount },
    onEscalation,
    botEnabled,
  );

  return (
    <nav className="grid gap-1" aria-label="Secciones">
      {LINKS.filter((l) => (!l.ownerOnly || isOwner) && (!l.botOnly || botEnabled)).map(({ href, label, icon: Icon, section }) => {
        const style = SECTION_STYLE[section];
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const isInbox = href === '/conversaciones';
        const showUnread = isInbox && unread > 0;
        const showAttention = isInbox && attention > 0;
        const details = [
          showAttention && `${attention} requieren atención`,
          showUnread && `${unread} sin leer`,
        ].filter(Boolean);
        const fullLabel = details.length ? `${label} (${details.join(', ')})` : label;
        return (
          <Link
            key={href}
            href={href}
            title={fullLabel}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:justify-start',
              active && cn(style.active, 'font-semibold'),
            )}
          >
            {active && (
              <span aria-hidden className={cn('absolute inset-y-1.5 left-0 w-1 rounded-r-full', style.bar)} />
            )}
            <Icon className={cn('size-4 shrink-0', active ? style.icon : 'opacity-70')} />
            <span className="sr-only lg:not-sr-only">{label}</span>
            {details.length > 0 && <span className="sr-only">, {details.join(', ')}</span>}
            {(showAttention || showUnread) && (
              // En tablet los contadores van en las esquinas del icono; en
              // escritorio, alineados a la derecha. Atención (ámbar, con icono)
              // y sin leer (color primario) se distinguen por color y forma.
              <span aria-hidden className="contents lg:ml-auto lg:flex lg:items-center lg:gap-1">
                {showAttention && (
                  <span
                    className="absolute right-0.5 bottom-0.5 inline-flex min-w-4 items-center justify-center gap-0.5 rounded-full bg-amber-500 px-1 text-[10px] leading-4 font-semibold text-white lg:static lg:min-w-5 lg:px-1.5 lg:text-xs lg:leading-5 dark:bg-amber-600"
                  >
                    <AlertTriangleIcon className="hidden size-3 lg:block" />
                    {countText(attention)}
                  </span>
                )}
                {showUnread && (
                  <span className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground lg:static lg:min-w-5 lg:text-xs lg:leading-5">
                    {countText(unread)}
                  </span>
                )}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
