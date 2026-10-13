// Normalización de números de WhatsApp (Twilio los manda como "whatsapp:+5215512345678").
// En la base se guardan en E.164 sin el prefijo. Sin 'server-only': la usan
// también la capa de datos y los formularios del panel.

const E164 = /^\+[1-9][0-9]{7,14}$/;

// Celular de México con el "1" viejo: +521 + 10 dígitos.
const MX_MOBILE_WITH_1 = /^\+521([0-9]{10})$/;

// "whatsapp:+52 1 55-1234-5678" -> "+5215512345678"; null si no es un E.164 válido.
// No reescribe el número: es el "From" tal cual lo manda WhatsApp, y a ese
// mismo número se responde. Para guardar o buscar pacientes usa normalizePhone().
export function normalizeWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw
    .trim()
    .replace(/^whatsapp:/i, '')
    .replace(/[\s\-().]/g, '');
  return E164.test(value) ? value : null;
}

// Unifica +52 y +521 (celulares de México) a +52 + 10 dígitos; cualquier otro
// número queda igual. Es la misma regla que la función SQL public.normalize_phone
// (webhook) y la que exige el check patients_phone_normalized.
export function normalizePhone(e164: string): string {
  const match = MX_MOBILE_WITH_1.exec(e164);
  return match ? `+52${match[1]}` : e164;
}

// "+5215512345678" -> "whatsapp:+5215512345678" (formato de la API de Twilio).
export function toWhatsAppAddress(e164: string): string {
  return `whatsapp:${e164}`;
}
