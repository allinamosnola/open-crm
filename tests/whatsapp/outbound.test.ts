import { describe, expect, it, vi } from 'vitest';

import type { AdminClient } from '@/lib/supabase/admin';

// Reintento manual (redeliverFailedMessage): solo reenvía si el mensaje sigue
// 'failed' y registra el nuevo resultado. Cliente de Supabase mínimo en memoria.

const { redeliverFailedMessage } = await import('@/lib/whatsapp/outbound');

type Row = { id: string; direction: string; status: string; error_code: string | null; twilio_sid: string | null };

function fakeAdmin(row: Row) {
  const updates: Record<string, unknown>[] = [];
  const from = () => {
    let payload: Record<string, unknown> = {};
    const filters: [string, unknown][] = [];
    const query = {
      update(p: Record<string, unknown>) {
        payload = p;
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return query;
      },
      select() {
        return query;
      },
      maybeSingle() {
        return query;
      },
      then(resolve: (r: { data: unknown; error: null }) => unknown) {
        const match = filters.every(([c, v]) => (row as Record<string, unknown>)[c] === v);
        if (match) {
          Object.assign(row, payload);
          updates.push(payload);
        }
        return Promise.resolve({ data: match ? { id: row.id } : null, error: null }).then(resolve);
      },
    };
    return query;
  };
  return { client: { from } as unknown as AdminClient, updates };
}

const PARAMS = { messageId: 'm1', from: '+14155238886', to: '+5215588887777', body: 'Hola' };

describe('redeliverFailedMessage', () => {
  it('pasa el mensaje fallido a queued, lo reenvía y registra el nuevo sid', async () => {
    const row = { id: 'm1', direction: 'out', status: 'failed', error_code: '20503', twilio_sid: null };
    const { client, updates } = fakeAdmin(row);
    const send = vi.fn(async () => ({ sid: 'SMnew', status: 'queued' as const, errorCode: null }));
    expect(await redeliverFailedMessage(client, PARAMS, send)).toEqual({ sid: 'SMnew', status: 'queued', errorCode: null });
    expect(updates[0]).toEqual({ status: 'queued', error_code: null, twilio_sid: null });
    expect(row).toMatchObject({ status: 'queued', twilio_sid: 'SMnew', error_code: null });
    expect(send).toHaveBeenCalledWith({ from: PARAMS.from, to: PARAMS.to, body: 'Hola' });
  });

  it('si ya no está fallido (otro reintento lo tomó) no envía nada', async () => {
    const row = { id: 'm1', direction: 'out', status: 'queued', error_code: null, twilio_sid: null };
    const { client } = fakeAdmin(row);
    const send = vi.fn();
    expect(await redeliverFailedMessage(client, PARAMS, send)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
