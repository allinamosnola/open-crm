import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReadOnlyProvider, READ_ONLY_HINT } from '@/components/layout/read-only';
import { DocumentDownloadButton } from '@/components/patients/document-download-button';
import { PaymentsTable } from '@/components/patients/payments-table';
import { PlanCard } from '@/components/patients/plan-card';
import { getPaymentReceiptUrl } from '@/lib/db/payments';
import { getPlanBudgetUrl } from '@/lib/db/plans';
import type { PaymentWithReceiver, PlanWithItems } from '@/lib/db/types';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/db/payments', () => ({ getPaymentReceiptUrl: vi.fn() }));
vi.mock('@/lib/db/plans', () => ({ getPlanBudgetUrl: vi.fn() }));

const CLINIC_ID = 'f0000000-0000-0000-0000-00000000000a';
const PATIENT_ID = '9a000000-0000-4000-8000-000000000001';
const PLAN_ID = 'b0000000-0000-4000-8000-000000000001';
const PDF_DISABLED = 'La descarga de documentos en PDF no está disponible para tu cuenta';
const SIGNED_URL = 'http://127.0.0.1:54321/storage/v1/object/sign/receipts/x.pdf?token=t&download=recibo.pdf';

const payments: PaymentWithReceiver[] = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    clinic_id: CLINIC_ID,
    patient_id: PATIENT_ID,
    plan_id: PLAN_ID,
    amount: 1500,
    method: 'card',
    notes: null,
    paid_at: '2026-10-10T16:00:00Z',
    received_by: 's1',
    receiver: { id: 's1', full_name: 'Laura Martínez' },
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    clinic_id: CLINIC_ID,
    patient_id: PATIENT_ID,
    plan_id: null,
    amount: 300,
    method: 'cash',
    notes: 'Consulta',
    paid_at: '2026-10-11T16:00:00Z',
    received_by: null,
    receiver: null,
  },
];

const plan: PlanWithItems = {
  id: PLAN_ID,
  clinic_id: CLINIC_ID,
  patient_id: PATIENT_ID,
  dentist_id: 'd1',
  status: 'active',
  title: 'Ortodoncia',
  created_at: '2026-10-01T16:00:00Z',
  dentist: { id: 'd1', full_name: 'Dra. Ruiz' },
  items: [
    {
      id: 'i1',
      clinic_id: CLINIC_ID,
      plan_id: PLAN_ID,
      price: 12000,
      sort_order: 0,
      status: 'pending',
      tooth: null,
      treatment_id: 't1',
      treatment: { id: 't1', name: 'Brackets' },
    },
  ],
};

const planTitle = new Map([[PLAN_ID, 'Ortodoncia']]);
const receiptButtons = () => screen.queryAllByRole('button', { name: /Descargar recibo/ });
const budgetButton = () => screen.queryByRole('button', { name: 'Descargar presupuesto de Ortodoncia' });

let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // jsdom no navega: se intercepta el clic del enlace de descarga.
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  click.mockRestore();
});

