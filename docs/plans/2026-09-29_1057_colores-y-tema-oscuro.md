# Plan: paleta profesional/amigable + tema claro/oscuro + pestaña activa evidente

## Context
El panel (Next.js + Tailwind v4 + shadcn) usa tokens neutros sin croma en `src/app/globals.css`; se ve gris/negro y no transmite "consultorio". Los tokens `.dark` y las variantes `dark:` ya existen, pero **no hay `ThemeProvider` ni toggle** (`next-themes` está instalado y solo lo usa `ui/sonner.tsx`), así que el modo oscuro nunca se activa. La pestaña activa del sidebar solo cambia a `bg-sidebar-accent` (poco distinguible).

## Decisiones de diseño
- **Marca**: teal/verde-azulado clínico (confianza, limpieza) como `--primary`; fondos con leve tinte frío en vez de blanco/negro puros; radio actual (0.625rem) se mantiene. Contraste AA en ambos temas.
- **Color por sección** (identifica dónde estás): Agenda = teal, Pacientes = azul, Conversaciones = violeta, Configuración = ámbar/slate. Se expone como tokens `--section-agenda|pacientes|conversaciones|config` (+ `-soft` para fondos) en `:root` y `.dark`, registrados en `@theme inline`.
- **Estados semánticos** nuevos: `--success`, `--warning`, `--info` (+ foreground/soft) para reemplazar los amber/emerald/sky/red sueltos.

## Cambios
1. `src/app/globals.css`
   - Reescribir tokens de `:root` y `.dark` (oklch con croma: primary teal, accent suave, sidebar tintado, ring, chart-1..5, border).
   - Añadir tokens de sección y de estado; mapearlos en `@theme inline`.
   - Los overrides de FullCalendar (`.agenda-calendar .fc`) ya leen variables; solo verificar `--fc-today-bg-color` y `.fc-non-business` en ambos temas.
2. Tema claro/oscuro
   - Crear `src/components/theme-provider.tsx` (wrapper client de `next-themes`, `attribute="class"`, `defaultTheme="system"`, `enableSystem`).
   - `src/app/layout.tsx`: envolver `children`/`Toaster` con el provider y añadir `suppressHydrationWarning` a `<html>`. (Antes: leer `node_modules/next/dist/docs/` por el aviso de CLAUDE.md sobre cambios en Next.)
   - Crear `src/components/layout/theme-toggle.tsx` (Claro / Oscuro / Sistema, dropdown con `ui/dropdown-menu`, iconos Sun/Moon/Monitor de lucide); colocarlo en el pie del sidebar de `src/app/(panel)/layout.tsx` junto a `SoundToggle`, y en la página de login (esquina superior).
   - `ui/sonner.tsx` ya usa `useTheme`; queda funcionando.
   - `src/app/global-error.tsx`: sin provider, dejar estilos neutros legibles en ambos temas (`prefers-color-scheme`).
3. Pestaña activa (`src/components/layout/sidebar-nav.tsx`)
   - Añadir `section` a cada entrada de `LINKS`. Ítem activo: fondo `*-soft` de su sección, barra vertical de 3px a la izquierda, icono con el color de la sección y texto en semibold; inactivos con icono atenuado y hover suave. Mantener `aria-current="page"` y la lógica `pathname.startsWith`.
   - Encabezado de página con acento de la sección (opcional, pequeño: línea/chip del mismo color) — solo si no requiere tocar cada página; si sí, omitir.
   - `ui/tabs.tsx` (pestañas de paciente): trigger activo con subrayado/fondo en `--primary` (o azul de sección Pacientes).
4. Reemplazar colores hardcodeados por tokens (todos ya tienen par `dark:` hoy)
   - `src/components/status-badge.tsx` (mapa `TONE`), `(panel)/layout.tsx:72`, `sidebar-nav.tsx:180`, `pacientes/[id]/page.tsx` (203, 213, 231, 234), `configuracion/{personal,consultorio}/page.tsx`, `conversations/{attention-banner,conversation-list,conversation-thread}.tsx`, `clinic/clinic-settings-form.tsx:322`.
5. Calendario (`src/components/calendar/agenda-calendar.tsx`)
   - Los hex de `DENTIST_COLORS` / `STATUS_COLORS` (líneas 48-56) van inline y no reaccionan al tema. Ajustar a tonos con buen contraste en ambos fondos y usar `color-mix` con `--card`/borde para el fondo; texto blanco solo si el contraste lo permite.
6. Login (`src/app/login/page.tsx`): fondo con degradado sutil de marca, marca "CitaBot Dental" con icono/acento teal, toggle de tema.

## Fuera de alcance
Lógica de negocio, Supabase/bot, la inconsistencia `import { cn } from "cn"` vs `@/lib/utils` (anotar, no tocar). No ejecutar el bot real.

## Archivos críticos
`src/app/globals.css`, `src/app/layout.tsx`, `src/app/(panel)/layout.tsx`, `src/components/layout/sidebar-nav.tsx`, `src/components/ui/{tabs,sonner}.tsx`, `src/components/status-badge.tsx`, `src/components/calendar/agenda-calendar.tsx`, nuevos `theme-provider.tsx` y `theme-toggle.tsx`.

## Verificación
- `npm run build` y lint/typecheck sin errores.
- `npm run dev` (NO `bot:dev`) y revisar en el navegador integrado: /login, /agenda, /pacientes, /pacientes/[id] (pestañas), /conversaciones, /configuracion/* en claro y oscuro; alternar Claro/Oscuro/Sistema, recargar (persistencia sin parpadeo), ancho tablet (sidebar de solo iconos: el activo debe seguir viéndose).
- Comprobar contraste AA de texto sobre primary, badges y eventos del calendario en ambos temas.
- Guardar copia de este plan en `docs/plans/` con timestamp AAAA-MM-DD_HHMM y registrar en `docs/plans/README.md` (regla del proyecto), sin sobrescribir.
- Tras aprobar: publicar una maqueta de la paleta como Design artifact para revisión visual antes de codificar los tokens finales.
