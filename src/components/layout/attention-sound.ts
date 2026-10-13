'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Sonido corto de "requiere atención" generado con WebAudio (sin archivos) y
// preferencia "Sonido de avisos" guardada en localStorage.

// ---------------------------------------------------------------------------
// Preferencia
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'dental-crm:sonido-avisos';
const listeners = new Set<() => void>();
// Si localStorage no está disponible (modo privado, bloqueado) la preferencia
// vive solo en memoria mientras dure la pestaña.
let memoryValue: boolean | null = null;

function readSoundEnabled(): boolean {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored !== 'off';
  } catch {
    // Sin acceso a localStorage.
  }
  return memoryValue ?? true;
}

function writeSoundEnabled(enabled: boolean) {
  memoryValue = enabled;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Sin acceso a localStorage: queda en memoria.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Cambios hechos en otra pestaña.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

// Activado por defecto. En el servidor se asume activado.
export function useSoundEnabled(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readSoundEnabled, () => true);
  const setEnabled = useCallback((value: boolean) => writeSoundEnabled(value), []);
  return [enabled, setEnabled];
}

export function isSoundEnabled(): boolean {
  return readSoundEnabled();
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

let context: AudioContext | null = null;

function createContext(): AudioContext | null {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

// El navegador no deja reproducir audio hasta que el usuario interactúa con la
// página: el AudioContext se crea (o reanuda) en el primer clic o tecla. Antes
// de eso el aviso se muestra solo con el toast.
export function installAudioUnlock(): () => void {
  const unlock = () => {
    if (context?.state === 'running') return;
    context ??= createContext();
    if (context?.state === 'suspended') void context.resume().catch(() => {});
  };
  const options = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', unlock, options);
  window.addEventListener('keydown', unlock, options);
  return () => {
    window.removeEventListener('pointerdown', unlock, options);
    window.removeEventListener('keydown', unlock, options);
  };
}

// Dos tonos cortos ascendentes (~0.35 s). Devuelve false si el audio aún no
// está habilitado por el navegador.
export function playAttentionSound(): boolean {
  if (!context || context.state !== 'running') return false;
  try {
    const now = context.currentTime;
    const tones: [frequency: number, start: number][] = [
      [880, 0],
      [1318.5, 0.16],
    ];
    for (const [frequency, offset] of tones) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const t = now + offset;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(context.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
    return true;
  } catch {
    return false;
  }
}
