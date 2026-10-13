'use client';

import {
  AlertCircleIcon,
  ArrowLeftIcon,
  BotIcon,
  CheckCheckIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  PauseIcon,
  PlayIcon,
  SendIcon,
  UserIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';

import { AttentionBanner } from '@/components/conversations/attention-banner';
import { READ_ONLY_HINT, useReadOnly } from '@/components/layout/read-only';
import { LocalDateTime } from '@/components/local-date-time';
import {
  BotPausedBadge,
  NeedsAttentionBadge,
  UnidentifiedBadge,
} from '@/components/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  getConversationById,
  listMessages,
  markRead,
  sendStaffMessage,
  setBotPaused,
} from '@/lib/db/conversations';
import { staffMessageSchema } from '@/lib/db/schemas';
import type { ConversationWithPatient, MessageWithStaff } from '@/lib/db/types';
import { patientName } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { describeMessageError } from '@/lib/whatsapp/errors';

const MAX_LENGTH = 1600;

// Hilo de WhatsApp de un paciente: burbujas, estado de entrega, caja de
// respuesta y pausa del bot. Se usa en /conversaciones y en la ficha del
// paciente. Parte de los datos del servidor y se actualiza con Realtime.
export function ConversationThread({
  conversation: initialConversation,
  messages: initialMessages,
  showPatientLink = false,
  backHref,
  className,
}: {
  conversation: ConversationWithPatient;
  messages: MessageWithStaff[];
  showPatientLink?: boolean;
  // Enlace "volver" para pantallas angostas (bandeja en una sola columna).
  backHref?: string;
  className?: string;
}) {
  const readOnly = useReadOnly();
  const [conversation, setConversation] = useState(initialConversation);
  const [messages, setMessages] = useState(initialMessages);
  // Si el servidor manda datos nuevos (revalidación), reemplazan a los locales.
  const [prevProps, setPrevProps] = useState({ c: initialConversation, m: initialMessages });
  if (prevProps.c !== initialConversation || prevProps.m !== initialMessages) {
    setPrevProps({ c: initialConversation, m: initialMessages });
    setConversation(initialConversation);
    setMessages(initialMessages);
  }

  const id = conversation.id;
  const requestId = useRef(0);

  const refetch = useCallback(async () => {
    const current = ++requestId.current;
    try {
      const [c, m] = await Promise.all([getConversationById(id), listMessages(id)]);
      if (current !== requestId.current) return;
      if (c) setConversation(c);
      setMessages(m);
    } catch {
      // Se conservan los datos que ya se muestran.
    }
  }, [id]);

  // Realtime: mensajes nuevos o cambios de estado de entrega, y cambios de la
  // conversación (bot pausado, no leídos, requiere atención).
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refetch(), 250);
    };
    const messageFilter = `conversation_id=eq.${id}`;
    const conversationFilter = `id=eq.${id}`;
    const channel = supabase
      .channel(`thread-${id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: messageFilter }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: messageFilter }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: conversationFilter }, schedule)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [id, refetch]);

  // Abrir el hilo (o recibir mensajes con el hilo abierto) lo marca como leído.
  // En solo lectura no se puede escribir, así que no se intenta.
  const unread = conversation.unread_count;
  useEffect(() => {
    if (readOnly || unread === 0) return;
    let cancelled = false;
    markRead(id).then((result) => {
      if (!cancelled && result.ok) setConversation((c) => ({ ...c, unread_count: 0 }));
    });
    return () => {
      cancelled = true;
    };
  }, [id, unread, readOnly]);

  // Baja al último mensaje al abrir y cuando llegan mensajes.
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageId = messages.at(-1)?.id;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastMessageId]);

  const [pausePending, startPause] = useTransition();
  function toggleBot() {
    const next = !conversation.bot_paused;
    startPause(async () => {
      const result = await setBotPaused(id, next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConversation((c) => ({ ...c, bot_paused: next }));
      toast.success(next ? 'Bot pausado para este paciente' : 'Bot reanudado para este paciente');
    });
  }

  const patient = conversation.patient;
  const unidentified = !patient?.full_name;

  return (
    <div className={cn('flex min-h-0 flex-col bg-background', className)}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
        {backHref && (
          <Button variant="ghost" size="icon" asChild className="md:hidden">
            <Link href={backHref} aria-label="Volver a la lista de conversaciones">
              <ArrowLeftIcon />
            </Link>
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={cn('truncate text-base font-semibold', unidentified && 'italic')}>
              {patientName(patient)}
            </h2>
            {conversation.needs_attention && <NeedsAttentionBadge />}
            {unidentified && <UnidentifiedBadge />}
            {conversation.bot_paused && <BotPausedBadge />}
          </div>
          <p className="text-sm text-muted-foreground">{patient?.phone ?? conversation.phone}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {showPatientLink && patient && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/pacientes/${patient.id}`}>
                <ExternalLinkIcon />
                Ver ficha
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleBot}
            disabled={pausePending || readOnly}
            title={readOnly ? READ_ONLY_HINT : undefined}
          >
            {conversation.bot_paused ? <PlayIcon /> : <PauseIcon />}
            {conversation.bot_paused ? 'Reanudar bot' : 'Pausar bot'}
          </Button>
        </div>
      </header>

      {conversation.needs_attention && (
        <AttentionBanner
          conversation={conversation}
          onResolved={(botPaused) =>
            setConversation((c) => ({ ...c, needs_attention: false, bot_paused: botPaused }))
          }
        />
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-muted/30 px-4 py-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aún no hay mensajes.</p>
        ) : (
          <ol className="grid gap-3" aria-label="Mensajes" aria-live="polite" aria-relevant="additions">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </ol>
        )}
      </div>

      <ReplyBox
        conversationId={id}
        botPaused={conversation.bot_paused}
        readOnly={readOnly}
        onSent={refetch}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: MessageWithStaff }) {
  const fromPatient = message.sender === 'patient';
  const fromBot = message.sender === 'bot';
  const author = fromPatient
    ? 'Paciente'
    : fromBot
      ? 'Bot'
      : (message.staff?.full_name ?? 'Personal del consultorio');

  return (
    <li className={cn('flex', fromPatient ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-xs sm:max-w-[70%]',
          fromPatient && 'rounded-bl-sm border bg-card text-card-foreground',
          fromBot &&
            'rounded-br-sm border border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-50',
          !fromPatient && !fromBot && 'rounded-br-sm bg-primary text-primary-foreground',
          message.status === 'failed' && 'ring-2 ring-destructive/60',
        )}
      >
        {fromPatient ? (
          <span className="sr-only">{author}: </span>
        ) : (
          <p className="mb-0.5 inline-flex items-center gap-1 text-xs font-semibold opacity-80">
            {fromBot ? <BotIcon className="size-3" /> : <UserIcon className="size-3" />}
            {author}
          </p>
        )}
        <p className="break-words whitespace-pre-wrap">{message.body}</p>
        <p className="mt-1 flex flex-wrap items-center justify-end gap-x-2 text-[11px] opacity-75">
          <LocalDateTime value={message.created_at} smart />
          {message.direction === 'out' && <DeliveryStatus message={message} />}
        </p>
        {message.status === 'failed' && (
          <p
            className={cn(
              'mt-1 rounded-md px-2 py-1 text-xs font-medium',
              fromBot || fromPatient
                ? 'bg-destructive/10 text-destructive'
                : 'bg-background/90 text-destructive',
            )}
          >
            {describeMessageError(message.error_code) ?? 'No se pudo enviar el mensaje'}
          </p>
        )}
      </div>
    </li>
  );
}

