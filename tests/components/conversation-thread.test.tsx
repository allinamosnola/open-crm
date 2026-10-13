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
  retryFailedMessage,
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
  retryFailedMessage: vi.fn(),
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

describe('ConversationThread: reintentar mensajes fallidos', () => {
  const failed = () =>
    message({
      id: 'm-failed',
      body: 'Te esperamos el lunes',
      direction: 'out',
      sender: 'staff',
      status: 'failed',
      error_code: '63016',
    });
  const retryButton = () => screen.queryByRole('button', { name: 'Reintentar' });

  beforeEach(() => {
    vi.mocked(getConversationById).mockResolvedValue(conversation());
    vi.mocked(listMessages).mockResolvedValue([failed()]);
  });

  it('solo los mensajes salientes con estado failed tienen el botón', () => {
    render(
      <ConversationThread
        conversation={conversation()}
        messages={[
          message({ body: 'Entrante' }),
          message({ body: 'Enviado', direction: 'out', sender: 'staff', status: 'sent' }),
          message({ body: 'En cola', direction: 'out', sender: 'bot', status: 'queued' }),
          message({ body: 'Entregado', direction: 'out', sender: 'bot', status: 'delivered' }),
          message({ body: 'Leído', direction: 'out', sender: 'staff', status: 'read' }),
          failed(),
        ]}
      />,
    );

    const buttons = screen.getAllByRole('button', { name: 'Reintentar' });
    expect(buttons).toHaveLength(1);
    const items = within(screen.getByRole('list', { name: 'Mensajes' })).getAllByRole('listitem');
    expect(within(items[5]).getByRole('button', { name: 'Reintentar' })).toBe(buttons[0]);
  });

  it('sin mensajes fallidos no hay botón', () => {
    render(
      <ConversationThread
        conversation={conversation()}
        messages={[message({ body: 'Enviado', direction: 'out', sender: 'staff', status: 'sent' })]}
      />,
    );
    expect(retryButton()).not.toBeInTheDocument();
  });

  it('reintenta con el id del mensaje, recarga el hilo y avisa', async () => {
    vi.mocked(retryFailedMessage).mockResolvedValue({
      ok: true,
      data: { id: 'm-failed', status: 'queued' },
    });
    vi.mocked(listMessages).mockResolvedValue([
      { ...failed(), status: 'queued', error_code: null },
    ]);
    render(<ConversationThread conversation={conversation()} messages={[failed()]} />);

    await userEvent.click(retryButton()!);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mensaje reenviado'));
    expect(retryFailedMessage).toHaveBeenCalledWith('m-failed');
    expect(listMessages).toHaveBeenCalledWith(CONVERSATION_ID);
    // El hilo recargado ya no tiene el mensaje como fallido.
    await waitFor(() => expect(retryButton()).not.toBeInTheDocument());
    expect(screen.getByText('Enviando')).toBeInTheDocument();
  });

  it('muestra el estado pendiente y no deja reintentar dos veces', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof retryFailedMessage>>) => void;
    vi.mocked(retryFailedMessage).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ConversationThread conversation={conversation()} messages={[failed()]} />);

    await userEvent.click(retryButton()!);

    const pending = await screen.findByRole('button', { name: 'Reintentando…' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(pending);
    expect(retryFailedMessage).toHaveBeenCalledTimes(1);

    resolve({ ok: true, data: { id: 'm-failed', status: 'sent' } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mensaje reenviado'));
  });

  it('si el reintento falla muestra el error y deja volver a intentar', async () => {
    vi.mocked(retryFailedMessage).mockResolvedValue({
      ok: false,
      error: 'Fuera de la ventana de 24 h: el paciente debe escribir primero',
    });
    render(<ConversationThread conversation={conversation()} messages={[failed()]} />);

    await userEvent.click(retryButton()!);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Fuera de la ventana de 24 h: el paciente debe escribir primero',
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeEnabled();
  });

  it('si la acción lanza, avisa con un error genérico', async () => {
    vi.mocked(retryFailedMessage).mockRejectedValue(new Error('network'));
    render(<ConversationThread conversation={conversation()} messages={[failed()]} />);

    await userEvent.click(retryButton()!);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('No se pudo reintentar el envío. Intenta de nuevo.'),
    );
  });

  it('en solo lectura el botón está deshabilitado y no llama a la acción', async () => {
    render(
      <ReadOnlyProvider readOnly>
        <ConversationThread conversation={conversation()} messages={[failed()]} />
      </ReadOnlyProvider>,
    );

    const button = retryButton()!;
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', READ_ONLY_HINT);
    await userEvent.click(button);
    expect(retryFailedMessage).not.toHaveBeenCalled();
  });
});
