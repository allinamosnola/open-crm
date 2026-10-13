import 'server-only';

import type { AttentionCategory } from '@/lib/db/types';
import { reportError } from '@/lib/observability';
import { fetchWithRetry, type RetryOptions } from '@/lib/retry';

// Avisos por email a la recepción con Resend (API REST, sin SDK). Requiere
// RESEND_API_KEY y EMAIL_FROM con un dominio verificado en Resend. Si faltan,
// no se envía nada y el escalamiento queda solo como aviso en el panel.
// Nunca lanza: un email fallido no debe tumbar la respuesta al paciente.

const RESEND_URL = 'https://api.resend.com/emails';
// Timeout de cada intento: el aviso corre dentro del turno del bot.
const RESEND_TIMEOUT_MS = 10_000;

export const ATTENTION_CATEGORY_TEXT: Record<AttentionCategory, string> = {
  human_requested: 'El paciente pidió hablar con una persona',
  urgent: 'Posible urgencia',
  policy: 'Cancelar o reagendar con menos de 24 h',
  not_understood: 'El bot no entendió al paciente',
  other: 'Pregunta que el bot no puede responder',
};

export interface EscalationEmail {
  to: string;
  clinicName: string;
  patientName: string | null;
  patientPhone: string | null;
  category: AttentionCategory;
  reason: string;
  conversationId: string;
}

export type EmailResult = { sent: true; id: string | null } | { sent: false; reason: string };

function panelLink(conversationId: string): string | null {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '');
  return base ? `${base}/conversaciones?c=${conversationId}` : null;
}

export function buildEscalationEmail(params: EscalationEmail): { subject: string; text: string } {
  const patient = params.patientName ?? 'Paciente por identificar';
  const urgent = params.category === 'urgent' ? '[URGENTE] ' : '';
  const link = panelLink(params.conversationId);
  const lines = [
    `El bot de WhatsApp de ${params.clinicName} pasó una conversación a la recepción.`,
    '',
    `Paciente: ${patient}${params.patientPhone ? ` (${params.patientPhone})` : ''}`,
    `Motivo: ${ATTENTION_CATEGORY_TEXT[params.category]}`,
    `Detalle: ${params.reason}`,
    '',
    'El bot quedó pausado en esta conversación hasta que alguien la marque como resuelta.',
    ...(link ? ['', `Abrir la conversación: ${link}`] : []),
  ];
  return {
    subject: `${urgent}Requiere atención: ${patient} por WhatsApp`,
    text: lines.join('\n'),
  };
}

// Reintenta 429/5xx/timeouts con la misma Idempotency-Key: si Resend recibió
// el primer intento, el reintento no duplica el correo.
export async function sendEscalationEmail(
  params: EscalationEmail,
  options: { retry?: Partial<RetryOptions>; fetch?: typeof fetch } = {},
): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn('Email de escalamiento no enviado: faltan RESEND_API_KEY o EMAIL_FROM');
    return { sent: false, reason: 'not_configured' };
  }

  const { subject, text } = buildEscalationEmail(params);
  try {
    const response = await fetchWithRetry(
      RESEND_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `escalation-${params.conversationId}-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ from, to: [params.to], subject, text }),
      },
      { timeoutMs: RESEND_TIMEOUT_MS, ...options.retry, fetch: options.fetch, where: 'email.resend' },
    );
    if (!response.ok) {
      reportError(
        `Resend rechazó el email de escalamiento (${response.status}):`,
        new Error(`resend_http_${response.status}`),
        { where: 'email.resend', extra: { status: response.status } },
      );
      return { sent: false, reason: `http_${response.status}` };
    }
    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, id: body?.id ?? null };
  } catch {
    // Red o timeout tras agotar los intentos (ya reportado por withRetry).
    return { sent: false, reason: 'network' };
  }
}
