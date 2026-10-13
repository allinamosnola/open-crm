import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationThread } from '@/components/conversations/conversation-thread';
import { ReadOnlyProvider, READ_ONLY_HINT } from '@/components/layout/read-only';
import {
  getConversationById,
  listMessages,
  markRead,
  sendStaffMessage,
  setBotPaused,
} from '@/lib/db/conversations';
import type { ConversationWithPatient, MessageWithStaff } from '@/lib/db/types';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/db/conversations', () => ({
  getConversationById: vi.fn(),
  listMessages: vi.fn(),
  markRead: vi.fn(),
  markResolved: vi.fn(),
  sendStaffMessage: vi.fn(),
  setBotPaused: vi.fn(),
}));

// Realtime: se registra la suscripción, pero no llegan eventos.
const removeChannel = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return { channel: () => channel, removeChannel };
  },
}));

const CONVERSATION_ID = 'c0000000-0000-4000-8000-000000000001';

function conversation(overrides: Partial<ConversationWithPatient> = {}): ConversationWithPatient {
  return {
    id: CONVERSATION_ID,
    clinic_id: 'f0000000-0000-0000-0000-00000000000a',
    patient_id: '9a000000-0000-4000-8000-000000000001',
    phone: '+525512345678',
    bot_paused: false,
    bot_state: {},
    needs_attention: false,
    attention_category: null,
    attention_reason: null,
    escalated_at: null,
    unread_count: 0,
    last_message_at: '2026-10-13T15:00:00Z',
    created_at: '2026-10-01T00:00:00Z',
    patient: {
      id: '9a000000-0000-4000-8000-000000000001',
      full_name: 'María Pérez',
      phone: '+525512345678',
      status: 'active',
    },
    ...overrides,
  };
}

let seq = 0;
function message(overrides: Partial<MessageWithStaff>): MessageWithStaff {
  seq += 1;
  return {
    id: `m${seq}`,
    clinic_id: 'f0000000-0000-0000-0000-00000000000a',
    conversation_id: CONVERSATION_ID,
    body: 'Hola',
    direction: 'in',
    sender: 'patient',
    status: 'received',
    error_code: null,
    staff_id: null,
    twilio_sid: null,
    created_at: '2026-10-13T15:00:00Z',
    staff: null,
    ...overrides,
  };
}

const history = () => [
  message({ body: 'Quiero una cita' }),
  message({ body: '¿Qué día te acomoda?', direction: 'out', sender: 'bot', status: 'read' }),
  message({
    body: 'Te esperamos el lunes',
    direction: 'out',
    sender: 'staff',
    status: 'failed',
    error_code: '63016',
    staff: { id: 's1', full_name: 'Laura Martínez' },
  }),
];

const replyBox = () => screen.getByRole('textbox', { name: 'Escribe una respuesta' });

