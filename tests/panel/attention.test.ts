import { describe, expect, it } from 'vitest';

import { detectNewEscalation, type ConversationChange } from '@/lib/attention';

const ID = '11111111-1111-1111-1111-111111111111';
const AT = '2026-09-23T15:00:00.000Z';

function update(
  row: Record<string, unknown>,
  commit = '2026-09-23T15:00:01.000Z',
  old: Record<string, unknown> = { id: ID },
): ConversationChange {
  return { eventType: 'UPDATE', commit_timestamp: commit, new: { id: ID, ...row }, old };
}

describe('detectNewEscalation', () => {
  it('detecta el UPDATE del escalamiento (old solo trae la llave primaria)', () => {
    const notified = new Map<string, string>();
    expect(
      detectNewEscalation(update({ needs_attention: true, escalated_at: AT }), notified),
    ).toEqual({ id: ID, escalatedAt: AT });
  });

  it('no repite el aviso con otros UPDATE de la misma conversación', () => {
    const notified = new Map<string, string>();
    const change = update({ needs_attention: true, escalated_at: AT });
    expect(detectNewEscalation(change, notified)).not.toBeNull();
    expect(detectNewEscalation(update({ needs_attention: true, escalated_at: AT }), notified)).toBeNull();
  });

  it('ignora UPDATE posteriores de una conversación que ya estaba escalada', () => {
    const notified = new Map<string, string>();
    const later = update({ needs_attention: true, escalated_at: AT }, '2026-09-23T15:10:00.000Z');
    expect(detectNewEscalation(later, notified)).toBeNull();
  });

  it('ignora conversaciones sin la marca', () => {
    const notified = new Map<string, string>();
    expect(
      detectNewEscalation(update({ needs_attention: false, escalated_at: AT }), notified),
    ).toBeNull();
  });

  it('con old completo usa la regla exacta false → true', () => {
    const notified = new Map<string, string>();
    const later = '2026-09-23T16:00:00.000Z';
    expect(
      detectNewEscalation(
        update({ needs_attention: true, escalated_at: AT }, later, { id: ID, needs_attention: true }),
        notified,
      ),
    ).toBeNull();
    expect(
      detectNewEscalation(
        update({ needs_attention: true, escalated_at: AT }, later, { id: ID, needs_attention: false }),
        notified,
      ),
    ).toEqual({ id: ID, escalatedAt: AT });
  });

  it('detecta un nuevo escalamiento después de resolver', () => {
    const notified = new Map<string, string>([[ID, AT]]);
    const again = '2026-09-24T10:00:00.000Z';
    expect(
      detectNewEscalation(
        update({ needs_attention: true, escalated_at: again }, '2026-09-24T10:00:00.500Z'),
        notified,
      ),
    ).toEqual({ id: ID, escalatedAt: again });
  });
});
