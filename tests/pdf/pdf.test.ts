import { beforeEach, describe, expect, it, vi } from 'vitest';

// Recibo de pago y presupuesto en PDF (Fase 6): texto de los documentos,
// render real con @react-pdf/renderer, guardado en Storage con la ruta por
// consultorio y URL firmada, y las server actions detrás del feature flag.

const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/observability', () => ({ reportError }));

const { budgetModel, documentToText, folioOf, receiptModel } = await import('@/lib/pdf/model');
const { renderDocumentPdf } = await import('@/lib/pdf/render');
const { createPaymentReceipt, createPlanBudget, documentPath, SIGNED_URL_SECONDS } = await import(
  '@/lib/pdf/documents'
);

const CLINIC = { name: 'Consultorio Sonrisas', timezone: 'America/Mexico_City' };
// 5 de octubre de 2026, 12:00 en Ciudad de México (UTC-6).
const NOW = new Date('2026-10-05T18:00:00Z');
const PAYMENT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const PLAN_ID = 'c0000000-0000-0000-0000-000000000001';

describe('modelo de los documentos (texto)', () => {
  it('recibo de pago', () => {
    const model = receiptModel({
      clinic: CLINIC,
      payment: { id: PAYMENT_ID, amount: '2000.00', method: 'card', paid_at: '2026-10-05T16:30:00Z', notes: ' Anticipo del plan ' },
      patient: { full_name: 'María González' },
      receiverName: 'Laura Martínez',
      planTitle: 'Endodoncia y corona 36',
      issuedAt: NOW,
    });
    expect(documentToText(model)).toMatchInlineSnapshot(`
      "Consultorio Sonrisas
      Recibo de pago
      Folio: A1B2C3D4
      Emitido: 5 de octubre de 2026 a las 12:00 p.m.

      Paciente: María González
      Fecha de pago: 5 de octubre de 2026 a las 10:30 a.m.
      Método: Tarjeta
      Plan de tratamiento: Endodoncia y corona 36
      Recibió: Laura Martínez

      Importe recibido: $2,000.00

      Anticipo del plan

      Documento generado por CitaBot Dental. No es un comprobante fiscal (CFDI)."
    `);
  });

  it('recibo sin plan, sin notas y de un paciente por identificar', () => {
    const text = documentToText(
      receiptModel({
        clinic: CLINIC,
        payment: { id: PAYMENT_ID, amount: 350, method: 'cash', paid_at: '2026-10-05T16:30:00Z', notes: null },
        patient: { full_name: null },
        receiverName: null,
        planTitle: null,
        issuedAt: NOW,
      }),
    );
    expect(text).toContain('Paciente: Por identificar');
    expect(text).toContain('Método: Efectivo');
    expect(text).not.toContain('Plan de tratamiento');
    expect(text).not.toContain('Recibió');
  });

  it('presupuesto: los cancelados no suman y se muestran pagado y saldo', () => {
    const model = budgetModel({
      clinic: CLINIC,
      plan: { id: PLAN_ID, title: 'Endodoncia y corona 36', status: 'active', created_at: '2026-09-20T17:00:00Z' },
      patient: { full_name: 'María González' },
      dentistName: 'Dra. Ana López',
      items: [
        { treatmentName: 'Endodoncia', tooth: '36', price: '4500.00', status: 'in_progress' },
        { treatmentName: 'Corona de zirconia', tooth: '36', price: 6000, status: 'pending' },
        { treatmentName: 'Limpieza', tooth: null, price: 800, status: 'cancelled' },
      ],
      paid: '2000.00',
      issuedAt: NOW,
    });
    expect(documentToText(model)).toMatchInlineSnapshot(`
      "Consultorio Sonrisas
      Presupuesto de tratamiento
      Folio: C0000000
      Emitido: 5 de octubre de 2026 a las 12:00 p.m.

      Paciente: María González
      Plan: Endodoncia y corona 36
      Estado: Activo
      Dentista: Dra. Ana López
      Fecha del plan: 20 de septiembre de 2026

      Tratamiento | Pieza | Estado | Precio
      Endodoncia | 36 | En curso | $4,500.00
      Corona de zirconia | 36 | Pendiente | $6,000.00
      Limpieza | — | Cancelado | $800.00

      Total: $10,500.00
      Pagado: $2,000.00
      Saldo: $8,500.00

      Los tratamientos cancelados no suman al total.

      Documento generado por CitaBot Dental. No es un comprobante fiscal (CFDI). Precios sujetos a cambio tras la valoración clínica."
    `);
  });

  it('folio: 8 caracteres del id en mayúsculas', () => {
    expect(folioOf(PAYMENT_ID)).toBe('A1B2C3D4');
  });
});

