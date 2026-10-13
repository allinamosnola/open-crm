'use client';

import { usePathname, useSearchParams } from 'next/navigation';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type PatientTab = { value: string; label: string; content: React.ReactNode };

// Pestañas sincronizadas con ?tab=. Se usa history.replaceState (Next lo integra
// con useSearchParams) para no volver a pedir la página al servidor al cambiar.
export function PatientTabs({ tabs, defaultTab }: { tabs: PatientTab[]; defaultTab: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get('tab');
  const current = tabs.some((t) => t.value === fromUrl) ? fromUrl! : defaultTab;

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', value);
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
  }

  return (
    <Tabs value={current} onValueChange={onChange}>
      <TabsList className="h-auto max-w-full flex-wrap justify-start">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="flex-none px-3">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value} className="pt-2">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
