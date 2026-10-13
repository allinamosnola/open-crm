import { describe, expect, it } from 'vitest';

import { normalizePhone, normalizeWhatsAppNumber, toWhatsAppAddress } from '@/lib/whatsapp/phone';
import { patientSchema } from '@/lib/db/schemas';
import { mapTwilioStatus } from '@/lib/whatsapp/twilio';
import { describeMessageError, OUTSIDE_WINDOW_MESSAGE } from '@/lib/whatsapp/errors';

describe('normalizeWhatsAppNumber', () => {
  it('quita el prefijo whatsapp: y separadores', () => {
    expect(normalizeWhatsAppNumber('whatsapp:+5215512345678')).toBe('+5215512345678');
    expect(normalizeWhatsAppNumber(' WhatsApp:+52 1 55-1234-5678 ')).toBe('+5215512345678');
    expect(normalizeWhatsAppNumber('+14155238886')).toBe('+14155238886');
  });

  it('rechaza lo que no es E.164', () => {
    expect(normalizeWhatsAppNumber('5512345678')).toBeNull();
    expect(normalizeWhatsAppNumber('whatsapp:')).toBeNull();
    expect(normalizeWhatsAppNumber('')).toBeNull();
    expect(normalizeWhatsAppNumber(undefined)).toBeNull();
  });

  it('arma la dirección de Twilio', () => {
    expect(toWhatsAppAddress('+14155238886')).toBe('whatsapp:+14155238886');
  });
});

describe('normalizePhone (+52 / +521)', () => {
  it('unifica celulares de México a +52 + 10 dígitos', () => {
    expect(normalizePhone('+5215512345678')).toBe('+525512345678');
    expect(normalizePhone('+525512345678')).toBe('+525512345678');
  });

  it('no toca otros números', () => {
    expect(normalizePhone('+14155238886')).toBe('+14155238886');
    // +521 con otra longitud no es el prefijo de celular viejo.
    expect(normalizePhone('+52155123456')).toBe('+52155123456');
    expect(normalizePhone('+34612345678')).toBe('+34612345678');
  });

  it('createPatient/updatePatient guardan el teléfono normalizado (patientSchema)', () => {
    const parsed = patientSchema.parse({ full_name: 'Ana', phone: '+5215512345678' });
    expect(parsed.phone).toBe('+525512345678');
    expect(patientSchema.parse({ full_name: 'Ana', phone: '' }).phone).toBeNull();
  });
});

describe('mapTwilioStatus', () => {
  it('traduce los estados de Twilio a los que guardamos', () => {
    expect(mapTwilioStatus('accepted')).toBe('queued');
    expect(mapTwilioStatus('sending')).toBe('queued');
    expect(mapTwilioStatus('sent')).toBe('sent');
    expect(mapTwilioStatus('delivered')).toBe('delivered');
    expect(mapTwilioStatus('read')).toBe('read');
    expect(mapTwilioStatus('undelivered')).toBe('failed');
    expect(mapTwilioStatus('failed')).toBe('failed');
    expect(mapTwilioStatus('receiving')).toBeNull();
    expect(mapTwilioStatus(undefined)).toBeNull();
  });
});

describe('describeMessageError', () => {
  it('explica el error 63016 (fuera de la ventana de 24 h)', () => {
    expect(describeMessageError('63016')).toBe(OUTSIDE_WINDOW_MESSAGE);
    expect(describeMessageError('30008')).toContain('30008');
    expect(describeMessageError(null)).toBeNull();
  });
});
