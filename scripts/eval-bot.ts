// Eval del bot con el modelo real (CUESTA DINERO: llama a la API de Anthropic).
// ~30 conversaciones en español (scripts/eval/cases.ts) contra el agente real
// (prompt, herramientas y reglas); las herramientas operan sobre el repositorio
// en memoria, así que no se toca ninguna base de datos ni WhatsApp.
//
// Uso:
//   npm run eval:bot                 # imprime el costo estimado y pide confirmación
//   npm run eval:bot -- --yes        # sin confirmación
//   npm run eval:bot -- --only precio,urgencia-dolor
//   npm run eval:bot -- --effort medium   # comparar esfuerzos (default: el del bot)
// Requiere ANTHROPIC_API_KEY. Modelo: CLAUDE_MODEL (default claude-sonnet-5).

import 'dotenv/config';

import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import Anthropic from '@anthropic-ai/sdk';

import { DEFAULT_MODEL, handleMessage } from '../src/lib/bot/agent';
import {
  createMemoryBotRepository,
  emptyConversation,
  SAMPLE_BUSINESS_HOURS,
  type MemoryAppointment,
  type MemoryBotRepository,
} from '../src/lib/bot/memory-repository';

import { EVAL_CASES, EVAL_NOW, type EvalCase } from './eval/cases';

// Precios de Claude Sonnet 5 (USD por millón de tokens).
const PRICE = { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 };
// Supuestos de la estimación (conservadores, sin descontar la caché):
// ~2.5 llamadas por mensaje (buscar + responder), ~4,000 tokens de entrada por
// llamada (herramientas + instrucciones + contexto + historial) y ~400 de salida
// (incluye el thinking adaptativo con effort bajo). Tope: 8 llamadas por mensaje.
const EST = { callsPerTurn: 2.5, maxCallsPerTurn: 8, inputPerCall: 4_000, outputPerCall: 400 };

