import { MessageSquareIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ConversationList } from '@/components/conversations/conversation-list';
import { ConversationThread } from '@/components/conversations/conversation-thread';
import { BotUpsellCard } from '@/components/plan/bot-upsell-card';
import {
  getConversationById,
  listConversations,
  listMessages,
  listNeedsAttention,
} from '@/lib/db/conversations';
import { getCurrentStaff } from '@/lib/db/staff';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Conversaciones · CitaBot Dental' };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  // Sin bot en el plan no hay bandeja (el menú ya oculta la sección; esto
  // cubre la entrada por URL directa).
  const me = await getCurrentStaff();
  if (me && !me.clinic.account.bot_enabled) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">Conversaciones</h1>
        <BotUpsellCard plan={me.clinic.account.plan} isOwner={me.role === 'owner'} />
      </div>
    );
  }

  const { c } = await searchParams;
  const rawId = Array.isArray(c) ? c[0] : c;
  const selectedId = rawId && GUID.test(rawId) ? rawId : null;

  const [conversations, attention, selected] = await Promise.all([
    listConversations(),
    listNeedsAttention(),
    selectedId ? getConversationById(selectedId) : Promise.resolve(null),
  ]);
  const messages = selected ? await listMessages(selected.id) : [];
  // En pantallas angostas se ve la lista o el hilo, no ambos.
  const showThread = rawId !== undefined;

  return (
    <div className="flex h-[calc(100dvh-2rem)] min-h-[30rem] flex-col gap-4 lg:h-[calc(100dvh-3rem)]">
      <h1 className={cn('text-2xl font-semibold', showThread && 'hidden md:block')}>
        Conversaciones
      </h1>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
        <div
          className={cn(
            'min-h-0 w-full shrink-0 overflow-y-auto border-r md:block md:w-72 lg:w-80',
            showThread ? 'hidden' : 'block',
          )}
        >
          <ConversationList
            conversations={conversations}
            attention={attention}
            selectedId={selectedId}
          />
        </div>
        <section
          aria-label="Conversación"
          className={cn('min-h-0 min-w-0 flex-1 flex-col md:flex', showThread ? 'flex' : 'hidden')}
        >
          {selected ? (
            <ConversationThread
              key={selected.id}
              conversation={selected}
              messages={messages}
              showPatientLink
              backHref="/conversaciones"
              className="flex-1"
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
              <MessageSquareIcon className="size-8 opacity-50" aria-hidden />
              <p>
                {rawId
                  ? 'La conversación no existe o no tienes acceso a ella.'
                  : 'Elige una conversación para ver los mensajes.'}
              </p>
              <Link href="/conversaciones" className="text-sm underline md:hidden">
                Volver a la lista
              </Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
