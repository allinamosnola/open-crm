import { execSync } from 'node:child_process';

import { defineConfig, devices } from '@playwright/test';

// E2E contra la app compilada (next build + next start) y Supabase local con
// supabase/seed.sql. Requiere `npx supabase start` antes de correr `npm run e2e`.
//
// Sin llamadas externas: no hay ANTHROPIC_API_KEY, STRIPE_SECRET_KEY,
// TWILIO_ACCOUNT_SID ni RESEND_API_KEY en el servidor de pruebas. El webhook de
// Twilio se simula con una firma válida para TWILIO_AUTH_TOKEN (valor de prueba).

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Llaves de Supabase local: de las variables de entorno o de `supabase status`.
// E2E_SUPABASE_WORKDIR permite apuntar a otra copia de supabase/ (otro project_id).
function supabaseLocal(): { url: string; anonKey: string; serviceRoleKey: string } {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY) {
    return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY };
  }
  const workdir = process.env.E2E_SUPABASE_WORKDIR;
  try {
    const out = execSync(`npx supabase status -o json${workdir ? ` --workdir ${workdir}` : ''}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const status = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    return { url: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
  } catch {
    // `playwright test --list` no necesita la base; los tests sí fallarán sin ella.
    return { url: 'http://127.0.0.1:54321', anonKey: 'missing', serviceRoleKey: 'missing' };
  }
}

const supabase = supabaseLocal();

// Los tests (procesos hijos) heredan estas variables.
process.env.E2E_BASE_URL = BASE_URL;
process.env.E2E_SUPABASE_URL = supabase.url;
process.env.E2E_SUPABASE_SERVICE_ROLE_KEY = supabase.serviceRoleKey;
process.env.E2E_TWILIO_AUTH_TOKEN ??= 'e2e-twilio-auth-token';

export default defineConfig({
  testDir: './e2e',
  // Comparten la base de la seed: en serie y sin reintentos que oculten fallas.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    // La seed y el horario del consultorio están en hora de Ciudad de México.
    timezoneId: 'America/Mexico_City',
    locale: 'es-MX',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next build && npx next start -p ${PORT} -H 127.0.0.1`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'pipe',
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
      PUBLIC_BASE_URL: BASE_URL,
      TWILIO_AUTH_TOKEN: process.env.E2E_TWILIO_AUTH_TOKEN,
      NEXT_TELEMETRY_DISABLED: '1',
      // Vacías a propósito (Next no las sobrescribe con un .env local): ningún
      // flujo E2E debe llegar a Stripe, Twilio REST, Anthropic, Resend ni Sentry.
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      TWILIO_ACCOUNT_SID: '',
      ANTHROPIC_API_KEY: '',
      RESEND_API_KEY: '',
      NEXT_PUBLIC_SENTRY_DSN: '',
      SENTRY_AUTH_TOKEN: '',
    },
  },
});
