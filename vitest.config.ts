import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Dos proyectos:
// - server: lógica del servidor (webhooks, bot, Stripe, panel). Twilio, Claude y la
//   base de datos van mockeados: no se hace ninguna llamada de red.
// - components: componentes de React con Testing Library y jsdom; las server
//   actions y el cliente de Supabase van mockeados en cada test.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 'server-only' lanza fuera del bundler de Next; en tests es un módulo vacío.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/components/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.tsx'],
          setupFiles: ['tests/components/setup.ts'],
        },
      },
    ],
  },
});