function DeliveryStatus({ message }: { message: MessageWithStaff }) {
  switch (message.status) {
    case 'queued':
      return (
        <span className="inline-flex items-center gap-0.5">
          <ClockIcon className="size-3" aria-hidden />
          Enviando
        </span>
      );
    case 'sent':
      return (
        <span className="inline-flex items-center gap-0.5">
          <CheckIcon className="size-3" aria-hidden />
          Enviado
        </span>
      );
    case 'delivered':
      return (
        <span className="inline-flex items-center gap-0.5">
          <CheckCheckIcon className="size-3" aria-hidden />
          Entregado
        </span>
      );
    case 'read':
      return (
        <span className="inline-flex items-center gap-0.5 font-semibold">
          <CheckCheckIcon className="size-3" aria-hidden />
          Leído
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-0.5 font-semibold">
          <AlertCircleIcon className="size-3" aria-hidden />
          Fallido
        </span>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------

function ReplyBox({
  conversationId,
  botPaused,
  readOnly,
  onSent,
}: {
  conversationId: string;
  botPaused: boolean;
  readOnly: boolean;
  onSent: () => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = `reply-${conversationId}`;

  function send() {
    const input = { conversation_id: conversationId, body };
    const parsed = staffMessageSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa el mensaje');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await sendStaffMessage(input);
      // El mensaje fallido (p. ej. fuera de la ventana de 24 h) queda en el hilo;
      // el texto se conserva en la caja por si se quiere corregir o reintentar.
      await onSent();
      if (!result.ok) {
        setError(result.fieldErrors?.body?.[0] ?? result.error);
        return;
      }
      setBody('');
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl/Cmd + Enter envía; Enter solo agrega un salto de línea.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-2 border-t p-3">
      <p className="text-xs text-muted-foreground" id={`${inputId}-hint`}>
        {botPaused
          ? 'El bot está pausado: no responderá a este paciente hasta que lo reanudes.'
          : 'Al responder, el bot se pausa para este paciente y deja de contestarle hasta que lo reanudes.'}
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor={inputId} className="sr-only">
          Escribe una respuesta
        </label>
        <Textarea
          id={inputId}
          rows={2}
          maxLength={MAX_LENGTH}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={readOnly ? READ_ONLY_HINT : 'Escribe una respuesta…'}
          disabled={readOnly}
          aria-describedby={`${inputId}-hint`}
          aria-invalid={error ? true : undefined}
          className="max-h-40 min-h-11 flex-1 resize-y"
        />
        <Button
          type="submit"
          disabled={pending || readOnly || body.trim() === ''}
          title={readOnly ? READ_ONLY_HINT : 'Enviar (Ctrl + Enter)'}
        >
          <SendIcon />
          {pending ? 'Enviando…' : 'Enviar'}
        </Button>
      </div>
      {body.length > MAX_LENGTH - 200 && (
        <p className="text-right text-xs text-muted-foreground">
          {body.length}/{MAX_LENGTH}
        </p>
      )}
    </form>
  );
}
