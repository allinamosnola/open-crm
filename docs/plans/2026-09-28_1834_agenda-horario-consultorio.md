# Bloquear en la agenda los horarios fuera del horario del consultorio

## Context
La agenda (`src/components/calendar/agenda-calendar.tsx`) usa una rejilla fija (lun-sáb, 08:00-20:00) e ignora `clinics.business_hours`. Hoy se pueden crear o mover citas a horas en que el consultorio está cerrado (el único guard es el constraint de traslape en BD). Objetivo: que la agenda refleje el horario real, impida seleccionar/arrastrar fuera de él y que el servidor también lo rechace.

Formato del horario: `business_hours` = `{ mon: [["09:00","14:00"],["16:00","20:00"]], ... }` en hora local de `clinics.timezone`. Día sin clave o lista vacía = cerrado. Los descansos son rangos partidos.

## Cambios

1. **Helper puro** `isWithinBusinessHours(startsAt, endsAt, hours, tz)` — nuevo, exportado desde `src/lib/bot/slots.ts` (reusa `zonedParts`, `weekdayOf`, `toMinutes`, que hay que exportar). Devuelve true si inicio y fin caen en el mismo rango de un mismo día local. Si `hours` está vacío → true (sin configurar no se bloquea nada).

2. **`agenda/page.tsx`**: pasar `businessHours={clinic?.business_hours}` a `AgendaCalendar`.

3. **`agenda-calendar.tsx`**:
   - Convertir `BusinessHours` a la prop `businessHours` de FullCalendar (una entrada por rango: `daysOfWeek:[n]`, `startTime`, `endTime`); mapear `mon..sun` → 1..0.
   - `slotMinTime`/`slotMaxTime` = mínimo inicio / máximo fin de todos los rangos (fallback 08:00-20:00 si no hay horario).
   - `selectConstraint="businessHours"` y `eventConstraint="businessHours"` para bloquear selección, arrastre y resize fuera de horario. Sin horario configurado no se aplican.
   - `hiddenDays` según días cerrados (en vez de `[0]` fijo) o, si se prefiere, mantenerlos visibles y sombreados.
   - CSS: estilizar `.fc-non-business` con fondo gris/rayado para que se vea "bloqueado". `nextSlot()` ("Nueva cita") debe saltar al siguiente hueco dentro de horario, o abrir el diálogo sin hora predefinida si no hay.

4. **Validación en servidor** (`src/lib/db/appointments.ts`): en `createAppointment` y en `updateAppointment` (solo cuando llegan `starts_at`/`ends_at`, para que editar notas de una cita antigua no falle) cargar `getClinicSettings()` y rechazar con mensaje claro ("Ese horario está fuera del horario del consultorio") si `!isWithinBusinessHours`. El bot no se toca: ya solo ofrece huecos dentro de horario.

5. **Zona horaria**: el helper usa `clinics.timezone`; FullCalendar sigue con `timeZone="local"` (convención actual del panel). Si el navegador está en otra zona que el consultorio, la rejilla se desalinea. Se deja como limitación conocida (arreglarlo exige el plugin de zonas de FullCalendar).

## Archivos críticos
- `src/lib/bot/slots.ts` (helper), `src/lib/db/appointments.ts` (validación)
- `src/app/(panel)/agenda/page.tsx`, `src/components/calendar/agenda-calendar.tsx`
- Tests: `tests/bot/slots.test.ts` (helper: día cerrado, descanso, cruce de rango, fin exacto, DST/zona) y `tests/panel/` (conversión a businessHours de FullCalendar)

## Verificación
- `npm test` con los nuevos casos.
- `npm run dev` (NO `bot:dev`): en `/agenda`, con el horario del seed, comprobar que el sombreado coincide, que no se puede seleccionar/arrastrar en horas de descanso ni en domingo, y que "Nueva cita" cae en horario.
- Editar el horario en `/configuracion/consultorio` y comprobar que la agenda cambia.
- Probar crear/mover fuera de horario forzando el servidor (por ejemplo, editar la hora en el diálogo) y ver el toast de error.
- Sin horario configurado: la agenda se comporta como hoy.
- Al ejecutar, guardar este plan en `docs/plans/AAAA-MM-DD_HHMM_agenda-horario-consultorio.md` y registrarlo en `docs/plans/README.md` (según CLAUDE.md).
