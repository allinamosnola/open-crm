// Fixtures de los tests del bot: consultorio en memoria y un cliente de
// Anthropic real con un fetch simulado (no hace red). Así se prueba el Tool
// Runner del SDK de verdad, con respuestas guionadas.

import Anthropic from '@anthropic-ai/sdk';

import {
  createMemoryBotRepository,
  emptyConversation,
  SAMPLE_BUSINESS_HOURS,
  type MemoryAppointment,
} from '@/lib/bot/memory-repository';
import type { PatientStatus } from '@/lib/db/types';

export const CLINIC = 'clinic-a';
export const ANA = 'dentist-ana';
export const PABLO = 'dentist-pablo';
export const PATIENT = 'patient-1';
export const OTHER_PATIENT = 'patient-2';
export const CONVERSATION = 'conv-1';
// Lunes 5 de octubre de 2026, 06:00 en Ciudad de México (UTC-6, sin horario de verano).
export const NOW = new Date('2026-10-05T12:00:00Z');

export function hoursFromNow(hours: number, base = NOW): string {
  return new Date(base.getTime() + hours * 3_600_000).toISOString();
}

export function createFixture(
  options: {
    patientStatus?: PatientStatus;
    appointments?: Partial<MemoryAppointment>[];
    receptionEmail?: string | null;
    dentists?: string[];
  } = {},
) {
  const status = options.patientStatus ?? 'active';
  const repo = createMemoryBotRepository({
    clinics: [
      {
        id: CLINIC,
        name: 'Consultorio Sonrisas',
        timezone: 'America/Mexico_City',
        business_hours: SAMPLE_BUSINESS_HOURS,
        default_appointment_minutes: 30,
        reception_email: options.receptionEmail === undefined ? 'recepcion@demo.local' : options.receptionEmail,
      },
    ],
    dentists: [
      { id: ANA, clinic_id: CLINIC, full_name: 'Dra. Ana López', active: true },
      { id: PABLO, clinic_id: CLINIC, full_name: 'Dr. Pablo Ruiz', active: true },
    ].filter((d) => !options.dentists || options.dentists.includes(d.id)),
    patients: [
      {
        id: PATIENT,
        clinic_id: CLINIC,
        full_name: status === 'active' ? 'María González' : null,
        status,
        phone: '+525522223333',
      },
      { id: OTHER_PATIENT, clinic_id: CLINIC, full_name: 'Carlos Hernández', status: 'active', phone: '+525511112222' },
    ],
    appointments: (options.appointments ?? []).map((a, i) => ({
      id: `appt-seed-${i + 1}`,
      clinic_id: CLINIC,
      patient_id: PATIENT,
      dentist_id: ANA,
      starts_at: hoursFromNow(48),
      ends_at: hoursFromNow(48.5),
      status: 'scheduled',
      source: 'panel',
      ...a,
    })),
    conversations: [emptyConversation(CONVERSATION, CLINIC, PATIENT)],
  });
  return repo;
}

// ---------------------------------------------------------------------------
// Anthropic simulado
// ---------------------------------------------------------------------------

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

let toolUseSeq = 0;

export const text = (value: string): Block => ({ type: 'text', text: value });
export const toolUse = (name: string, input: Record<string, unknown> = {}): Block => ({
  type: 'tool_use',
  id: `toolu_${++toolUseSeq}`,
  name,
  input,
});

// Cuerpo JSON de una petición a /v1/messages (lo que revisan los tests).
export interface ApiRequest {
  model: string;
  output_config?: { effort?: string };
  system: { type: string; text: string; cache_control?: unknown }[];
  tools: { name: string }[];
  messages: { role: string; content: unknown }[];
  [key: string]: unknown;
}

export interface FakeAnthropic {
  client: Anthropic;
  // Cuerpos JSON de cada petición a /v1/messages, en orden.
  requests: ApiRequest[];
  // Marca de tiempo de inicio y fin de cada petición (para el test del candado).
  timeline: { start: number; end: number }[];
}

// Cada respuesta es la lista de bloques de un turno del modelo; si trae
// tool_use, stop_reason = 'tool_use', si no 'end_turn'.
export function fakeAnthropic(turns: Block[][], options: { delayMs?: number } = {}): FakeAnthropic {
  const requests: ApiRequest[] = [];
  const timeline: { start: number; end: number }[] = [];
  const queue = [...turns];
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const start = Date.now();
    requests.push(JSON.parse(String(init?.body ?? '{}')));
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    const content = queue.shift();
    if (!content) {
      return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'sin guion' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    timeline.push({ start, end: Date.now() });
    const body = {
      id: `msg_${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5',
      content,
      stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      container: null,
      usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new Anthropic({ apiKey: 'test-key', fetch: fetchImpl as typeof fetch, maxRetries: 0 });
  return { client, requests, timeline };
}

// tool_result de una petición (el mensaje user que sigue a un tool_use).
export function toolResults(request: ApiRequest) {
  const last = request.messages.at(-1)!;
  return (last.content as { type: string; tool_use_id: string; content: unknown; is_error?: boolean }[]).filter(
    (b) => b.type === 'tool_result',
  );
}

export function resultText(result: { content: unknown }): string {
  if (typeof result.content === 'string') return result.content;
  return (result.content as { text?: string }[]).map((b) => b.text ?? '').join('');
}
