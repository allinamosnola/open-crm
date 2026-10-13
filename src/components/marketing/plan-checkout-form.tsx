'use client';

import { useActionState } from 'react';

import { cn } from '@/lib/utils';
import { formatoMxn } from '@/lib/planes-publicos';
import { startPublicCheckout, type PublicCheckoutState } from '@/lib/stripe/public-checkout';

// Botón de una tarifa de la landing: abre el Checkout de Stripe. Básico ofrece el
// complemento Bot con una casilla (precio: monto en MXN del complemento).
export function PlanCheckoutForm({
  plan,
  cta,
  className,
  botPrice,
}: {
  plan: 'basic' | 'pro' | 'plus';
  cta: string;
  className: string;
  botPrice?: number;
}) {
  const [state, action, pending] = useActionState<PublicCheckoutState, FormData>(
    startPublicCheckout,
    null,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="plan" value={plan} />
      {/* Campo trampa: oculto para personas, los bots lo llenan. */}
      <input
        type="text"
        name="sitio_web"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="hidden"
      />
      {botPrice !== undefined && (
        <label className="flex items-center gap-2.5 text-[15px]">
          <input type="checkbox" name="botAddon" className="size-4 accent-current" />
          <span>🤖 Añadir bot de WhatsApp (+{formatoMxn(botPrice)} / mes)</span>
        </label>
      )}
      <button
        type="submit"
        disabled={pending}
        className={cn(
          'flex min-h-12 items-center justify-center rounded-full font-bold transition-colors disabled:opacity-60',
          className,
        )}
      >
        {pending ? 'Abriendo el pago…' : cta}
      </button>
      {state?.error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
