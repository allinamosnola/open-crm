'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

// Tema claro/oscuro/sistema: next-themes pone la clase `.dark` en <html> y
// guarda la elección en este navegador.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
