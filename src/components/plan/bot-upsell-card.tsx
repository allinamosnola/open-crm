import { MessageSquareIcon } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PLAN_LABEL } from '@/lib/db/plan-limits';
import type { AccountPlan } from '@/lib/db/types';
import { cn } from '@/lib/utils';

// Se muestra en lugar de las Conversaciones y de los ajustes del bot cuando el
// plan de la cuenta no incluye el bot de WhatsApp (bot_enabled = false).
export function BotUpsellCard({
  plan,
  isOwner,
  hideAction = false,
  className,
}: {
  plan: AccountPlan;
  isOwner: boolean;
  // En /configuracion/plan no hace falta el enlace a esa misma página.
  hideAction?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn('border-section-conversaciones/40', className)}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-section-conversaciones-soft text-section-conversaciones"
          >
            <MessageSquareIcon className="size-5" />
          </span>
          <div>
            <CardTitle>Activa el bot de WhatsApp</CardTitle>
            <CardDescription>
              Tu plan {PLAN_LABEL[plan]} no incluye el bot de WhatsApp.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          El bot contesta a tus pacientes por WhatsApp, propone y agenda citas en tu horario y pasa
          a la recepción las conversaciones que lo necesitan.
        </p>
        <p>
          Lo incluyen los planes <strong>{PLAN_LABEL.pro}</strong> y{' '}
          <strong>{PLAN_LABEL.plus}</strong>, o el complemento <strong>Bot</strong> del plan{' '}
          <strong>{PLAN_LABEL.basic}</strong>.
        </p>
        {hideAction ? null : isOwner ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/configuracion/plan">Ver mi plan</Link>
          </Button>
        ) : (
          <p className="text-muted-foreground">
            Pídele al dueño del consultorio que active el bot.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