describe('render con @react-pdf/renderer', () => {
  it('genera un PDF válido para ambos documentos', async () => {
    const receipt = await renderDocumentPdf(
      receiptModel({
        clinic: CLINIC,
        payment: { id: PAYMENT_ID, amount: 2000, method: 'transfer', paid_at: '2026-10-05T16:30:00Z', notes: null },
        patient: { full_name: 'José Ñúñez' },
        receiverName: null,
        planTitle: null,
        issuedAt: NOW,
      }),
    );
    expect(receipt.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(receipt.length).toBeGreaterThan(1000);

    const budget = await renderDocumentPdf(
      budgetModel({
        clinic: CLINIC,
        plan: { id: PLAN_ID, title: 'Plan', status: 'draft', created_at: '2026-09-20T17:00:00Z' },
        patient: { full_name: 'María' },
        dentistName: null,
        items: Array.from({ length: 40 }, (_, i) => ({
          treatmentName: `Tratamiento ${i + 1}`,
          tooth: String(11 + i),
          price: 100,
          status: 'pending' as const,
        })),
        paid: null,
        issuedAt: NOW,
      }),
    );
    expect(budget.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // 40 renglones no caben en una hoja carta: el PDF tiene más de una página.
    expect(budget.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0).toBeGreaterThan(1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Guardado en Storage (cliente de Supabase simulado)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeSupabase(rows: Record<string, Row | null>, options: { uploadError?: unknown } = {}) {
  const uploads: { bucket: string; path: string; body: unknown; options: Row }[] = [];
  const signed: { bucket: string; path: string; seconds: number; options: Row }[] = [];
  const from = (table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
    };
    return query;
  };
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: unknown, opts: Row) => {
        uploads.push({ bucket, path, body, options: opts });
        return { data: options.uploadError ? null : { path }, error: options.uploadError ?? null };
      },
      createSignedUrl: async (path: string, seconds: number, opts: Row) => {
        signed.push({ bucket, path, seconds, options: opts });
        return { data: { signedUrl: `https://storage.test/sign/${bucket}/${path}?token=t` }, error: null };
      },
    }),
  };
  return { client: { from, storage } as never, uploads, signed };
}

const render = vi.fn(async () => Buffer.from('%PDF-fake'));

const PAYMENT_ROW = {
  id: PAYMENT_ID,
  clinic_id: 'f0000000-0000-0000-0000-00000000000a',
  amount: '2000.00',
  method: 'card',
  paid_at: '2026-10-05T16:30:00Z',
  notes: null,
  receiver: { full_name: 'Laura Martínez' },
  patient: { full_name: 'María González' },
  plan: null,
  clinic: CLINIC,
};

const PLAN_ROW = {
  id: PLAN_ID,
  clinic_id: 'f0000000-0000-0000-0000-00000000000a',
  title: 'Endodoncia',
  status: 'active',
  created_at: '2026-09-20T17:00:00Z',
  patient: { full_name: 'María González' },
  dentist: { full_name: 'Dra. Ana López' },
  clinic: CLINIC,
  items: [{ tooth: '36', price: '4500.00', status: 'pending', sort_order: 1, treatment: { name: 'Endodoncia' } }],
};

beforeEach(() => {
  render.mockClear();
  reportError.mockClear();
});

describe('createPaymentReceipt / createPlanBudget', () => {
  it('guarda el recibo en <clinic_id>/payments/<id>.pdf del bucket receipts y firma 60 s', async () => {
    const fake = fakeSupabase({ payments: PAYMENT_ROW });
    const result = await createPaymentReceipt(fake.client, PAYMENT_ID, { now: NOW, render });
    expect(result).toEqual({
      ok: true,
      path: `f0000000-0000-0000-0000-00000000000a/payments/${PAYMENT_ID}.pdf`,
      url: `https://storage.test/sign/receipts/f0000000-0000-0000-0000-00000000000a/payments/${PAYMENT_ID}.pdf?token=t`,
    });
    expect(fake.uploads[0]).toMatchObject({
      bucket: 'receipts',
      options: { contentType: 'application/pdf', upsert: true },
    });
    expect(fake.signed[0]).toMatchObject({ seconds: SIGNED_URL_SECONDS, options: { download: 'recibo-A1B2C3D4.pdf' } });
    expect(SIGNED_URL_SECONDS).toBe(60);
  });

  it('pago inexistente (o de otro consultorio: la RLS no lo devuelve): no genera nada', async () => {
    const fake = fakeSupabase({ payments: null });
    expect(await createPaymentReceipt(fake.client, PAYMENT_ID, { render })).toEqual({ ok: false, error: 'El pago no existe' });
    expect(render).not.toHaveBeenCalled();
    expect(fake.uploads).toEqual([]);
  });

  it('si Storage rechaza la subida (p. ej. RLS) no firma URL', async () => {
    const fake = fakeSupabase({ payments: PAYMENT_ROW }, { uploadError: { message: 'new row violates row-level security policy' } });
    expect(await createPaymentReceipt(fake.client, PAYMENT_ID, { render })).toEqual({
      ok: false,
      error: 'No se pudo guardar el documento',
    });
    expect(fake.signed).toEqual([]);
  });

  it('presupuesto con el pagado de patient_balances', async () => {
    const fake = fakeSupabase({ treatment_plans: PLAN_ROW, patient_balances: { paid: '1000.00' } });
    const result = await createPlanBudget(fake.client, PLAN_ID, { now: NOW, render });
    expect(result.ok && result.path).toBe(documentPath('f0000000-0000-0000-0000-00000000000a', 'plans', PLAN_ID));
    const model = (render.mock.calls[0] as unknown as [Parameters<typeof documentToText>[0]])[0];
    const text = documentToText(model);
    expect(text).toContain('Endodoncia | 36 | Pendiente');
    expect(text).toMatch(/Saldo: \$3,500\.00/);
    expect(fake.signed[0].options).toEqual({ download: 'presupuesto-C0000000.pdf' });
  });
});

// ---------------------------------------------------------------------------
// Server actions detrás del flag
// ---------------------------------------------------------------------------

describe('server actions', () => {
  it('con el flag apagado se rechazan sin leer datos ni generar PDF', async () => {
    vi.resetModules();
    const reads: string[] = [];
    const flagValue = { on: false };
    const client = {
      rpc: vi.fn(async (fn: string) => {
        expect(fn).toBe('my_feature_enabled');
        return { data: flagValue.on, error: null };
      }),
      from: (table: string) => {
        reads.push(table);
        throw new Error('no debería leer');
      },
    };
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => client }));
    vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }));
    const createReceipt = vi.fn(async () => ({ ok: true, url: 'https://signed', path: 'p' }));
    const createBudget = vi.fn(async () => ({ ok: true, url: 'https://signed-plan', path: 'p' }));
    vi.doMock('@/lib/pdf/documents', () => ({ createPaymentReceipt: createReceipt, createPlanBudget: createBudget }));

    const { getPaymentReceiptUrl } = await import('@/lib/db/payments');
    const { getPlanBudgetUrl } = await import('@/lib/db/plans');
    const { PDF_DISABLED_ERROR } = await import('@/lib/db/errors');

    expect(await getPaymentReceiptUrl(PAYMENT_ID)).toEqual({ ok: false, error: PDF_DISABLED_ERROR });
    expect(await getPlanBudgetUrl(PLAN_ID)).toEqual({ ok: false, error: PDF_DISABLED_ERROR });
    expect(createReceipt).not.toHaveBeenCalled();
    expect(reads).toEqual([]);

    flagValue.on = true;
    expect(await getPaymentReceiptUrl(PAYMENT_ID)).toEqual({ ok: true, data: { url: 'https://signed' } });
    expect(await getPlanBudgetUrl(PLAN_ID)).toEqual({ ok: true, data: { url: 'https://signed-plan' } });
    expect(client.rpc).toHaveBeenCalledWith('my_feature_enabled', { p_flag: 'pdf_documents' });
  });
});
