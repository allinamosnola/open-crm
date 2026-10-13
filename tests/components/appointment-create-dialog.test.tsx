import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AppointmentCreateDialog,
  type NewAppointmentSlot,
} from '@/components/calendar/appointment-create-dialog';
import { createAppointment } from '@/lib/db/appointments';
import { listPatients } from '@/lib/db/patients';
import type { Patient } from '@/lib/db/types';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/db/appointments', () => ({ createAppointment: vi.fn() }));
vi.mock('@/lib/db/patients', () => ({ listPatients: vi.fn(), createPatient: vi.fn() }));

const DENTIST_A = { id: 'd0000000-0000-4000-8000-00000000000a', full_name: 'Dra. Ana López' };
const DENTIST_B = { id: 'd0000000-0000-4000-8000-00000000000b', full_name: 'Dr. Luis Mora' };

const maria: Patient = {
  id: '9a000000-0000-4000-8000-000000000001',
  clinic_id: 'f0000000-0000-0000-0000-00000000000a',
  full_name: 'María Pérez',
  phone: '+525512345678',
  email: null,
  birthdate: null,
  allergies: null,
  notes_admin: null,
  status: 'active',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

// Miércoles 14 de octubre de 2026, 10:00–10:30 (hora local del navegador).
const start = new Date(2026, 9, 14, 10, 0);
const end = new Date(2026, 9, 14, 10, 30);

function renderDialog(slot: Partial<NewAppointmentSlot> = {}) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <AppointmentCreateDialog
      slot={{ start, end, dentistId: DENTIST_A.id, ...slot }}
      dentists={[DENTIST_A, DENTIST_B]}
      onClose={onClose}
      onCreated={onCreated}
    />,
  );
  return { onClose, onCreated };
}

async function pickPatient() {
  await userEvent.click(screen.getByRole('combobox', { name: 'Paciente *' }));
  await userEvent.click(await screen.findByRole('option', { name: /María Pérez/ }));
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Agendar cita' }));

describe('AppointmentCreateDialog', () => {
  beforeEach(() => {
    vi.mocked(listPatients).mockResolvedValue([maria]);
  });

  it('pide paciente y dentista antes de llamar al servidor', async () => {
    renderDialog({ dentistId: null });

    await submit();

    expect(await screen.findByText('Elige un paciente')).toBeInTheDocument();
    expect(screen.getByText('Elige un dentista')).toBeInTheDocument();
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it('agenda la cita con el paciente, el dentista y el horario del hueco', async () => {
    vi.mocked(createAppointment).mockResolvedValue({ ok: true, data: { id: 'appt-1' } });
    const { onCreated } = renderDialog();

    expect(screen.getByRole('dialog', { name: 'Nueva cita' })).toBeInTheDocument();
    await pickPatient();
    expect(screen.getByRole('combobox', { name: 'Paciente *' })).toHaveTextContent('María Pérez');
    await userEvent.type(screen.getByLabelText('Motivo'), 'Limpieza');
    await submit();

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(createAppointment).toHaveBeenCalledWith({
      patient_id: maria.id,
      dentist_id: DENTIST_A.id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      reason: 'Limpieza',
    });
    expect(toast.success).toHaveBeenCalledWith('Cita agendada');
  });

  it('permite elegir otro dentista', async () => {
    vi.mocked(createAppointment).mockResolvedValue({ ok: true, data: { id: 'appt-1' } });
    renderDialog({ dentistId: null });

    await pickPatient();
    await userEvent.click(screen.getByRole('combobox', { name: 'Dentista *' }));
    await userEvent.click(await screen.findByRole('option', { name: DENTIST_B.full_name }));
    await submit();

    await waitFor(() => expect(createAppointment).toHaveBeenCalled());
    expect(vi.mocked(createAppointment).mock.calls[0][0].dentist_id).toBe(DENTIST_B.id);
  });

  it('al mover el inicio conserva la duración y avisa si el fin queda antes', async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText('Inicio *'), { target: { value: '2026-10-15' } });
    expect(screen.getByLabelText('Fin *')).toHaveValue('2026-10-15');

    fireEvent.change(screen.getByLabelText('Fin *'), { target: { value: '2026-10-13' } });
    await pickPatient();
    await submit();

    expect(
      await screen.findByText('La hora de fin debe ser posterior a la de inicio'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Fin *')).toHaveAttribute('aria-invalid', 'true');
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it('muestra el traslape que rechaza el servidor y no cierra', async () => {
    vi.mocked(createAppointment).mockResolvedValue({
      ok: false,
      error: 'El dentista ya tiene una cita en ese horario',
    });
    const { onCreated } = renderDialog();

    await pickPatient();
    await submit();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('El dentista ya tiene una cita en ese horario'),
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('avisa si la búsqueda de pacientes falla', async () => {
    vi.mocked(listPatients).mockRejectedValue(new Error('network'));
    renderDialog();

    await userEvent.click(screen.getByRole('combobox', { name: 'Paciente *' }));

    const listbox = await screen.findByRole('listbox');
    expect(
      await within(listbox).findByText('No se pudo buscar. Intenta de nuevo.'),
    ).toBeInTheDocument();
  });

  it('Cancelar cierra el diálogo', async () => {
    const { onClose } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
  });
});
