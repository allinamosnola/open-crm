// Capa de canal (Wechaty), solo para desarrollo. Traduce eventos de WhatsApp a
// la misma lógica del webhook de Twilio (scripts/lib/dev-channel.ts): guarda el
// mensaje en Supabase local, responde con el agente y registra la respuesta.
// No debe contener lógica de negocio.
//
// Requiere Supabase local (`npx supabase start`) y DEV_CLINIC_ID en .env; el
// consultorio debe tener whatsapp_from. Se conecta a una cuenta real de
// WhatsApp: no lo ejecutes sin el dueño de esa cuenta.

import qrcodeTerminal from 'qrcode-terminal';
import { WechatyBuilder, type OfficialPuppetNpmName } from 'wechaty';

import { normalizeWhatsAppNumber } from '../src/lib/whatsapp/phone';
import type { Sender } from '../src/lib/whatsapp/outbound';

import { openDevChannel, simulateInbound, type DevChannel } from './lib/dev-channel';

// "5215512345678@c.us" -> "+5215512345678"; null si el contacto no es un
// número (grupos, contactos @lid).
function phoneFromContactId(id: string): string | null {
  const match = /^(\d{8,15})@c\.us$/.exec(id);
  return match ? normalizeWhatsAppNumber(`+${match[1]}`) : null;
}

let channel: DevChannel;

const bot = WechatyBuilder.build({
  name: 'dental-crm-bot',
  puppet: (process.env.WECHATY_PUPPET || 'wechaty-puppet-whatsapp') as OfficialPuppetNpmName,
  puppetOptions: {
    puppeteer: {
      // headless "new" (el Chrome real, sin bandera de automatización) evita
      // que WhatsApp Web detecte el navegador y falle con "Couldn't log in".
      headless: process.env.WECHATY_PUPPET_HEADLESS !== 'false',
      args: ['--disable-blink-features=AutomationControlled'],
      // Con cuentas de muchos contactos, la sincronización inicial (uno por
      // uno vía page.evaluate) puede tardar más que el default de Puppeteer
      // (180s) y tumbar la conexión con un ProtocolError de timeout.
      protocolTimeout: 600000,
    },
  },
});

bot.on('scan', (qrcode, status) => {
  console.log(`Escanea este QR con WhatsApp para vincular el bot (status: ${status})`);
  qrcodeTerminal.generate(qrcode, { small: true });
});

bot.on('login', (user) => {
  console.log(`Bot vinculado como: ${user}`);
});

bot.on('ready', () => {
  // wechaty-puppet-whatsapp corre cada 2 min una sincronización de mensajes
  // históricos sobre TODOS los contactos. En cuentas con contactos @lid (el
  // nuevo formato de privacidad de WhatsApp que esta librería no resuelve
  // bien) esa tarea truena en loop y satura la pestaña de Chrome, causando
  // timeouts al enviar nuestras propias respuestas. La desactivamos: no la
  // necesitamos, este bot solo procesa mensajes en vivo.
  // Nota: usa una propiedad interna no documentada del puppet, puede dejar
  // de existir en futuras versiones de wechaty-puppet-whatsapp.
  try {
    const puppet = bot.puppet as unknown as { manager?: { stopSchedule?: () => void } };
    puppet.manager?.stopSchedule?.();
    console.log('Sincronización de historial en segundo plano desactivada.');
  } catch (error) {
    console.error('No se pudo desactivar la sincronización de historial:', error);
  }
});

// wechaty-puppet-whatsapp a veces falla al resolver contactos/mensajes con el
// formato @lid de WhatsApp; sin este listener, Wechaty emite 'error' y Node
// lo trata como excepción no capturada, matando el proceso. Lo logueamos y
// seguimos: es una falla puntual de un evento, no del bot completo.
bot.on('error', (error) => {
  console.error('Wechaty emitió un error (se ignora para no tumbar el bot):', error);
});

bot.on('message', async (message) => {
  if (message.self() || message.room()) return;

  const phone = phoneFromContactId(message.talker().id);
  if (!phone) return;
  const text = message.text()?.trim() ?? '';
  const isText = message.type() === bot.Message.Type.Text;
  if (isText && !text) return;

  // Entrega la respuesta por el mismo chat de WhatsApp.
  const say: Sender = async ({ body }) => {
    try {
      await message.say(body);
      return { sid: null, status: 'sent', errorCode: null };
    } catch (error) {
      console.error('No se pudo enviar la respuesta por Wechaty:', error);
      return { sid: null, status: 'failed', errorCode: 'wechaty' };
    }
  };

  try {
    await simulateInbound(
      channel,
      {
        from: phone,
        body: isText ? text : '',
        numMedia: isText ? 0 : 1,
        messageSid: `WECHATY-${message.id}`,
      },
      say,
    );
  } catch (error) {
    console.error('Error procesando mensaje:', error);
  }
});

// Red de seguridad: whatsapp-web.js/wechaty-puppet-whatsapp a veces generan
// promesas internas (envíos, acks) que se rechazan fuera de nuestro try/catch.
// Sin esto, Node trata esos rechazos como excepción no capturada y mata el
// proceso; aquí solo lo logueamos para que el bot siga corriendo.
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection (se ignora para no tumbar el bot):', error);
});

openDevChannel()
  .then((opened) => {
    channel = opened;
    console.log(`Canal de desarrollo del consultorio ${opened.clinic.name}`);
    return bot.start();
  })
  .then(() => console.log('Bot iniciado. Esperando QR o sesión guardada...'))
  .catch((error) => {
    console.error('Error al iniciar el bot:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