const { values } = parseArgs({
  options: {
    yes: { type: 'boolean', default: false },
    only: { type: 'string' },
    effort: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log('Uso: npm run eval:bot -- [--yes] [--only id1,id2] [--effort low|medium|high]');
  process.exit(0);
}

const CLINIC = 'clinic-eval';
const PATIENT = 'patient-eval';
const OTHER = 'patient-other';
const CONVERSATION = 'conv-eval';
const ANA = 'dentist-ana';

function fixture(c: EvalCase): MemoryBotRepository {
  const hours = (h: number) => new Date(EVAL_NOW.getTime() + h * 3_600_000).toISOString();
  const appointments: MemoryAppointment[] = [];
  if (c.appointmentInHours !== undefined) {
    appointments.push({
      id: 'appt-paciente',
      clinic_id: CLINIC,
      patient_id: PATIENT,
      dentist_id: ANA,
      starts_at: hours(c.appointmentInHours),
      ends_at: hours(c.appointmentInHours + 0.5),
      status: 'scheduled',
      source: 'panel',
    });
  }
  if (c.otherPatientAppointment) {
    appointments.push({
      id: 'appt-otro',
      clinic_id: CLINIC,
      patient_id: OTHER,
      dentist_id: ANA,
      starts_at: hours(50),
      ends_at: hours(50.5),
      status: 'scheduled',
      source: 'panel',
    });
  }
  const unidentified = c.patient === 'unidentified';
  return createMemoryBotRepository({
    clinics: [
      {
        id: CLINIC,
        name: 'Consultorio Sonrisas',
        timezone: 'America/Mexico_City',
        business_hours: SAMPLE_BUSINESS_HOURS,
        default_appointment_minutes: 30,
        reception_email: 'recepcion@demo.local',
      },
    ],
    dentists: [
      { id: ANA, clinic_id: CLINIC, full_name: 'Dra. Ana López', active: true },
      { id: 'dentist-pablo', clinic_id: CLINIC, full_name: 'Dr. Pablo Ruiz', active: true },
    ],
    patients: [
      {
        id: PATIENT,
        clinic_id: CLINIC,
        full_name: unidentified ? null : 'María González',
        status: unidentified ? 'unidentified' : 'active',
        phone: '+525522223333',
      },
      { id: OTHER, clinic_id: CLINIC, full_name: 'Carlos Hernández', status: 'active', phone: '+525511112222' },
    ],
    appointments,
    conversations: [emptyConversation(CONVERSATION, CLINIC, PATIENT)],
  });
}

interface Usage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  calls: number;
}

function cost(u: Usage): number {
  return (u.input * PRICE.input + u.output * PRICE.output + u.cacheWrite * PRICE.cacheWrite + u.cacheRead * PRICE.cacheRead) / 1e6;
}

async function runCase(client: Anthropic, c: EvalCase, usage: Usage) {
  const repo = fixture(c);
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const replies: string[] = [];
  const before = structuredClone(repo.data.appointments);

  for (const body of c.turns) {
    // Si el bot ya escaló, la conversación quedó pausada: no se sigue.
    if (repo.data.conversations[0].bot_paused) break;
    repo.addMessage(CONVERSATION, 'patient', body);
    const reply = await handleMessage(CONVERSATION, body, {
      repo,
      anthropic: client,
      now: () => EVAL_NOW,
      notify: async () => {},
      ...(values.effort ? { effort: values.effort as 'low' | 'medium' | 'high' } : {}),
      onToolCall: (name, input) => calls.push({ name, input: (input ?? {}) as Record<string, unknown> }),
      onUsage: (u) => {
        usage.calls += 1;
        usage.input += u.input_tokens;
        usage.output += u.output_tokens;
        usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
        usage.cacheRead += u.cache_read_input_tokens ?? 0;
      },
    });
    replies.push(reply);
    if (reply) repo.addMessage(CONVERSATION, 'bot', reply);
  }

  const failures: string[] = [];
  const called = new Set(calls.map((x) => x.name));
  const e = c.expect;
  for (const tool of e.calls ?? []) if (!called.has(tool)) failures.push(`no llamó ${tool}`);
  for (const tool of e.notCalls ?? []) if (called.has(tool)) failures.push(`llamó ${tool} (no debía)`);
  for (const [tool, max] of Object.entries(e.maxCalls ?? {})) {
    const times = calls.filter((x) => x.name === tool).length;
    if (times > max) failures.push(`llamó ${tool} ${times} veces (máximo ${max})`);
  }
  if (e.toolInput) {
    const inputs = calls.filter((x) => x.name === e.toolInput!.tool).map((x) => x.input);
    if (!inputs.some(e.toolInput.match)) {
      failures.push(`${e.toolInput.tool}: se esperaba ${e.toolInput.description}; recibió ${JSON.stringify(inputs)}`);
    }
  }
  const conversation = repo.data.conversations[0];
  if (e.escalation !== undefined) {
    const got = conversation.needs_attention ? conversation.attention_category : null;
    if (got !== e.escalation) failures.push(`escalamiento: se esperaba ${e.escalation ?? 'ninguno'}, fue ${got ?? 'ninguno'}`);
  }
  if (e.appointments) {
    const after = repo.data.appointments;
    const created = after.filter((a) => !before.some((b) => b.id === a.id)).length;
    const cancelled = after.filter((a) => a.status === 'cancelled' && before.find((b) => b.id === a.id)?.status !== 'cancelled').length;
    const moved = after.filter((a) => {
      const prev = before.find((b) => b.id === a.id);
      return prev && prev.starts_at !== a.starts_at;
    }).length;
    const counts = { created, cancelled, moved };
    for (const [key, expected] of Object.entries(e.appointments)) {
      const got = counts[key as keyof typeof counts];
      if (got !== expected) failures.push(`citas ${key}: se esperaba ${expected}, fue ${got}`);
    }
  }
  for (const pattern of e.replyExcludes ?? []) {
    const hit = replies.find((r) => pattern.test(r));
    if (hit) failures.push(`respuesta contiene ${pattern}: "${hit.slice(0, 120)}"`);
  }
  for (const pattern of e.lastReplyIncludes ?? []) {
    if (!pattern.test(replies.at(-1) ?? '')) failures.push(`la última respuesta no contiene ${pattern}`);
  }
  return { failures, calls, replies };
}

async function main() {
  const selected = values.only
    ? EVAL_CASES.filter((c) => values.only!.split(',').map((s) => s.trim()).includes(c.id))
    : EVAL_CASES;
  if (!selected.length) throw new Error('Ningún caso coincide con --only');

  const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const turns = selected.reduce((n, c) => n + c.turns.length, 0);
  const perCall = (EST.inputPerCall * PRICE.input + EST.outputPerCall * PRICE.output) / 1e6;
  const estimate = turns * EST.callsPerTurn * perCall;
  const ceiling = turns * EST.maxCallsPerTurn * perCall;
  console.log(`Eval del bot: ${selected.length} casos, ${turns} mensajes del paciente, modelo ${model}.`);
  console.log(
    `Costo estimado: ~$${estimate.toFixed(2)} USD (tope teórico ~$${ceiling.toFixed(2)} si cada mensaje usara ` +
      `${EST.maxCallsPerTurn} llamadas). Precios: $${PRICE.input}/$${PRICE.output} por millón de tokens de entrada/salida.`,
  );

  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY');
  if (!values.yes) {
    if (!process.stdin.isTTY) throw new Error('Sin terminal interactiva: usa --yes para confirmar el gasto');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('Esto llama a la API real y cuesta dinero. ¿Continuar? (escribe "si"): ')).trim();
    rl.close();
    if (!/^s[ií]$/i.test(answer)) {
      console.log('Cancelado.');
      return;
    }
  }

  const client = new Anthropic();
  const usage: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, calls: 0 };
  let failed = 0;
  for (const c of selected) {
    process.stdout.write(`- ${c.id}: `);
    try {
      const { failures, calls, replies } = await runCase(client, c, usage);
      if (failures.length) {
        failed++;
        console.log('FALLA');
        for (const f of failures) console.log(`    · ${f}`);
        console.log(`    herramientas: ${calls.map((x) => x.name).join(', ') || 'ninguna'}`);
        replies.forEach((r, i) => console.log(`    bot[${i + 1}]: ${r.replace(/\s+/g, ' ').slice(0, 200)}`));
      } else {
        console.log('OK');
      }
    } catch (error) {
      failed++;
      console.log(`ERROR ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`\n${selected.length - failed}/${selected.length} casos OK.`);
  console.log(
    `Uso real: ${usage.calls} llamadas; entrada ${usage.input} + caché escrita ${usage.cacheWrite} + caché leída ` +
      `${usage.cacheRead} tokens; salida ${usage.output} tokens. Costo real: $${cost(usage).toFixed(2)} USD.`,
  );
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
