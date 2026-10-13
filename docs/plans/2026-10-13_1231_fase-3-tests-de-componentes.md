# Fase 3 — Pruebas de componentes

Fecha: 2026-10-13 12:31 · Rama: `feat/component-tests` (parte de `feat/ci`) · Plan padre: [2026-10-12_1748_brecha-puesto-valsnapp.md](2026-10-12_1748_brecha-puesto-valsnapp.md)

## Alcance

- Dependencias de desarrollo: `@testing-library/react`, `@testing-library/dom`,
  `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`.
- `vitest.config.ts` con dos proyectos: `server` (los tests existentes, entorno Node, sin cambios) y
  `components` (`tests/components/**/*.test.tsx`, jsdom, `tests/components/setup.ts` con los
  matchers de jest-dom, limpieza entre tests y los polyfills que Radix/cmdk piden a jsdom).
- Se mockean en cada test las server actions (`@/lib/db/*`, `@/lib/stripe/public-checkout`), el
  cliente de Supabase del navegador, `next/navigation` y `sonner`. No se cambió código de `src/`.

## Cobertura

| Componente | Casos |
| --- | --- |
| `marketing/plan-checkout-form` | plan enviado, complemento Bot solo en Básico, campo trampa vacío, estado «Abriendo el pago…», error de la acción y reintento |
| `auth/login-form` | campos vacíos sin llamar a Supabase, éxito → `/agenda`, traducción de errores (credenciales, correo sin confirmar, 429, genérico), sin conexión, estado pendiente, enlace de recuperación |
| `patients/patient-form` | nombre obligatorio con `aria-invalid`/`aria-describedby`, teléfono y correo inválidos, alta con teléfono normalizado y navegación a la ficha, errores del servidor, edición con `updatePatient`, solo lectura |
| `calendar/appointment-create-dialog` | paciente y dentista obligatorios, alta con el hueco elegido, elegir otro dentista (Radix Select), mover el inicio conserva la duración, fin antes del inicio, traslape rechazado por el servidor, búsqueda de pacientes fallida, Cancelar |
| `conversations/conversation-thread` | autor/estado/error de Twilio por burbuja, vacío, no envía en blanco, envío y recarga, Ctrl+Enter, envío fallido conserva el texto, pausar/reanudar bot y su error, marcar leído, solo lectura, paciente sin nombre, cierre de Realtime |

## Verificación

- `npx vitest run`: 24 archivos, 229 pruebas (192 de servidor sin cambios + 37 de componentes).
- Prueba de mutación manual: quitar el mensaje «Elige un dentista» y cambiar el texto de credenciales
  incorrectas hace fallar exactamente las dos pruebas correspondientes (se revirtió).
- `npx tsc --noEmit` y `npx eslint` en verde. El job `checks` del CI ya corre ambos proyectos.

## Notas

- React 19 entrelaza las acciones asíncronas pendientes entre raíces: una prueba que deja una acción
  colgada bloquea las siguientes; por eso la de «Abriendo el pago…» resuelve su promesa al final.
- Regla para lo que sigue: cada bug de UI corregido añade su prueba aquí.
