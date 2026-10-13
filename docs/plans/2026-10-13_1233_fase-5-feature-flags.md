# Fase 5 — Feature flags

Fecha: 2026-10-13 12:33 · Rama: `feat/feature-flags` (sale de `feat/retries`) · Plan de origen: [2026-10-12_1748_brecha-puesto-valsnapp.md](2026-10-12_1748_brecha-puesto-valsnapp.md) (Fase 5)

## Qué se hizo

- Migración `20261101000001_feature_flags.sql`:
  - Tabla `feature_flags (flag, account_id, enabled, note)`; `account_id` null = valor global.
    `unique nulls not distinct (flag, account_id)`: un global y uno por cuenta como máximo.
    Nombre en snake_case (check).
  - RLS activa **sin políticas** y `revoke all` a `anon`/`authenticated`: como `accounts`, la
    administra solo el dueño del SaaS con la service role.
  - `feature_enabled(flag, account_id)` (solo service role): excepción de la cuenta > global >
    apagado.
  - `my_feature_enabled(flag)` (authenticated): el mismo valor para la cuenta del consultorio
    activo; nunca deja consultar otra cuenta.
- `src/lib/flags.ts`: `FLAGS` (nombres conocidos), `isEnabled(flag, accountId)` con la service role
  e `isEnabledForSession(flag, supabase)` con la sesión. Ante un error de la base, apagado (falla
  cerrado) y `reportError`.
- `scripts/set-flag.ts` (`npm run flag:set`): encender/apagar/borrar global o por cuenta
  (`--account` o `--clinic <slug>`), sin redeploy.
- Primer flag: `pdf_documents` (recibo y presupuesto en PDF, Fase 6), **apagado por defecto** (sin
  filas en la migración ni en la seed).
- `src/types/database.ts` editado a mano (no hubo Docker para `npm run db:types`).

## Decisiones tomadas en la implementación

- El personal no lee la tabla: el panel recibe el valor resuelto (servidor). Si después se quiere
  mostrar flags en la UI, basta `my_feature_enabled`.
- Sin caché: es una consulta por índice por request; si se usa en rutas calientes, envolver con
  `cache()` de React por request.

## Verificación

- `tests/flags/flags.test.ts` (vitest): contrato del helper con rpc simulado.
- `supabase/tests/feature_flags.test.sql` (pgTAP, 18 aserciones): apagado por defecto, piloto por
  cuenta, global, excepción sobre global, unicidad, upsert del script, permisos de `authenticated`
  y `anon`, aislamiento entre cuentas.
- Docker no estaba corriendo: **no** se ejecutó `npx supabase db reset` ni `npx supabase test db`.
  En su lugar, migraciones + seed + todos los pgTAP corrieron en PGlite (Postgres 17 en WASM) con
  `@electric-sql/pglite-pgtap` y stubs mínimos de `auth`/roles de Supabase, en un directorio local
  no versionado: 4/4 archivos OK.
- `npx tsc --noEmit`, `npx eslint`, `npx vitest run` en verde.