describe('Botones de PDF con el feature flag apagado', () => {
  it('la tabla de pagos no muestra «Recibo» ni la columna de documento', () => {
    render(<PaymentsTable payments={payments} planTitle={planTitle} pdfEnabled={false} />);

    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(receiptButtons()).toHaveLength(0);
    expect(screen.queryByText('Documento')).not.toBeInTheDocument();
  });

  it('la tarjeta del plan no muestra «Presupuesto»', () => {
    render(<PlanCard plan={plan} pdfEnabled={false} />);

    expect(screen.getByText('Ortodoncia')).toBeInTheDocument();
    expect(budgetButton()).not.toBeInTheDocument();
  });

  it('el botón suelto no se renderiza', () => {
    const { container } = render(
      <DocumentDownloadButton kind="receipt" id={payments[0].id} enabled={false} label="Descargar recibo" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Recibo de pago', () => {
  it('con el flag encendido hay un botón «Recibo» por pago', () => {
    render(<PaymentsTable payments={payments} planTitle={planTitle} pdfEnabled />);

    const buttons = receiptButtons();
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('Recibo');
    expect(buttons[0]).toBeEnabled();
  });

  it('pide la URL firmada del pago y la abre', async () => {
    vi.mocked(getPaymentReceiptUrl).mockResolvedValue({ ok: true, data: { url: SIGNED_URL } });
    render(<PaymentsTable payments={payments} planTitle={planTitle} pdfEnabled />);

    await userEvent.click(receiptButtons()[1]);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Recibo generado'));
    expect(getPaymentReceiptUrl).toHaveBeenCalledWith(payments[1].id);
    expect(click).toHaveBeenCalledTimes(1);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.href).toBe(SIGNED_URL);
    // El enlace temporal no queda en el documento.
    expect(link.isConnected).toBe(false);
  });

  it('muestra «Generando…» mientras espera y no repite la petición', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof getPaymentReceiptUrl>>) => void;
    vi.mocked(getPaymentReceiptUrl).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<PaymentsTable payments={[payments[0]]} planTitle={planTitle} pdfEnabled />);

    const button = receiptButtons()[0];
    await userEvent.click(button);

    await waitFor(() => expect(button).toHaveTextContent('Generando…'));
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(getPaymentReceiptUrl).toHaveBeenCalledTimes(1);

    resolve({ ok: true, data: { url: SIGNED_URL } });
    await waitFor(() => expect(button).toHaveTextContent('Recibo'));
    expect(button).toBeEnabled();
  });

  it('si el servidor responde con el flag apagado avisa y no abre nada', async () => {
    vi.mocked(getPaymentReceiptUrl).mockResolvedValue({ ok: false, error: PDF_DISABLED });
    render(<PaymentsTable payments={[payments[0]]} planTitle={planTitle} pdfEnabled />);

    await userEvent.click(receiptButtons()[0]);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(PDF_DISABLED));
    expect(click).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('si la generación lanza, avisa con un error genérico', async () => {
    vi.mocked(getPaymentReceiptUrl).mockRejectedValue(new Error('boom'));
    render(<PaymentsTable payments={[payments[0]]} planTitle={planTitle} pdfEnabled />);

    await userEvent.click(receiptButtons()[0]);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('No se pudo generar el documento. Intenta de nuevo.'),
    );
    expect(click).not.toHaveBeenCalled();
    expect(receiptButtons()[0]).toBeEnabled();
  });

  it('en solo lectura está deshabilitado y no llama a la acción', async () => {
    render(
      <ReadOnlyProvider readOnly>
        <PaymentsTable payments={[payments[0]]} planTitle={planTitle} pdfEnabled />
      </ReadOnlyProvider>,
    );

    const button = receiptButtons()[0];
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', READ_ONLY_HINT);
    await userEvent.click(button);
    expect(getPaymentReceiptUrl).not.toHaveBeenCalled();
  });
});

describe('Presupuesto del plan', () => {
  it('pide la URL firmada del plan y la abre', async () => {
    vi.mocked(getPlanBudgetUrl).mockResolvedValue({ ok: true, data: { url: SIGNED_URL } });
    render(<PlanCard plan={plan} pdfEnabled />);

    const button = budgetButton()!;
    expect(button).toHaveTextContent('Presupuesto');
    await userEvent.click(button);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Presupuesto generado'));
    expect(getPlanBudgetUrl).toHaveBeenCalledWith(PLAN_ID);
    expect(getPaymentReceiptUrl).not.toHaveBeenCalled();
    expect((click.mock.contexts[0] as HTMLAnchorElement).href).toBe(SIGNED_URL);
  });

  it('si falla la generación muestra el error del servidor', async () => {
    vi.mocked(getPlanBudgetUrl).mockResolvedValue({ ok: false, error: 'No se pudo generar el PDF' });
    render(<PlanCard plan={plan} pdfEnabled />);

    await userEvent.click(budgetButton()!);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No se pudo generar el PDF'));
    expect(click).not.toHaveBeenCalled();
  });

  it('en solo lectura está deshabilitado', () => {
    render(
      <ReadOnlyProvider readOnly>
        <PlanCard plan={plan} pdfEnabled />
      </ReadOnlyProvider>,
    );
    expect(budgetButton()).toBeDisabled();
  });
});
