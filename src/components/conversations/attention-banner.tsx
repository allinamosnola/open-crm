'use client';

import { AlertTriangleIcon, CheckIcon } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { READ_ONLY_HINT, useReadOnly } from '@/components/layout/read-only';
import { LocalDateTime } from '@/components/local-date-time';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { markResolved } from '@/lib/db/conversations';
import type { Conversation } from '@/lib/db/types';
import { ATTENTION_CATEGORY_LABEL } from '@/lib/format';

// Aviso en el hilo cuando el bot pasó la conversación a la recepción: categoría,
// motivo, hora del escalamiento y "Marcar resuelto". Si el bot está pausado
// (el escalamiento lo pausa) pregunta si también se reanuda.
export function AttentionBanner({
  conversation,
  onResolved,
}: {
  conversation: Pick<
    Conversation,
    'id' | 'attention_category' | 'attention_reason' | 'escalated_at' | 'bot_paused'
  >;
  onResolved: (botPaused: boolean) => void;
}) {
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<'keep' | 'resume' | null>(null);

  function resolve(resumeBot: boolean) {
    setChoice(resumeBot ? 'resume' : 'keep');
    startTransition(async () => {
      const result = await markResolved(conversation.id, { resumeBot });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      onResolved(result.data.botPaused);
      toast.success(
        resumeBot
          ? 'Conversación resuelta y bot reanudado'
          : result.data.botPaused
            ? 'Conversación resuelta. El bot sigue pausado para este paciente'
            : 'Conversación resuelta',
      );
    });
  }

  function onClick() {
    // Sin el bot pausado no hay nada que preguntar.
    if (conversation.bot_paused) setOpen(true);
    else resolve(false);
  }

  const category = conversation.attention_category;

  return (
    <section
      aria-label="Requiere atención"
      className="flex flex-wrap items-start gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-semibold">
          Requiere atención
          {category && <>: {ATTENTION_CATEGORY_LABEL[category]}</>}
        </p>
        {conversation.attention_reason && (
          <p className="break-words whitespace-pre-wrap">{conversation.attention_reason}</p>
        )}
        {conversation.escalated_at && (
          <p className="text-xs opacity-80">
            El bot la pasó a la recepción: <LocalDateTime value={conversation.escalated_at} />
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 bg-background"
        onClick={onClick}
        disabled={pending || readOnly}
        title={readOnly ? READ_ONLY_HINT : undefined}
      >
        <CheckIcon />
        {pending && !open ? 'Guardando…' : 'Marcar resuelto'}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Reanudar también el bot?</DialogTitle>
            <DialogDescription>
              La conversación dejará de aparecer en &quot;Requiere atención&quot;. El bot está
              pausado para este paciente: si lo reanudas volverá a contestarle automáticamente; si
              no, seguirá pausado hasta que lo reanudes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="button" variant="outline" onClick={() => resolve(false)} disabled={pending}>
              {pending && choice === 'keep' ? 'Guardando…' : 'Resolver sin reanudar'}
            </Button>
            <Button type="button" onClick={() => resolve(true)} disabled={pending}>
              {pending && choice === 'resume' ? 'Guardando…' : 'Resolver y reanudar el bot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
