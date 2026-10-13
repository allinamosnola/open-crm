import { AlertTriangleIcon, MessageCircleIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  APPT_STATUS_LABEL,
  ITEM_STATUS_LABEL,
  PLAN_STATUS_LABEL,
  UNIDENTIFIED_LABEL,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

const TONE = {
  neutral: 'bg-muted text-muted-foreground',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
} as const;
type Tone = keyof typeof TONE;

const APPT_TONE: Record<Enums<'appt_status'>, Tone> = {
  scheduled: 'blue',
  confirmed: 'green',
  completed: 'neutral',
  cancelled: 'red',
  no_show: 'amber',
};
const PLAN_TONE: Record<Enums<'plan_status'>, Tone> = {
  draft: 'neutral',
  active: 'blue',
  completed: 'green',
  cancelled: 'red',
};
const ITEM_TONE: Record<Enums<'item_status'>, Tone> = {
  pending: 'neutral',
  in_progress: 'amber',
  done: 'green',
  cancelled: 'red',
};

function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <Badge className={cn('border-transparent', TONE[tone])}>{children}</Badge>;
}

export function AppointmentStatusBadge({ status }: { status: Enums<'appt_status'> }) {
  return <ToneBadge tone={APPT_TONE[status]}>{APPT_STATUS_LABEL[status]}</ToneBadge>;
}

export function PlanStatusBadge({ status }: { status: Enums<'plan_status'> }) {
  return <ToneBadge tone={PLAN_TONE[status]}>{PLAN_STATUS_LABEL[status]}</ToneBadge>;
}

export function ItemStatusBadge({ status }: { status: Enums<'item_status'> }) {
  return <ToneBadge tone={ITEM_TONE[status]}>{ITEM_STATUS_LABEL[status]}</ToneBadge>;
}

// Paciente que llegó por WhatsApp y aún no tiene nombre.
export function UnidentifiedBadge() {
  return <ToneBadge tone="amber">{UNIDENTIFIED_LABEL}</ToneBadge>;
}

export function BotPausedBadge() {
  return <ToneBadge tone="neutral">Bot pausado</ToneBadge>;
}

// Conversación que el bot pasó a la recepción y sigue sin resolver.
export function NeedsAttentionBadge() {
  return (
    <ToneBadge tone="amber">
      <AlertTriangleIcon aria-hidden />
      Requiere atención
    </ToneBadge>
  );
}

// Cita agendada por el bot de WhatsApp (appointments.source = 'whatsapp').
export function WhatsAppBadge() {
  return (
    <ToneBadge tone="green">
      <MessageCircleIcon aria-hidden />
      WhatsApp
    </ToneBadge>
  );
}
