// Textos de los planes y traducción de los errores de tope a mensajes en
// español. Sin 'use server' ni 'server-only': es lógica pura (se prueba con
// vitest y se puede importar desde Client Components).
//
// Los topes NO se repiten aquí: salen de la base (account_entitlements /
// my_entitlements). Los triggers de la Fase 1 lanzan SQLSTATE P0001 con el
// nombre del tope en el hint.

import type { AccountPlan, Entitlements } from './types';

export const PLAN_LABEL: Record<AccountPlan, string> = {
  basic: 'Básico',
  pro: 'Pro',
  plus: 'Plus',
};

// Plan al que conviene subir para ampliar consultorios o doctores.
export const NEXT_PLAN: Record<AccountPlan, AccountPlan | null> = {
  basic: 'pro',
  pro: 'plus',
  plus: null,
};

// Server actions de la bandeja cuando el plan del consultorio activo no incluye
// el bot de WhatsApp (src/lib/db/conversations.ts).
export const BOT_REQUIRED_TO_REPLY = 'Tu plan no incluye WhatsApp. Sube de plan para responder mensajes.';
export const BOT_REQUIRED_TO_MANAGE =
  'Tu plan no incluye WhatsApp. Sube de plan para administrar las conversaciones.';

export const PLAN_LIMIT_HINTS = [
  'max_clinics',
  'max_doctors',
  'max_receptionists',
  'bot_required',
] as const;
export type PlanLimitHint = (typeof PLAN_LIMIT_HINTS)[number];

// Nombre del tope si el error es de un trigger de topes; null si es otro error.
export function planLimitHint(
  error: { code?: string | null; hint?: string | null } | null | undefined,
): PlanLimitHint | null {
  if (!error || error.code !== 'P0001' || !error.hint) return null;
  return (PLAN_LIMIT_HINTS as readonly string[]).includes(error.hint)
    ? (error.hint as PlanLimitHint)
    : null;
}

// Lo que el mensaje necesita saber del plan (CurrentStaff.clinic.account o
// Entitlements). Sin él se devuelve un mensaje genérico.
export type PlanInfo = Pick<Entitlements, 'plan' | 'max_clinics' | 'max_doctors'>;

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function upgradeHint(plan: AccountPlan): string {
  const next = NEXT_PLAN[plan];
  return next ? `Sube a ${PLAN_LABEL[next]} para agregar más.` : 'Contáctanos para ampliarlo.';
}

// Mensaje para la UI de un error de tope.
export function planLimitMessage(hint: PlanLimitHint, plan?: PlanInfo | null): string {
  switch (hint) {
    case 'max_doctors':
      if (plan && plan.max_doctors !== null) {
        return `Tu plan ${PLAN_LABEL[plan.plan]} incluye ${plural(plan.max_doctors, 'doctor', 'doctores')}. ${upgradeHint(plan.plan)}`;
      }
      return 'Tu plan no permite agregar más doctores. Sube de plan para agregar más.';
    case 'max_clinics':
      if (plan && plan.max_clinics !== null) {
        return `Tu plan ${PLAN_LABEL[plan.plan]} incluye ${plural(plan.max_clinics, 'consultorio', 'consultorios')}. ${upgradeHint(plan.plan)}`;
      }
      return 'Tu plan no permite agregar más consultorios. Sube de plan para agregar más.';
    case 'max_receptionists':
      // Igual en todos los planes: no se resuelve subiendo de plan.
      return 'Este consultorio ya tiene a su recepcionista activo. Desactívalo para agregar a otra persona.';
    case 'bot_required':
      if (plan) {
        return `Tu plan ${PLAN_LABEL[plan.plan]} no incluye el bot de WhatsApp. Agrega el complemento Bot o sube a ${PLAN_LABEL.pro}.`;
      }
      return `Tu plan no incluye el bot de WhatsApp. Agrega el complemento Bot o sube a ${PLAN_LABEL.pro}.`;
  }
}

// Atajo para las server actions: mensaje si el error es de tope, null si no.
export function planLimitError(
  error: { code?: string | null; hint?: string | null } | null | undefined,
  plan?: PlanInfo | null,
): string | null {
  const hint = planLimitHint(error);
  return hint ? planLimitMessage(hint, plan) : null;
}
