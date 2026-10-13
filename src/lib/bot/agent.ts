// Agente del bot de WhatsApp: Claude conversa y usa herramientas; las reglas
// duras las valida el código de cada herramienta (tools.ts). Independiente del
// canal: el webhook de Twilio (src/lib/whatsapp/inbound.ts), el simulador
// (scripts/bot-chat.ts) y Wechaty (scripts/wechaty-dev.ts) llaman a handleMessage().
//
// Por cada mensaje entrante:
//   1. toma el candado de la conversación (bot_acquire_turn), esperando si otro
//      mensaje se está procesando;
//   2. lee el contexto (consultorio, paciente, últimos ~20 mensajes) y, si el
//      último mensaje ya no es del paciente (otro turno ya lo respondió) o el
//      bot está pausado, no responde;
//   3. corre el loop de herramientas con el Tool Runner del SDK;
//   4. aplica el escalamiento y el contador de "no entendí";
//   5. guarda bot_state y suelta el candado.

import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageParam, BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages';

import { NOT_UNDERSTOOD_TAG, STAFF_MESSAGE_PREFIX, SYSTEM_PROMPT, buildContextPrompt } from './prompt';
import { EMPTY_REPLY_FALLBACK, ESCALATION_REPLY } from './replies';
import type { BotRepository, HistoryMessage } from './repository';
import { bookingWindow } from './slots';
import { parseBotState, type BotState } from './state';
import { createAgentTools, escalateConversation, type EscalationNotifier, type ToolContext } from './tools';
import { reportError } from '@/lib/observability';
import { createRetryingFetch, type FetchRetryOptions } from '@/lib/retry';

export const DEFAULT_MODEL = 'claude-sonnet-5';
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

// Mensajes del historial que ve el modelo.
export const HISTORY_LIMIT = 20;
// Turnos seguidos sin entender antes de escalar a la recepción.
export const NOT_UNDERSTOOD_LIMIT = 2;
// Máximo de llamadas a la API por mensaje (cada una puede usar herramientas).
const MAX_ITERATIONS = 8;
// Adaptive thinking cuenta dentro de max_tokens: se deja margen.
const MAX_TOKENS = 4096;
// Vencimiento del candado (por si el proceso muere a mitad del turno) y
// tiempo máximo esperando a que otro mensaje termine.
const LEASE_SECONDS = 90;
const DEFAULT_WAIT_MS = 25_000;

export interface BotDeps {
  repo: BotRepository;
  // Aviso por email a la recepción al escalar; por defecto, Resend.
  notify?: EscalationNotifier;
  // Cliente de Anthropic (los tests inyectan uno con fetch simulado).
  anthropic?: Anthropic;
  model?: string;
  effort?: Effort;
  now?: () => Date;
  waitForTurnMs?: number;
  // Observabilidad (eval y tests).
  onToolCall?: (name: string, input: unknown) => void;
  onUsage?: (usage: BetaUsage) => void;
}

// Cliente de Anthropic con reintentos propios (withRetry) en cada petición HTTP:
// 429/529/5xx y errores de red, respetando retry-after. Se desactivan los del
// SDK para no reintentar dos veces y para registrar cada intento en Sentry.
export function createAnthropicClient(
  options: { apiKey?: string; fetch?: typeof fetch; retry?: Partial<FetchRetryOptions> } = {},
): Anthropic {
  return new Anthropic({
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    maxRetries: 0,
    fetch: createRetryingFetch({ ...options.retry, fetch: options.fetch, where: 'anthropic.messages' }),
  });
}

// El cliente se crea al primer uso: si se creara al importar el módulo, el build
// de Next (que evalúa la ruta del webhook) fallaría sin ANTHROPIC_API_KEY.
let defaultClient: Anthropic | null = null;
function getDefaultClient(): Anthropic {
  defaultClient ??= createAnthropicClient();
  return defaultClient;
}

// CLAUDE_BOT_EFFORT (no CLAUDE_EFFORT, que usan otras herramientas de Claude).
function configuredEffort(): Effort {
  const value = process.env.CLAUDE_BOT_EFFORT as Effort | undefined;
  return value && EFFORTS.includes(value) ? value : 'low';
}

