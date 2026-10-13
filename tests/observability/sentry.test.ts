import type { ErrorEvent } from '@sentry/nextjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureException, flush: vi.fn() }));

const { reportError } = await import('@/lib/observability');
const { scrubEvent } = await import('@/lib/sentry/options');

describe('reportError', () => {
  beforeEach(() => {
    captureException.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('envía el error con tags de contexto', () => {
    const error = new Error('boom');
    reportError('falló', error, { where: 'test.where', clinicId: 'c1', extra: { tool: 'x' } });
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { where: 'test.where', clinic_id: 'c1' },
      extra: { message: 'falló', tool: 'x' },
    });
  });

  it('agrega tags extra (attempt de withRetry) sin pisar where', () => {
    reportError('falló', new Error('x'), { where: 'twilio.send', tags: { attempt: '2', where: 'otro' } });
    expect(captureException.mock.calls[0][1].tags).toEqual({ attempt: '2', where: 'twilio.send' });
  });

  it('envuelve los errores planos de Supabase y conserva solo el código', () => {
    reportError('db', { code: '23505', message: 'Key (phone)=(+5215512345678) already exists' }, { where: 'w' });
    const [captured, options] = captureException.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toBe('db');
    expect(options.extra).toEqual({ message: 'db', code: '23505' });
  });
});

describe('scrubEvent', () => {
  it('elimina body, headers, cookies, usuario y datos personales del texto', () => {
    const event = {
      request: {
        url: 'https://consultorio.maoli.ws/api/whatsapp?From=whatsapp:+5215512345678',
        data: { Body: 'me duele la muela' },
        headers: { cookie: 'sb=1' },
        cookies: { sb: '1' },
        query_string: 'From=1',
      },
      user: { id: 'u1' },
      exception: { values: [{ value: 'Twilio: número +52 155 1234 5678 y ana@correo.com inválidos' }] },
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);
    expect(scrubbed.request).toEqual({ url: 'https://consultorio.maoli.ws/api/whatsapp' });
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.exception?.values?.[0].value).toBe('Twilio: número [tel] y [email] inválidos');
  });
});
