import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ReadOnlyProvider, READ_ONLY_HINT } from '@/components/layout/read-only';
import { PatientForm } from '@/components/patients/patient-form';
import { createPatient, updatePatient } from '@/lib/db/patients';
import type { Patient } from '@/lib/db/types';
import { toast } from 'sonner';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/db/patients', () => ({ createPatient: vi.fn(), updatePatient: vi.fn() }));

const PATIENT_ID = '9a000000-0000-4000-8000-000000000001';

const patient: Patient = {
  id: PATIENT_ID,
  clinic_id: 'f0000000-0000-0000-0000-00000000000a',
  full_name: 'María Pérez',
  phone: '+525512345678',
  email: 'maria@example.com',
  birthdate: '1990-05-01',
  allergies: 'Penicilina',
  notes_admin: null,
  status: 'active',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

describe('PatientForm', () => {
  it('exige el nombre y no llama al servidor', async () => {
    render(<PatientForm mode="create" />);

    await userEvent.click(screen.getByRole('button', { name: 'Registrar paciente' }));

    expect(await screen.findByText('El nombre es obligatorio')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre completo *')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Nombre completo *')).toHaveAccessibleDescription(
      'El nombre es obligatorio',
    );
    expect(createPatient).not.toHaveBeenCalled();
  });

  it('valida teléfono y correo', async () => {
    render(<PatientForm mode="create" />);

    await userEvent.type(screen.getByLabelText('Nombre completo *'), 'Juan');
    await userEvent.type(screen.getByLabelText('Teléfono (WhatsApp)'), '5512345678');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'no-es-correo');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar paciente' }));

    expect(
      await screen.findByText('Teléfono en formato internacional, p. ej. +525512345678'),
    ).toBeInTheDocument();
    expect(screen.getByText('Correo inválido')).toBeInTheDocument();
    expect(createPatient).not.toHaveBeenCalled();
  });

  it('registra al paciente con el teléfono sin espacios y abre su ficha', async () => {
    vi.mocked(createPatient).mockResolvedValue({ ok: true, data: { id: PATIENT_ID } });
    render(<PatientForm mode="create" />);

    await userEvent.type(screen.getByLabelText('Nombre completo *'), 'Juan López');
    await userEvent.type(screen.getByLabelText('Teléfono (WhatsApp)'), '+52 55 1234-5678');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar paciente' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/pacientes/${PATIENT_ID}`));
    expect(createPatient).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'Juan López', phone: '+525512345678' }),
    );
    expect(toast.success).toHaveBeenCalledWith('Paciente registrado');
  });

  it('muestra los errores que devuelve el servidor', async () => {
    vi.mocked(createPatient).mockResolvedValue({
      ok: false,
      error: 'Ya existe un paciente con ese teléfono',
      fieldErrors: { phone: ['Ya existe un paciente con ese teléfono'] },
    });
    render(<PatientForm mode="create" />);

    await userEvent.type(screen.getByLabelText('Nombre completo *'), 'Juan');
    await userEvent.type(screen.getByLabelText('Teléfono (WhatsApp)'), '+525512345678');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar paciente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe un paciente con ese teléfono',
    );
    expect(toast.error).toHaveBeenCalledWith('Ya existe un paciente con ese teléfono');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('en edición parte de los datos actuales y guarda con updatePatient', async () => {
    vi.mocked(updatePatient).mockResolvedValue({ ok: true, data: { id: PATIENT_ID } });
    render(<PatientForm mode="edit" patient={patient} onCancelHref="/pacientes" />);

    const name = screen.getByLabelText('Nombre completo *');
    expect(name).toHaveValue('María Pérez');
    expect(screen.getByLabelText('Alergias')).toHaveValue('Penicilina');

    await userEvent.clear(name);
    await userEvent.type(name, 'María Pérez Ruiz');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(updatePatient).toHaveBeenCalledWith(
      PATIENT_ID,
      expect.objectContaining({ full_name: 'María Pérez Ruiz', allergies: 'Penicilina' }),
    );
    expect(createPatient).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(router.push).toHaveBeenCalledWith('/pacientes');
  });

  it('en solo lectura no deja guardar', () => {
    render(
      <ReadOnlyProvider readOnly>
        <PatientForm mode="edit" patient={patient} />
      </ReadOnlyProvider>,
    );

    const save = screen.getByRole('button', { name: 'Guardar cambios' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('title', READ_ONLY_HINT);
  });
});
