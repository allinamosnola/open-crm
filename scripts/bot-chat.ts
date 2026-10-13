// Simulador de chat en la terminal: hablas con el agente como si fueras un
// paciente por WhatsApp, con un teléfono ficticio, sin tocar WhatsApp ni Twilio.
// Usa Supabase local (las citas, mensajes y escalamientos quedan en la base y se
// ven en el panel) y llama a Anthropic de verdad (cuesta tokens).
//
// Uso:
//   npm run bot:chat -- [--phone +525500000001]
// Requiere en .env: NEXT_PUBLIC_SUPABASE_URL (local), SUPABASE_SERVICE_ROLE_KEY,
// ANTHROPIC_API_KEY y DEV_CLINIC_ID. Comandos: /media (simula una foto sin
// texto), /salir.

import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { normalizeWhatsAppNumber } from '../src/lib/whatsapp/phone';
import type { Sender } from '../src/lib/whatsapp/outbound';

import { openDevChannel, simulateInbound } from './lib/dev-channel';

const { values } = parseArgs({
  options: { phone: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
});

if (values.help) {
  console.log('Uso: npm run bot:chat -- [--phone +525500000001]');
  process.exit(0);
}

// Número ficticio por defecto (formato de celular de México como lo manda WhatsApp).
const phone = normalizeWhatsAppNumber(values.phone ?? '+5215500000001');
if (!phone) {
  console.error('--phone debe ser un número E.164, p. ej. +5215500000001');
  process.exit(1);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY en .env');
  const channel = await openDevChannel();
  console.log(`Consultorio: ${channel.clinic.name}. Escribes como el paciente ${phone}.`);
  console.log('Comandos: /media (foto sin texto), /salir. Cada mensaje llama a Claude (cuesta tokens).\n');

  // "Entrega" la respuesta imprimiéndola; se registra como enviada, sin sid de Twilio.
  const printReply: Sender = async ({ body }) => {
    console.log(`\nBot: ${body}\n`);
    return { sid: null, status: 'sent', errorCode: null };
  };

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const line = (await rl.question('Tú: ')).trim();
      if (!line) continue;
      if (line === '/salir') break;
      const isMedia = line === '/media';
      const outcome = await simulateInbound(
        channel,
        { from: phone!, body: isMedia ? '' : line, numMedia: isMedia ? 1 : 0 },
        printReply,
      );
      if (outcome === 'paused') {
        console.log('\n(El bot está pausado: la recepción atiende esta conversación desde el panel.)\n');
      } else if (outcome === 'ignored') {
        console.log('\n(Mensaje ignorado.)\n');
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
