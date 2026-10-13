# Fase 4 — Resiliencia con APIs de terceros (reintentos)

Fecha: 2026-10-13 12:29 · Rama: `feat/retries` · Plan de origen: [2026-10-12_1748_brecha-puesto-valsnapp.md](2026-10-12_1748_brecha-puesto-valsnapp.md) (Fase 4)

## Qué se hizo

- `src/lib/retry.ts`: `withRetry(fn, options)` con backoff exponencial y jitter completo
  (`base * 2^(intento-1)`, tope `maxDelayMs`), `maxAttempts` configurable (3 por defecto),
  `Retry-After` / `retry-after-ms` respetados en 429/5xx. Solo errores transitorios: 408, 425, 429,
  500, 502, 503, 504, 529 (Anthropic sobrecargado), errores de red y timeouts. Si `Retry-After`
  pide más que `maxDelayMs` (8 s) se deja de reintentar: en un webhook con `maxDuration` es mejor
  dejar el fallo visible. `fetchWithRetry` (timeout por intento, devuelve la última respuesta al
  agotar intentos, respeta `x-should-retry: false` y no reintenta si quien llama abortó) y
  `createRetryingFetch` para la opción `fetch` de los SDK.
- Cada intento fallido se registra con `reportError` (tags `where` y `attempt`; extra `status`,
  `transient`, `will_retry`, `retry_after_ms`). `reportError` acepta ahora `tags` adicionales.
- **Twilio** (`sendWhatsApp` en `src/lib/whatsapp/twilio.ts`, usado por `outbound.ts` y la
  respuesta sin bot): reintenta 429/5xx y fallos de conexión donde la petición no salió
  (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`). **No** reintenta timeouts ni cortes a mitad de la
  petición: Twilio no acepta claves de idempotencia al crear mensajes y podría duplicar el WhatsApp
  al paciente. Ese caso queda `failed` y se puede reintentar a mano.
- **Resend** (`src/lib/notify/email.ts`): reintenta 429/5xx/timeouts (10 s por intento) con la
  misma `Idempotency-Key` en todos los intentos; sigue sin lanzar nunca.
- **Anthropic** (`src/lib/bot/agent.ts`): `createAnthropicClient()` con `maxRetries: 0` en el SDK y
  un `fetch` con reintentos. Se reintenta cada petición HTTP, no el loop del Tool Runner completo:
  así un 429 a mitad del turno no vuelve a ejecutar herramientas (p. ej. agendar dos veces).
- **Mensajes salientes fallidos**: ya quedaban visibles (`messages.status = 'failed'` +
  `error_code`, que el hilo muestra con `describeMessageError`). Se agregó el reintento manual sin
  cambiar el esquema: `redeliverFailedMessage` (outbound.ts) y la server action
  `retryFailedMessage(messageId)` (src/lib/db/conversations.ts). Pasa el mensaje de `failed` a
  `queued` con una actualización condicional (dos clics simultáneos no envían dos veces) y lo reenvía.

## Alcance recortado

- El **botón «Reintentar»** en el hilo de conversación es UI (`src/components`, carril frontend):
  queda pendiente. La acción ya está lista y probada; basta llamarla con el id del mensaje cuando
  `status === 'failed'` y `direction === 'out'`.
- No hay cola persistente ni reintentos en segundo plano (Vercel Cron): los reintentos son en línea
  y, al agotarse, el fallo queda visible para el reintento manual.

## Verificación

- `tests/retry/retry.test.ts`: backoff, `Retry-After` (segundos, fecha, ms), 429/503/timeout con
  reloj falso (`vi.useFakeTimers`), errores permanentes, agotamiento de intentos, abort.
- `tests/retry/providers.test.ts`: Twilio (429→ok, 503 persistente, 63016 permanente, timeout sin
  reintento), Resend (503→ok con la misma Idempotency-Key, timeouts, 429, 422) y Anthropic (429 con
  `retry-after-ms` + 529 → respuesta, 401 sin reintento) con el Tool Runner real y fetch simulado.
- `tests/whatsapp/outbound.test.ts` y `tests/panel/conversations.test.ts`: reintento manual.
- `npx tsc --noEmit`, `npx eslint`, `npx vitest run` en verde. Sin llamadas reales a proveedores.
