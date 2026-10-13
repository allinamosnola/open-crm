'use client';

import { Volume2Icon, VolumeXIcon } from 'lucide-react';

import { useSoundEnabled } from '@/components/layout/attention-sound';
import { Button } from '@/components/ui/button';

// "Sonido de avisos": activa o silencia el sonido de las conversaciones que
// requieren atención. Se guarda en este navegador (localStorage).
export function SoundToggle() {
  const [enabled, setEnabled] = useSoundEnabled();
  const Icon = enabled ? Volume2Icon : VolumeXIcon;
  const title = enabled
    ? 'Sonido de avisos activado: clic para silenciar'
    : 'Sonido de avisos silenciado: clic para activar';
  return (
    <Button
      type="button"
      variant="ghost"
      className="w-full justify-start"
      aria-pressed={enabled}
      title={title}
      onClick={() => setEnabled(!enabled)}
    >
      <Icon />
      <span className="sr-only lg:not-sr-only">Sonido de avisos</span>
      <span className="ml-auto hidden text-xs text-muted-foreground lg:inline" aria-hidden>
        {enabled ? 'Sí' : 'No'}
      </span>
    </Button>
  );
}
