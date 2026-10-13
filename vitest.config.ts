import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Tests de la lógica del servidor (webhook de WhatsApp). Twilio (envío), Claude
// y la base de datos van mockeados: no se hace ninguna llamada de red.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 'server-only' lanza fuera del bundler de Next; en tests es un módulo vacío.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
