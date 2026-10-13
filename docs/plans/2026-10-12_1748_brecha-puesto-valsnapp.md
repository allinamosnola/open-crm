# Brecha entre CitaBot Dental y el puesto «Fractional Full-Stack Engineer» de Valsnapp

Fecha: 2026-10-12 17:48 · Fuente: https://www.getonbrd.com/jobs/programming/fractional-full-stack-engineer-valsnapp-remote

Objetivo: usar este proyecto como evidencia (portafolio) para el puesto y cerrar las brechas
que un revisor técnico notaría al abrir el repo.

## Resumen del puesto

Senior, freelance, 10–20 h/semana, USD 30–40/h, remoto desde Latinoamérica, inglés escrito fuerte.
Trabajo: corregir bugs, tickets de investigación a deploy, depurar producción / APIs de terceros /
jobs fallidos, mantener dependencias y CI, ampliar pruebas (incluidas E2E), trabajar con GitHub y Linear.

## Comparación requisito por requisito

| Requisito de la oferta | Estado | Evidencia en el repo |
| --- | --- | --- |
| TypeScript 2+ años | Cubierto | `strict: true`, todo el código en TS |
| React 18 / Next.js App Router, API routes, frontera server/client | Cubierto | Next 16 + React 19, route groups `(panel)` / `(marketing)`, `api/whatsapp`, `api/stripe/webhook`, `server-only`, `after()` |
| Postgres + Supabase: SQL, migraciones, RLS, Auth | Cubierto | 12 migraciones, RLS multi-consultorio, pgTAP en `supabase/tests`, invitaciones y recuperación de contraseña |
| Supabase Storage | **Falta** | No se usa Storage (solo se menciona en un sonido de UI) |
| Deploy y depuración en Vercel | Parcial | Plan de deploy y `maxDuration`/`after()` listos; el README tiene checklist de producción sin marcar → no hay prueba pública de que esté desplegado |
| Git con ramas cortas, PR y feature flags | Parcial | Ramas + PRs con merge commit (#14); **no hay feature flags** |
| Diagnóstico de APIs de terceros (reintentos, fallos, rate limits) | Parcial | Webhooks idempotentes (MessageSid, Stripe), 500 para que reintenten; **no hay reintentos/backoff salientes ni manejo explícito de 429** (Twilio, Resend, Anthropic) |
| Pruebas unitarias y de componentes | Parcial | 22 archivos vitest + 3 pgTAP; **cero pruebas de componentes** (sin Testing Library/jsdom) |
| Reproducir bugs y entregar fixes enfocados | Parcial | Hay historial de fixes, pero no hay plantilla de issue/PR ni tests de regresión nombrados por bug |
| Trabajo con herramientas de IA revisando su salida | Cubierto | `.claude/agents`, planes en `docs/plans`, eval del bot (`eval:bot`) |
| **Stripe: suscripciones y webhooks** (preferido) | Cubierto | Checkout, portal, cambio de plan con prorrateo, webhook, alta desde checkout, tests |
| **Resend / Twilio** (preferido) | Cubierto | Twilio WhatsApp con firma; Resend por REST (sin reintentos) |
| **Playwright / E2E** (preferido) | **Falta** | No existe configuración ni pruebas E2E |
| **Generación de PDF** (preferido) | **Falta** | Nada de PDF (hay pagos y planes de tratamiento: candidato natural a recibo/presupuesto) |
| **Cloud Run / contenedores** (preferido) | **Falta** | El bot Wechaty de desarrollo corre local; sin Dockerfile |
| **Linear** (preferido) | **Falta** | Se gestiona con `docs/plans`; sin Linear |
| LLM API (deseable) | Cubierto | Agente con herramientas de Claude, reglas duras en código, eval |
| SOC 2 / audit log / mínimo privilegio / secretos (deseable) | Parcial | RLS, service role solo servidor, Sentry con datos filtrados; **sin tabla de auditoría**, sin escaneo de secretos |
| CI en verde, dependencias y avisos de seguridad | **Falta** | No hay `.github/` (ni CI, ni Dependabot); `npm audit` nunca se corre |
| Inglés escrito | **Falta** | Código, README, planes y UI en español; nada demuestra inglés técnico |

Lectura: el stack núcleo (Next + Supabase + Stripe + Twilio + LLM) está bien cubierto. Las brechas
son de **proceso y calidad** (CI, E2E, tests de componentes, flags, resiliencia) y de **señales de
portafolio** (inglés, deploy público), que son justo lo que el puesto describe como trabajo diario.

## Plan para cubrir lo que falta

Orden por impacto sobre el puesto / costo. Cada fase es una rama corta con su PR.

### Fase 1 — CI y mantenimiento de dependencias (≈ 2 h)
- `.github/workflows/ci.yml`: `npm ci`, `lint`, `tsc --noEmit`, `vitest run`, `next build` (con variables ficticias de Supabase).
- Job con Supabase local (`supabase start` + `supabase test db`) para los pgTAP.
- `.github/dependabot.yml` (npm + actions, semanal) y `npm audit --omit=dev` como job informativo.
- Plantillas `PULL_REQUEST_TEMPLATE.md` e issue de bug (pasos para reproducir, esperado/actual, test de regresión).
- Aceptación: badge de CI verde en el README; un PR de prueba falla si se rompe un test.

### Fase 2 — E2E con Playwright (≈ 4–6 h)
- `@playwright/test`, `playwright.config.ts`, `npm run e2e`, job de CI contra Supabase local con el seed.
- Flujos: login y aislamiento entre consultorios; crear paciente y cita en la agenda; bandeja de conversaciones (webhook de Twilio simulado con firma válida); bloqueo de funciones por plan Básico; checkout en modo test de Stripe hasta la pantalla de gracias (con `stripe-mock` o fixtures del webhook).
- Aceptación: 5 flujos estables, trazas como artefacto de CI.

### Fase 3 — Pruebas de componentes (≈ 3 h)
- Vitest + `@testing-library/react` + jsdom en un proyecto aparte de vitest (no afecta los tests de servidor).
- Cubrir: `plan-checkout-form`, `login-form`, `appointment-create-dialog`, `patient-form`, `conversation-thread`.
- Aceptación: estados de error y validación cubiertos; cada bug futuro añade un test.

### Fase 4 — Resiliencia con APIs de terceros (≈ 4 h)
- Utilidad `withRetry` (backoff exponencial con jitter, respeta `Retry-After` en 429/5xx, solo errores transitorios) usada en Twilio saliente, Resend y Anthropic.
- Registrar intentos y fallos en Sentry con tags (`where`, `attempt`); tabla/estado para mensajes salientes fallidos y reintento manual desde el panel.
- Tests con respuestas 429/503/timeout simuladas.
- Aceptación: un fallo transitorio no pierde el mensaje; los fallos permanentes quedan visibles.

### Fase 5 — Feature flags (≈ 2 h)
- Tabla `feature_flags` (global y por cuenta) con RLS + helper `isEnabled(flag, accountId)` en servidor; sin proveedor externo.
- Usarla para algo real: p. ej. activar el recibo en PDF (Fase 6) solo para cuentas piloto.
- Aceptación: una función nueva se despliega apagada y se enciende por cuenta sin redeploy.

### Fase 6 — Supabase Storage y PDF (≈ 6 h)
- Bucket privado `receipts` con políticas RLS por `clinic_id`.
- Generar con `@react-pdf/renderer` el **recibo de pago** y el **presupuesto del plan de tratamiento**; guardar en Storage y descargar con URL firmada desde el perfil del paciente.
- Tests de la política de Storage (pgTAP) y de la generación (snapshot de texto).
- Aceptación: recibo descargable desde un pago; otro consultorio no puede leerlo.

### Fase 7 — Auditoría y seguridad (≈ 4 h)
- Tabla `audit_log` (quién, qué, cuándo, `clinic_id`; solo inserción, lectura por owner) alimentada por triggers en pacientes, notas clínicas, pagos y personal.
- Escaneo de secretos (`gitleaks` en CI), revisión de políticas de mínimo privilegio y documento breve `docs/security.md`.
- Aceptación: toda modificación de datos clínicos deja huella consultable; CI falla si se filtra un secreto.

### Fase 8 — Contenedor y Cloud Run (≈ 4 h, opcional)
- `Dockerfile` multietapa para un servicio pequeño (worker de recordatorios o canal del bot) y despliegue de prueba en Cloud Run con secretos en Secret Manager.
- Aceptación: servicio desplegado y documentado; no sustituye a Vercel para el panel.

### Fase 9 — Señales de portafolio (≈ 3 h, en paralelo)
- Deploy público del checklist de producción del README (o una demo en Vercel con datos de seed) y enlace en el README.
- `README.en.md` con resumen técnico, arquitectura (diagrama), decisiones y cómo correr pruebas; commits y PRs nuevos en inglés.
- Tablero en Linear (cuenta gratuita) con estas fases como tickets enlazados a los PRs.

## Orden recomendado y esfuerzo

1 → 3 → 2 → 4 → 5 → 6 → 7 → 9 → 8. Total ≈ 30–35 h; las fases 1–4 (≈ 15 h) cubren casi todo lo que la oferta pide como trabajo diario.

## Decisiones que quedan para el usuario

1. ¿Hacer pública una demo desplegada (Fase 9) o mantener el repo privado y mostrar capturas?
2. ¿Se traduce solo el README o también mensajes de commit/PR hacia adelante?
3. ¿Se incluye la Fase 8 (Cloud Run)? Es la de menor valor intrínseco para el producto.
4. Alcance de PDF: ¿recibo, presupuesto o ambos?

## Notas

- Basado en la oferta capturada el 2026-10-12 (284 postulaciones); el texto puede cambiar.
- Los estados «Cubierto/Parcial/Falta» salen de revisar el repo (`package.json`, `src/`, `supabase/`, `tests/`, ausencia de `.github/`).
