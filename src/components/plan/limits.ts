// Cálculos de uso vs. tope para la UI (página de plan e invitación de
// personal). Los topes vienen de getEntitlements(); aquí no se repite ninguno.

import { planLimitMessage } from '@/lib/db/plan-limits';
import type { Entitlements, InvitableRole } from '@/lib/db/types';

// null = ilimitado.
export function isAtLimit(used: number, max: number | null): boolean {
  return max !== null && used >= max;
}

export function isOverLimit(used: number, max: number | null): boolean {
  return max !== null && used > max;
}

// Mensaje del tope que impide invitar a alguien con ese rol; null si se puede.
export function inviteLimitMessage(ent: Entitlements, role: InvitableRole): string | null {
  if (role === 'dentist' && isAtLimit(ent.doctors_used, ent.max_doctors)) {
    return planLimitMessage('max_doctors', ent);
  }
  if (
    role === 'receptionist' &&
    isAtLimit(ent.receptionists_used, ent.max_receptionists_per_clinic)
  ) {
    return planLimitMessage('max_receptionists', ent);
  }
  return null;
}