describe('ConversationThread', () => {
  beforeEach(() => {
    vi.mocked(getConversationById).mockResolvedValue(conversation());
    vi.mocked(listMessages).mockResolvedValue(history());
    vi.mocked(markRead).mockResolvedValue({ ok: true, data: { id: CONVERSATION_ID } });
  });

  it('muestra el hilo con autor, estado de entrega y el error de Twilio', () => {
    render(<ConversationThread conversation={conversation()} messages={history()} />);

    expect(screen.getByRole('heading', { name: 'María Pérez' })).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Mensajes' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Paciente: Quiero una cita');
    expect(items[1]).toHaveTextContent('Bot');
    expect(items[1]).toHaveTextContent('Leído');
    expect(items[2]).toHaveTextContent('Laura Martínez');
    expect(items[2]).toHaveTextContent('Fallido');
    expect(items[2]).toHaveTextContent(
      'Fuera de la ventana de 24 h: el paciente debe escribir primero',
    );
  });

  it('sin mensajes muestra el estado vacío y no deja enviar texto en blanco', async () => {
    render(<ConversationThread conversation={conversation()} messages={[]} />);

    expect(screen.getByText('Aún no hay mensajes.')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Enviar' });
    expect(send).toBeDisabled();
    await userEvent.type(replyBox(), '   ');
    expect(send).toBeDisabled();
  });

  it('envía la respuesta, recarga el hilo y vacía la caja', async () => {
    vi.mocked(sendStaffMessage).mockResolvedValue({ ok: true, data: { id: 'm-new', status: 'queued' } });
    render(<ConversationThread conversation={conversation()} messages={history()} />);

    await userEvent.type(replyBox(), 'Claro, el lunes a las 10');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    await waitFor(() => expect(replyBox()).toHaveValue(''));
    expect(sendStaffMessage).toHaveBeenCalledWith({
      conversation_id: CONVERSATION_ID,
      body: 'Claro, el lunes a las 10',
    });
    expect(listMessages).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it('Ctrl + Enter envía; Enter solo agrega un salto de línea', async () => {
    vi.mocked(sendStaffMessage).mockResolvedValue({ ok: true, data: { id: 'm-new', status: 'queued' } });
    render(<ConversationThread conversation={conversation()} messages={history()} />);

    await userEvent.type(replyBox(), 'Línea 1{Enter}Línea 2');
    expect(sendStaffMessage).not.toHaveBeenCalled();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() =>
      expect(sendStaffMessage).toHaveBeenCalledWith({
        conversation_id: CONVERSATION_ID,
        body: 'Línea 1\nLínea 2',
      }),
    );
  });

  it('si el envío falla muestra el error y conserva el texto', async () => {
    vi.mocked(sendStaffMessage).mockResolvedValue({
      ok: false,
      error: 'Fuera de la ventana de 24 h: el paciente debe escribir primero',
    });
    render(<ConversationThread conversation={conversation()} messages={history()} />);

    await userEvent.type(replyBox(), 'Hola');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Fuera de la ventana de 24 h: el paciente debe escribir primero',
    );
    expect(replyBox()).toHaveValue('Hola');
    expect(replyBox()).toHaveAttribute('aria-invalid', 'true');
  });

  it('pausa y reanuda el bot', async () => {
    vi.mocked(setBotPaused).mockResolvedValue({ ok: true, data: { id: CONVERSATION_ID } });
    render(<ConversationThread conversation={conversation()} messages={history()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pausar bot' }));

    expect(await screen.findByRole('button', { name: 'Reanudar bot' })).toBeInTheDocument();
    expect(setBotPaused).toHaveBeenCalledWith(CONVERSATION_ID, true);
    expect(toast.success).toHaveBeenCalledWith('Bot pausado para este paciente');
    expect(
      screen.getByText(/El bot está pausado: no responderá a este paciente/),
    ).toBeInTheDocument();
  });

  it('si no se puede pausar el bot avisa y no cambia el estado', async () => {
    vi.mocked(setBotPaused).mockResolvedValue({
      ok: false,
      error: 'Tu plan no incluye el bot de WhatsApp',
    });
    render(<ConversationThread conversation={conversation()} messages={history()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pausar bot' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Tu plan no incluye el bot de WhatsApp'),
    );
    expect(screen.getByRole('button', { name: 'Pausar bot' })).toBeEnabled();
  });

  it('marca como leída una conversación con mensajes sin leer', async () => {
    render(
      <ConversationThread conversation={conversation({ unread_count: 2 })} messages={history()} />,
    );
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(CONVERSATION_ID));
  });

  it('en solo lectura no marca leído ni deja responder o pausar', () => {
    render(
      <ReadOnlyProvider readOnly>
        <ConversationThread conversation={conversation({ unread_count: 2 })} messages={history()} />
      </ReadOnlyProvider>,
    );

    expect(replyBox()).toBeDisabled();
    expect(replyBox()).toHaveAttribute('placeholder', READ_ONLY_HINT);
    expect(screen.getByRole('button', { name: 'Pausar bot' })).toBeDisabled();
    expect(markRead).not.toHaveBeenCalled();
  });

  it('identifica al paciente sin nombre por su teléfono', () => {
    render(
      <ConversationThread
        conversation={conversation({
          patient: { id: 'p2', full_name: null, phone: '+525598765432', status: 'unidentified' },
        })}
        messages={[]}
      />,
    );

    expect(screen.getByText('+525598765432')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('italic');
  });

  it('cierra la suscripción de Realtime al desmontar', () => {
    const { unmount } = render(
      <ConversationThread conversation={conversation()} messages={history()} />,
    );
    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });
});
