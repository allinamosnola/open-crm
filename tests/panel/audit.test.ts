import { beforeEach, describe, expect, it, vi } from 'vitest';

// Lectura de la bitácora (src/lib/db/audit.ts). Quién la puede leer lo decide
// la RLS (pgTAP en supabase/tests/audit_log.test.sql); aquí, filtros y límite.

const calls = vi.hoisted(() => ({ eq: [] as [string, unknown][], limit: [] as number[], order: [] as string[] }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      expect(table).toBe('audit_log');
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          calls.eq.push([column, value]);
          return query;
        },
        order: (column: string) => {
          calls.order.push(column);
          return query;
        },
        limit: async (n: number) => {
          calls.limit.push(n);
          return { data: [{ id: 1, table_name: 'patients', action: 'update', changed_fields: ['phone'] }], error: null };
        },
      };
      return query;
    },
  }),
}));
vi.mock('@/lib/observability', () => ({ reportError: vi.fn() }));

const { listAuditLog } = await import('@/lib/db/audit');

beforeEach(() => {
  calls.eq = [];
  calls.limit = [];
  calls.order = [];
});

describe('listAuditLog', () => {
  it('por defecto: los 100 más recientes, sin filtros', async () => {
    const rows = await listAuditLog();
    expect(rows).toHaveLength(1);
    expect(calls.eq).toEqual([]);
    expect(calls.order).toEqual(['created_at', 'id']);
    expect(calls.limit).toEqual([100]);
  });

  it('historial de un registro, con el límite acotado a 500', async () => {
    await listAuditLog({ tableName: 'patients', recordId: 'p-1', limit: 10_000 });
    expect(calls.eq).toEqual([
      ['table_name', 'patients'],
      ['record_id', 'p-1'],
    ]);
    expect(calls.limit).toEqual([500]);
  });
});
