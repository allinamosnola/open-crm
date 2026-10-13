import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BillingCard } from '@/components/plan/billing-card';
import { BotUpsellCard } from '@/components/plan/bot-upsell-card';
import { isAtLimit, isOverLimit } from '@/components/plan/limits';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getEntitlements } from '@/lib/db/account';
import { NEXT_PLAN, PLAN_LABEL } from '@/lib/db/plan-limits';
import { getCurrentStaff } from '@/lib/db/staff';
import { reportError } from '@/lib/observability';
import { getBillingSummary } from '@/lib/stripe/actions';
import { getPlanPrices } from '@/lib/stripe/config';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Plan · CitaBot Dental' };

function UsageRow({
  label,
  hint,
  used,
  max,
}: {
  label: string;
  hint: string;
  used: number;
  max: number | null;
}) {
  const atLimit = isAtLimit(used, max);
  const over = isOverLimit(used, max);
  const percent = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="flex items-center gap-2 text-sm tabular-nums">
          {max === null ? `${used} (ilimitados)` : `${used} de ${max}`}
          {over ? (
            <Badge className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              Excede el plan
            </Badge>
          ) : atLimit ? (
            <Badge variant="secondary">Tope alcanzado</Badge>
          ) : null}
        </span>
      </div>
      {max !== null && (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={used}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full rounded-full',
              over ? 'bg-amber-500 dark:bg-amber-600' : 'bg-section-config',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

// Plan de la cuenta, uso vs. tope y estado del bot. Solo el owner (las
// funciones SQL dejan leerlo a todo el personal, pero el panel solo lo muestra
// al owner). La facturación (Stripe) la gestiona BillingCard.
export default async function PlanPage() {
  const me = await getCurrentStaff();
  if (!me || me.role !== 'owner') notFound();
  const ent = await getEntitlements();
  if (!ent) notFound();
  const billing = await getBillingSummary();
  // Montos que cobra Stripe (por lookup_key). Si Stripe no responde la página
  // sigue funcionando sin montos: Checkout muestra el precio real.
  const prices = billing
    ? await getPlanPrices()
        .then((p) => ({
          basic: p.basic.amount,
          bot: p.bot.amount,
          pro: p.pro.amount,
          plus: p.plus.amount,
        }))
        .catch((error) => {
          reportError('No se pudieron leer los precios de Stripe:', error, {
            where: 'plan.getPlanPrices',
          });
          return null;
        })
    : null;

  const clinicsAtLimit = isAtLimit(ent.clinics_used, ent.max_clinics);
  const doctorsAtLimit = isAtLimit(ent.doctors_used, ent.max_doctors);
  const anyOver =
    isOverLimit(ent.clinics_used, ent.max_clinics) ||
    isOverLimit(ent.doctors_used, ent.max_doctors);
  const next = NEXT_PLAN[ent.plan];
  const limited = [clinicsAtLimit && 'consultorios', doctorsAtLimit && 'doctores'].filter(
    Boolean,
  ) as string[];

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Plan</h1>
        <p className="text-sm text-muted-foreground">
          Plan de la cuenta de {me.clinic.name}: lo comparten todos sus consultorios.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Plan {PLAN_LABEL[ent.plan]}
            {ent.plan === 'basic' && ent.bot_addon && (
              <Badge variant="secondary">Complemento Bot</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {ent.plan === 'basic'
              ? ent.bot_addon
                ? 'Incluye el complemento Bot de WhatsApp.'
                : 'Sin el complemento Bot de WhatsApp.'
              : 'Incluye el bot de WhatsApp.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm">
            {ent.bot_enabled ? (
              <>
                <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
                Bot de WhatsApp activo
              </>
            ) : (
              <>
                <InfoIcon className="size-4 text-muted-foreground" />
                Bot de WhatsApp no incluido
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uso del plan</CardTitle>
          <CardDescription>Lo que tienes hoy contra lo que incluye tu plan.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <UsageRow
            label="Consultorios"
            hint="Consultorios de la cuenta."
            used={ent.clinics_used}
            max={ent.max_clinics}
          />
          <UsageRow
            label="Doctores"
            hint="Personas distintas con rol de dentista o dueño, activas en cualquiera de los consultorios. El dueño cuenta como doctor."
            used={ent.doctors_used}
            max={ent.max_doctors}
          />
          <UsageRow
            label={`Recepción en ${me.clinic.name}`}
            hint={`Recepcionistas activos de este consultorio. Todos los planes incluyen ${ent.max_receptionists_per_clinic} por consultorio.`}
            used={ent.receptionists_used}
            max={ent.max_receptionists_per_clinic}
          />
        </CardContent>
      </Card>

      {anyOver && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50">
          <AlertTriangleIcon />
          <AlertTitle>Tienes más de lo que incluye tu plan</AlertTitle>
          <AlertDescription className="text-amber-900 dark:text-amber-100">
            Lo que ya existe se conserva, pero no puedes agregar más mientras sigas por encima del
            tope.
          </AlertDescription>
        </Alert>
      )}

      {limited.length > 0 && (
        <Alert>
          <InfoIcon />
          <AlertTitle>Llegaste al tope de {limited.join(' y ')}</AlertTitle>
          <AlertDescription>
            {next
              ? `Para agregar más, sube al plan ${PLAN_LABEL[next]}.`
              : 'Para ampliarlo, contáctanos.'}
          </AlertDescription>
        </Alert>
      )}

      {!ent.bot_enabled && <BotUpsellCard plan={ent.plan} isOwner hideAction />}

      {billing && (
        <BillingCard
          subscribed={billing.subscribed}
          hasCustomer={billing.hasCustomer}
          billingStatus={billing.billingStatus}
          prices={prices}
          plan={ent.plan}
          botAddon={ent.bot_addon}
        />
      )}
    </div>
  );
}