// Email a la recepción si el consultorio tiene correo configurado. Se importa
// al usarse para que el agente no dependa de 'server-only' al cargarse (eval).
const defaultNotifier: EscalationNotifier = async ({ clinic, patient, conversationId, category, reason }) => {
  if (!clinic.reception_email) return;
  const { sendEscalationEmail } = await import('@/lib/notify/email');
  await sendEscalationEmail({
    to: clinic.reception_email,
    clinicName: clinic.name,
    patientName: patient.full_name,
    patientPhone: patient.phone,
    category,
    reason,
    conversationId,
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Historial de messages -> mensajes de la API: paciente = user; bot y
// recepción = assistant (la recepción con etiqueta). El primero debe ser user.
export function toApiMessages(history: HistoryMessage[]): BetaMessageParam[] {
  const messages: BetaMessageParam[] = [];
  for (const m of history) {
    const body = m.body.trim();
    if (!body) continue;
    if (m.sender === 'patient') {
      messages.push({ role: 'user', content: body });
    } else {
      if (!messages.length) continue;
      messages.push({ role: 'assistant', content: m.sender === 'staff' ? `${STAFF_MESSAGE_PREFIX} ${body}` : body });
    }
  }
  return messages;
}

// Texto final del modelo (bloques de texto de la última respuesta).
function finalText(content: { type: string; text?: string }[]): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

async function acquireTurn(repo: BotRepository, conversationId: string, waitMs: number) {
  const deadline = Date.now() + waitMs;
  let delay = 250;
  while (true) {
    const lock = await repo.acquireTurn(conversationId, LEASE_SECONDS);
    if (lock.acquired) return lock;
    if (Date.now() + delay > deadline) return null;
    await sleep(delay);
    delay = Math.min(delay * 2, 2_000);
  }
}

// Procesa un mensaje del paciente y devuelve el texto a enviar ('' = no enviar
// nada). conversationId es conversations.id; el mensaje ya debe estar guardado
// en messages (lo guarda el webhook antes de llamar aquí). Lanza si Claude o la
// base fallan; el canal responde entonces con BOT_ERROR_REPLY.
export async function handleMessage(conversationId: string, text: string, deps: BotDeps): Promise<string> {
  const { repo } = deps;
  const lock = await acquireTurn(repo, conversationId, deps.waitForTurnMs ?? DEFAULT_WAIT_MS);
  if (!lock) {
    reportError(
      `No se obtuvo el turno de la conversación ${conversationId}: otro mensaje sigue en proceso`,
      new Error('bot_turn_not_acquired'),
      { where: 'agent.acquireTurn' },
    );
    return '';
  }

  let state: BotState | null = null;
  try {
    const context = await repo.loadTurnContext(conversationId, HISTORY_LIMIT);
    if (!context || context.botPaused) return '';
    // Si otro turno ya respondió a este mensaje (llegaron juntos), no se repite.
    const last = context.history.at(-1);
    if (last && last.sender !== 'patient') return '';

    const now = deps.now?.() ?? new Date();
    state = parseBotState(lock.state);
    // Se olvidan los huecos que ya no cumplen la anticipación mínima.
    const { earliest } = bookingWindow(now);
    state.offered_slots = state.offered_slots.filter((s) => new Date(s.starts_at) >= earliest);

    const upcoming = await repo.listUpcomingAppointments(context.clinic.id, context.patient.id, now.toISOString());
    const ctx: ToolContext = {
      repo,
      now,
      conversationId,
      clinic: context.clinic,
      patient: context.patient,
      state,
      escalation: null,
      notify: deps.notify ?? defaultNotifier,
      onToolCall: deps.onToolCall,
    };

    let messages = toApiMessages(context.history);
    if (!messages.length) messages = [{ role: 'user', content: text }];

    const client = deps.anthropic ?? getDefaultClient();
    const runner = client.beta.messages.toolRunner({
      model: deps.model || process.env.CLAUDE_MODEL || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      max_iterations: MAX_ITERATIONS,
      // Sin thinking explícito: Sonnet 5 usa adaptive thinking por defecto. Sin
      // temperature (Sonnet 5 rechaza valores no default).
      output_config: { effort: deps.effort ?? configuredEffort() },
      system: [
        // Herramientas + instrucciones fijas: prefijo idéntico en cada llamada (caché).
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: buildContextPrompt({
            now,
            clinic: context.clinic,
            patient: context.patient,
            upcoming,
            offeredSlots: state.offered_slots,
          }) },
      ],
      tools: createAgentTools(ctx),
      messages,
    });

    let final: Awaited<ReturnType<typeof runner.runUntilDone>> | null = null;
    for await (const message of runner) {
      final = message;
      deps.onUsage?.(message.usage);
    }

    // Escalamiento hecho por una herramienta: aviso fijo al paciente.
    if (ctx.escalation) return ESCALATION_REPLY[ctx.escalation.category];

    let reply = final ? finalText(final.content) : '';
    if (reply.startsWith(NOT_UNDERSTOOD_TAG)) {
      reply = reply.slice(NOT_UNDERSTOOD_TAG.length).trim();
      state.not_understood += 1;
      if (state.not_understood >= NOT_UNDERSTOOD_LIMIT) {
        await escalateConversation(
          ctx,
          'not_understood',
          `El bot no entendió ${NOT_UNDERSTOOD_LIMIT} mensajes seguidos del paciente.`,
        );
        return ESCALATION_REPLY.not_understood;
      }
    } else {
      state.not_understood = 0;
    }
    return reply.replaceAll(NOT_UNDERSTOOD_TAG, '').trim() || EMPTY_REPLY_FALLBACK;
  } finally {
    try {
      await repo.releaseTurn(conversationId, lock.token, state);
    } catch (error) {
      // El candado vence solo (LEASE_SECONDS).
      reportError('No se pudo soltar el turno del bot:', error, { where: 'agent.releaseTurn' });
    }
  }
}
