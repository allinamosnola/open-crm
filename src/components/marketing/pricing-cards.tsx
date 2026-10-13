import { Check, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { PRECIO_BASICA_CON_BOT, PRECIOS, formatoMxn } from '@/lib/planes-publicos';

import { PlanCheckoutForm } from './plan-checkout-form';

type Plan = {
  // Identificador del plan en la base y en Stripe.
  id: 'basic' | 'pro' | 'plus';
  nombre: string;
  descripcion: string;
  precio: number;
  incluye: { texto: string; incluido: boolean }[];
  cta: string;
  destacado?: boolean;
  // Clases por plan: cada uno toma el color de una sección del panel.
  acento: string;
  borde: string;
  boton: string;
};

const PLANES: Plan[] = [
  {
    id: 'basic',
    nombre: 'Básico',
    descripcion: 'Agenda y pacientes para un consultorio.',
    precio: PRECIOS.basica,
    incluye: [
      { texto: 'Agenda de citas', incluido: true },
      { texto: 'Registro de pacientes', incluido: true },
      { texto: '1 consultorio, 1 doctor, 1 recepcionista', incluido: true },
      { texto: 'Sin 🤖 bot de WhatsApp (se puede añadir 😉)', incluido: false },
    ],
    cta: 'Empezar con Básico',
    acento: 'text-section-agenda',
    borde: 'border-t-section-agenda',
    boton: 'border border-section-agenda text-section-agenda hover:bg-section-agenda-soft',
  },
  {
    id: 'pro',
    nombre: 'Pro',
    descripcion: 'Varios consultorios, con bot incluido.',
    precio: PRECIOS.pro,
    incluye: [
      { texto: 'Todo lo de Básico', incluido: true },
      { texto: 'Hasta 3 consultorios cada uno con 3 doctores', incluido: true },
      { texto: '🤖 Bot de WhatsApp incluido', incluido: true },
    ],
    cta: 'Elegir Pro',
    destacado: true,
    acento: 'text-section-pacientes',
    borde: 'border-section-pacientes',
    boton: 'bg-section-pacientes text-white hover:opacity-90',
  },
  {
    id: 'plus',
    nombre: 'Plus',
    descripcion: 'Para clínicas que crecen sin tope.',
    precio: PRECIOS.plus,
    incluye: [
      { texto: 'Todo lo de Pro', incluido: true },
      { texto: 'Doctores ilimitados', incluido: true },
      { texto: 'Incluye hasta 5 consultorios', incluido: true },
      {
        texto: `+${formatoMxn(PRECIOS.plusConsultorioExtra)} / mes por cada consultorio extra`,
        incluido: true,
      },
    ],
    cta: 'Elegir Plus',
    acento: 'text-section-conversaciones',
    borde: 'border-t-section-conversaciones',
    boton:
      'border border-section-conversaciones text-section-conversaciones hover:bg-section-conversaciones-soft',
  },
];

export function PricingCards() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-3">
        {PLANES.map((plan) => (
          <div
            key={plan.nombre}
            className={cn(
              'relative flex flex-col gap-5 rounded-3xl border bg-card p-8 text-card-foreground',
              plan.destacado ? 'border-2 shadow-xl' : 'border-t-[6px]',
              plan.borde,
            )}
          >
            {plan.destacado && (
              <span className="absolute -top-3.5 left-8 rounded-full bg-section-pacientes px-3.5 py-1 text-[13px] font-bold text-white">
                Más elegido
              </span>
            )}
            <div className="flex flex-col gap-1.5">
              <h3 className={cn('text-[22px] font-extrabold', plan.acento)}>{plan.nombre}</h3>
              <p className="text-[15px] text-muted-foreground">{plan.descripcion}</p>
            </div>
            <p className="flex items-baseline gap-1.5">
              <span className="text-5xl font-extrabold tracking-tight">
                {formatoMxn(plan.precio)}
              </span>
              <span className="text-[15px] text-muted-foreground">/ mes + IVA</span>
            </p>
            <ul className="flex flex-1 flex-col gap-3 text-[15px]">
              {plan.incluye.map((item) => (
                <li
                  key={item.texto}
                  className={cn('flex gap-2.5', !item.incluido && 'text-muted-foreground')}
                >
                  {item.incluido ? (
                    <Check className={cn('mt-0.5 size-5 shrink-0', plan.acento)} aria-hidden />
                  ) : (
                    <Minus className="mt-0.5 size-5 shrink-0" aria-hidden />
                  )}
                  {item.texto}
                </li>
              ))}
            </ul>
            <PlanCheckoutForm
              plan={plan.id}
              cta={plan.cta}
              className={plan.boton}
              botPrice={plan.id === 'basic' ? PRECIOS.complementoBot : undefined}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-5 rounded-3xl border border-section-config/30 bg-section-config-soft px-8 py-7 text-section-config">
        <div className="flex max-w-xl flex-col gap-1.5">
          <h3 className="text-xl font-extrabold">Complemento Bot de WhatsApp</h3>
          <p className="text-[15px] leading-relaxed">
            Añádelo a tu plan Básico y el bot atiende y agenda por ti. Básico + Bot:{' '}
            {formatoMxn(PRECIO_BASICA_CON_BOT)} / mes + IVA.
          </p>
        </div>
        <p className="flex items-baseline gap-1.5">
          <span className="text-4xl font-extrabold">+{formatoMxn(PRECIOS.complementoBot)}</span>
          <span className="text-[15px]">/ mes + IVA</span>
        </p>
      </div>
    </div>
  );
}
