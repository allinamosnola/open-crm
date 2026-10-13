import { beforeEach, describe, expect, it, vi } from 'vitest';

// Helper de feature flags (src/lib/flags.ts). La resolución (cuenta > global >
// apagado) vive en SQL y la prueban los pgTAP (supabase/tests/feature_flags);
// aquí se prueba el contrato del helper con un rpc simulado.

const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/observability', () => ({ reportError }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('el test debe inyectar el cliente');
  },
}));

const { FLAGS, isEnabled, isEnabledForSession } = await import('@/lib/flags');

type RpcResult = { data: unknown; error: { code: string; message: string } | null };

function fakeClient(result: RpcResult) {
  const rpc = vi.fn(async () => result);
  return { client: { rpc } as never, rpc };
}

beforeEach(() => reportError.mockClear());

describe('isEnabled', () => {
  it('consulta feature_enabled con el flag y la cuenta', async () => {
    const { client, rpc } = fakeClient({ data: true, error: null });
    expect(await isEnabled(FLAGS.pdfDocuments, 'acc-1', { supabase: client })).toBe(true);
    expect(rpc).toHaveBeenCalledWith('feature_enabled', { p_flag: 'pdf_documents', p_account_id: 'acc-1' });
  });

  it('apagado si la base dice false o null', async () => {
    expect(await isEnabled(FLAGS.pdfDocuments, 'acc-1', { supabase: fakeClient({ data: false, error: null }).client })).toBe(false);
    expect(await isEnabled(FLAGS.pdfDocuments, 'acc-1', { supabase: fakeClient({ data: null, error: null }).client })).toBe(false);
  });

  it('sin cuenta: apagado sin consultar', async () => {
    const { client, rpc } = fakeClient({ data: true, error: null });
    expect(await isEnabled(FLAGS.pdfDocuments, null, { supabase: client })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('error de la base: falla cerrado y lo reporta', async () => {
    const { client } = fakeClient({ data: null, error: { code: '57014', message: 'timeout' } });
    expect(await isEnabled(FLAGS.pdfDocuments, 'acc-1', { supabase: client })).toBe(false);
    expect(reportError).toHaveBeenCalledWith(expect.any(String), expect.anything(), {
      where: 'flags.isEnabled',
      extra: { flag: 'pdf_documents' },
    });
  });
});

describe('isEnabledForSession', () => {
  it('usa my_feature_enabled (cuenta del consultorio activo)', async () => {
    const { client, rpc } = fakeClient({ data: true, error: null });
    expect(await isEnabledForSession(FLAGS.pdfDocuments, client)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('my_feature_enabled', { p_flag: 'pdf_documents' });
  });

  it('error: apagado', async () => {
    const { client } = fakeClient({ data: null, error: { code: '42501', message: 'denied' } });
    expect(await isEnabledForSession(FLAGS.pdfDocuments, client)).toBe(false);
  });
});
