'use client';

import { CreditCardIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AccountPlan } from '@/lib/db/types';
import { formatoMxn } from '@/lib/planes-publicos';
import {
  changePlan,
  openBillingPortal,
  startCheckout,
  type CheckoutInput,
} from '@/lib/stripe/actions';

// Montos en pesos tal como los cobra Stripe (null si no se pudieron leer).
export type DisplayPrices = { basic: number; bot: number; pro: number; plus: number } | null;

type Option = { key: string; label: string; price: number | null; input: CheckoutInput };

function optionsFor(prices: DisplayPrices): Option[] {
  return [
    { key: 'basic', label: 'Básico', price: prices?.basic ?? null, input: { plan: 'basic' } },
    {
      key: 'basic+bot',
      label: 'Básico + Bot',
      price: prices ? prices.basic + prices.bot : null,
      input: { plan: 'basic', botAddon: true },
    },
    { key: 'pro', label: 'Pro', price: prices?.pro ?? null, input: { plan: 'pro' } },
    { key: 'plus', label: 'Plus', price: prices?.plus ?? null, input: { plan: 'plus' } },
  ];
}

const STATUS_NOTE: Record<string, string> = {
  past_due: 'Tu último pago no se pudo cobrar. Actualiza tu tarjeta para reactivar el consultorio.',
  unpaid: 'Tu último pago no se pudo cobrar. Actualiza tu tarjeta para reactivar el consultorio.',
  canceled: 'Tu suscripción está cancelada. Contrata un plan para reactivar el consultorio.',
};

// Contratar (Stripe Checkout), cambiar de plan (ítems de la suscripción) o
// gestionar la facturación (portal de Stripe). Solo el owner. El plan de la
// cuenta lo cambia el webhook cuando Stripe confirma, no esta pantalla.
export function BillingCard({
  subscribed,
  hasCustomer,
  billingStatus,
  prices,
  plan,
  botAddon,
}: {
  subscribed: boolean;
  hasCustomer: boolean;
  billingStatus: string | null;
  prices: DisplayPrices;
  // Plan actual de la cuenta (para marcar el actual al cambiar).
  plan: AccountPlan;
  botAddon: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [target, setTarget] = useState<Option | null>(null);

  const options = optionsFor(prices);
  const currentKey = plan === 'basic' ? (botAddon ? 'basic+bot' : 'basic') : plan;
  const current = options.find((o) => o.key === currentKey);

  function go(key: string, run: () => ReturnType<typeof openBillingPortal>) {
    setBusy(key);
    startTransition(async () => {
      const result = await run();
      if (result.ok) {
        window.location.href = result.data.url;
        return;
      }
      toast.error(result.error);
      setBusy(null);
    });
  }

  function confirmChange(option: Option) {
    setBusy(`change:${option.key}`);
    startTransition(async () => {
      const result = await changePlan(option.input);
      if (!result.ok) {
        toast.error(result.error);
        setBusy(null);
        return;
      }
      toast.success(`Plan cambiado a ${option.label}.`);
      setTarget(null);
      setBusy(null);
      // El plan lo sincroniza el webhook: puede tardar unos segundos.
      router.refresh();
      setTimeout(() => router.refresh(), 3000);
    });
  }

  const note = billingStatus ? STATUS_NOTE[billingStatus] : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCardIcon className="size-5" aria-hidden />
          Facturación
        </CardTitle>
        <CardDescription>
          Pagos mensuales con tarjeta en pesos (MXN). Los precios no incluyen IVA.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {note && <p className="text-sm text-amber-900 dark:text-amber-100">{note}</p>}

        {subscribed ? (
          <>
            <div className="space-y-2">
              <p className="text-sm font-medium">Cambiar de plan</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {options.map((o) => {
                  const isCurrent = o.key === currentKey;
                  return (
                    <Button
                      key={o.key}
                      variant={target?.key === o.key ? 'default' : 'outline'}
                      disabled={pending || isCurrent}
                      className="h-auto justify-between py-3"
                      onClick={() => setTarget(o)}
                    >
                      <span>{isCurrent ? `${o.label} (actual)` : o.label}</span>
                      {o.price !== null && (
                        <span className="tabular-nums text-muted-foreground">
                          {formatoMxn(o.price)}/mes
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>

            {target && (
              <div className="space-y-3 rounded-lg border bg-muted/40 p-3 text-sm">
                <p>
                  Pasarás de <strong>{current?.label ?? 'tu plan actual'}</strong>
                  {current?.price != null && ` (${formatoMxn(current.price)}/mes)`} a{' '}
                  <strong>{target.label}</strong>
                  {target.price !== null && ` (${formatoMxn(target.price)}/mes)`}. La diferencia se
                  cobra o se abona de inmediato, prorrateada por los días que faltan del mes; si
                  baja, queda como saldo a favor en tu próxima factura.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={pending} onClick={() => confirmChange(target)}>
                    {busy === `change:${target.key}` ? 'Cambiando…' : `Confirmar cambio a ${target.label}`}
                  </Button>
                  <Button variant="ghost" disabled={pending} onClick={() => setTarget(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            <Button
              variant="outline"
              disabled={pending}
              onClick={() => go('portal', openBillingPortal)}
            >
              {busy === 'portal' ? 'Abriendo…' : 'Gestionar facturación'}
            </Button>
          </>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((o) => (
                <Button
                  key={o.key}
                  variant="outline"
                  disabled={pending}
                  className="h-auto justify-between py-3"
                  onClick={() => go(o.key, () => startCheckout(o.input))}
                >
                  <span>{busy === o.key ? 'Abriendo…' : `Contratar ${o.label}`}</span>
                  {o.price !== null && (
                    <span className="tabular-nums text-muted-foreground">
                      {formatoMxn(o.price)}/mes
                    </span>
                  )}
                </Button>
              ))}
            </div>
            {hasCustomer && (
              <Button
                variant="link"
                className="px-0"
                disabled={pending}
                onClick={() => go('portal', openBillingPortal)}
              >
                Ver facturas y métodos de pago
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
