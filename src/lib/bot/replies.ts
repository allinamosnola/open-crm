// Respuestas fijas (sin IA). Sin dependencias para poder usarlas en el
// webhook, el agente, los scripts y los tests.

import type { AttentionCategory } from '@/lib/db/types';

// Consultorio con la suscripción vencida o cancelada: se guarda el mensaje y
// se responde esto sin llamar a Claude.
export const SUBSCRIPTION_INACTIVE_REPLY =
  'Recibimos tu mensaje; el consultorio te contactará pronto.';

// El plan de la cuenta ya no incluye el bot (p. ej. bajó de plan y conservó el
// número). No se guarda nada del mensaje y se responde esto, como mucho una vez
// cada 24 h por número de paciente (ver whatsapp_claim_disabled_reply).
// Texto de cara al paciente: revisarlo con el consultorio antes de cambiarlo.
export const BOT_DISABLED_REPLY =
  'Gracias por escribir. Este número ya no atiende mensajes automáticos; comunícate directamente con el consultorio.';

// Llegó solo multimedia (foto, audio, documento) sin texto.
export const MEDIA_ONLY_REPLY =
  'Por ahora solo puedo leer mensajes de texto. ¿Me escribes tu mensaje, por favor?';

// El bot falló (Claude o la base de datos no respondieron).
export const BOT_ERROR_REPLY = 'Ocurrió un error de mi lado, intenta de nuevo en un momento.';

// El modelo no devolvió texto (caso raro: se cortó o rechazó responder).
export const EMPTY_REPLY_FALLBACK = 'Perdón, no pude procesar tu mensaje. ¿Me lo escribes de otra forma?';

// Aviso al paciente cuando el bot pasa la conversación a la recepción. Es fijo
// (no lo redacta el modelo) para que siempre diga lo mismo, en especial en urgencias.
export const ESCALATION_REPLY: Record<AttentionCategory, string> = {
  human_requested: 'Claro. Ya avisé a la recepción del consultorio; una persona te escribirá pronto por aquí.',
  urgent:
    'Lamento que te sientas así. Ya avisé a la recepción para que te contacte lo antes posible. ' +
    'Si el dolor, el sangrado o la inflamación son intensos, llama al consultorio o acude a un servicio de urgencias.',
  policy:
    'Con menos de 24 horas de anticipación no puedo cancelar ni cambiar tu cita por aquí. ' +
    'Ya avisé a la recepción para que te contacte.',
  not_understood: 'Perdón, no logré entenderte. Ya avisé a la recepción para que te contacte por aquí.',
  other: 'Eso lo tiene que responder el consultorio. Ya avisé a la recepción para que te contacte por aquí.',
};
