'use client';

import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const OPTIONS = [
  { value: 'light', label: 'Claro', icon: SunIcon },
  { value: 'dark', label: 'Oscuro', icon: MoonIcon },
  { value: 'system', label: 'Sistema', icon: MonitorIcon },
] as const;

// Selector de tema: Claro / Oscuro / Sistema. `compact` deja solo el icono.
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme = 'system', setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={compact ? 'size-9 p-0' : 'w-full justify-start'}
          title="Cambiar tema"
        >
          <SunIcon className="dark:hidden" />
          <MoonIcon className="hidden dark:block" />
          <span className={compact ? 'sr-only' : 'sr-only lg:not-sr-only'}>Tema</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
            <Icon />
            {label}
            {theme === value && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
