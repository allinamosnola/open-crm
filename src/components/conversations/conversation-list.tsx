'use client';

import { AlertTriangleIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { LocalDateTime } from '@/components/local-date-time';
import {
  BotPausedBadge,
  NeedsAttentionBadge,
  UnidentifiedBadge,
} from '@/components/status-badge';
import { listConversations, listNeedsAttention } from '@/lib/db/conversations';
import type { ConversationListItem } from '@/lib/db/types';
import { ATTENTION_CATEGORY_LABEL, patientName } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

// Lista de la bandeja: arriba la sección "Requiere atención" (conversaciones
// que el bot pasó a la recepción, con categoría y motivo) y debajo las demás.
// Parte de los datos del servidor y se vuelve a pedir cuando Realtime avisa de
// mensajes o conversaciones nuevas o modificadas.
export function ConversationList({
  conversations: initial,
  attention: initialAttention,
  selectedId,
}: {
  conversations: ConversationListItem[];
  attention: ConversationListItem[];
  selectedId: string | null;
}) {
  const [conversations, setConversations] = useState(initial);
  const [attention, setAttention] = useState(initialAttention);
  const [prevInitial, setPrevInitial] = useState({ initial, initialAttention });
  if (prevInitial.initial !== initial || prevInitial.initialAttention !== initialAttention) {
    setPrevInitial({ initial, initialAttention });
    setConversations(initial);
    setAttention(initialAttention);
  }

  const requestId = useRef(0);
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refetch = async () => {
      const current = ++requestId.current;
      try {
        const [all, flagged] = await Promise.all([listConversations(), listNeedsAttention()]);
        if (current !== requestId.current) return;
        setConversations(all);
        setAttention(flagged);
      } catch {
        // Se conserva la lista que ya se muestra.
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refetch(), 400);
    };
    const channel = supabase
      .channel(`inbox-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, schedule)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, schedule)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  // Las que requieren atención solo aparecen en su sección.
  const attentionIds = new Set(attention.map((c) => c.id));
  const rest = conversations.filter((c) => !c.needs_attention && !attentionIds.has(c.id));

  if (conversations.length === 0 && attention.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        Aún no hay conversaciones. Aparecen aquí cuando un paciente escribe al WhatsApp del
        consultorio.
      </p>
    );
  }

  return (
    <div>
      {attention.length > 0 && (
        <section aria-labelledby="inbox-attention-heading">
          <h2
            id="inbox-attention-heading"
            className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold tracking-wide text-amber-900 uppercase dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
          >
            <AlertTriangleIcon className="size-3.5" aria-hidden />
            Requiere atención ({attention.length})
          </h2>
          <ul className="divide-y border-b" aria-label="Conversaciones que requieren atención">
            {attention.map((c) => (
              <ConversationItem key={c.id} conversation={c} selected={c.id === selectedId} />
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby={attention.length > 0 ? 'inbox-rest-heading' : undefined}>
        {attention.length > 0 && (
          <h2
            id="inbox-rest-heading"
            className="sticky top-0 z-10 border-b bg-card px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            Conversaciones
          </h2>
        )}
        {rest.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No hay más conversaciones.</p>
        ) : (
          <ul className="divide-y" aria-label="Conversaciones">
            {rest.map((c) => (
              <ConversationItem key={c.id} conversation={c} selected={c.id === selectedId} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ConversationItem({
  conversation: c,
  selected,
}: {
  conversation: ConversationListItem;
  selected: boolean;
}) {
  const last = c.last_message[0];
  const unidentified = !c.patient?.full_name;
  const prefix = !last ? '' : last.sender === 'bot' ? 'Bot: ' : last.sender === 'staff' ? 'Tú: ' : '';
  return (
    <li>
      <Link
        href={`/conversaciones?c=${c.id}`}
        scroll={false}
        aria-current={selected ? 'page' : undefined}
        className={cn(
          'grid gap-1 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none',
          selected && 'bg-muted',
          c.needs_attention && 'border-l-4 border-l-amber-500 pl-3',
        )}
      >
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              c.unread_count > 0 ? 'font-semibold' : 'font-medium',
              unidentified && 'italic',
            )}
          >
            {patientName(c.patient)}
          </span>
          {(last?.created_at ?? c.last_message_at) && (
            <span className="shrink-0 text-xs text-muted-foreground">
              <LocalDateTime value={(last?.created_at ?? c.last_message_at)!} smart />
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{c.patient?.phone ?? c.phone}</span>
        {c.needs_attention && (c.attention_category || c.attention_reason) && (
          <p className="line-clamp-2 text-xs text-amber-900 dark:text-amber-100">
            {c.attention_category && (
              <span className="font-semibold">
                {ATTENTION_CATEGORY_LABEL[c.attention_category]}
                {c.attention_reason && ': '}
              </span>
            )}
            {c.attention_reason}
          </p>
        )}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              c.unread_count > 0 ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {last ? `${prefix}${last.body}` : 'Sin mensajes'}
          </span>
          {c.unread_count > 0 && (
            <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs leading-5 font-semibold text-primary-foreground">
              <span className="sr-only">Sin leer: </span>
              {c.unread_count}
            </span>
          )}
        </div>
        {(c.needs_attention || unidentified || c.bot_paused) && (
          <div className="flex flex-wrap gap-1.5">
            {c.needs_attention && <NeedsAttentionBadge />}
            {unidentified && <UnidentifiedBadge />}
            {c.bot_paused && <BotPausedBadge />}
          </div>
        )}
      </Link>
    </li>
  );
}
