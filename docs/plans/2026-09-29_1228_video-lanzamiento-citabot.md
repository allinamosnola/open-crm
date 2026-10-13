# Video de lanzamiento de CitaBot Dental (20 s)

Fecha: 2026-09-29 12:28 (CDMX). Estado: borrador de 20 s (1080p30) renderizado y verificado 2026-09-29 12:46; pendiente de aprobación para el render final 4K60.

## Qué es

Demo de funciones de 20 s hecha con la skill `onetake`. **No es una grabación de pantalla**: la interfaz se
reconstruye en HTML a partir de 9 capturas (7 de escritorio, 2 móviles) y cada valor es función del tiempo.
Solo texto en pantalla, en español, sin locución. Los borradores se renderizan a 1080p30; el 4K60 solo tras
aprobar el corte.

## Concepto elegido: "Una cita viaja"

Decisión del usuario: la opción A (la cita como único elemento que atraviesa la pieza), más la agenda en móvil
con el tema oscuro, y hasta 20 s en lugar de 15.

El bloque de la cita de Sofía Torres es lo que sobrevive a cada corte:

| t (s) | Beat | Qué se mueve | Qué carga al siguiente |
|---|---|---|---|
| 0.0–1.3 | Un hueco: el hueco de mié 12:00 en la agenda, casi quieto | palabras que aterrizan, un anillo dibuja el hueco | la cámara persigue el botón *Nueva cita* |
| 1.3–2.6 | La cámara viaja al botón y el cursor hace clic | whip de cámara, cursor | el botón se convierte en el modal |
| 2.6–5.3 | *Nueva cita*: Sofía Torres, 30/09 12:00–12:30, Limpieza | campos que se llenan, cursor | *Agendar cita*: el modal se colapsa |
| 5.3–5.9 | El modal se convierte en el bloque verde en el hueco | morph de contenedor, impacto | el bloque es lo que se toca |
| 5.9–7.3 | Reposo: agendado, anillo sobre el bloque | nada (reposo) | clic en el bloque |
| 7.3–8.9 | Iris desde el bloque abre la ficha de Sofía | iris, cámara, el menú pasa de verde azulado a azul | la ficha muestra *Próxima cita* |
| 8.9–12.0 | Ficha: alergias (Látex) y próxima cita, con anillos | cámara a las dos zonas | el bloque sale del chip *Próxima cita* |
| 12.0–13.5 | El bloque viaja y la ventana se estrecha a móvil | hop en arco, morph de ventana | aterriza en mié 12:00 de la agenda móvil |
| 13.5–15.8 | Agenda móvil en oscuro, reposo largo | nada (reposo) | el bloque salta al centro |
| 15.8–20.0 | Ráfaga *Agenda · Pacientes · Conversaciones* y marca *CitaBot Dental* | cortes duros, letras que caen | el bloque queda como subrayado de la marca |

Look: el del propio producto en tema oscuro (Geist y Geist Mono, tokens de `globals.css`), un color por sección.
Ritmo: tomas de 0.3 s a 2.4 s; reposos reales en 5.9–7.3 y 13.5–15.8.

## Datos que aparecen

Todo sale de las capturas (datos demo del seed): Consultorio Sonrisas, Dra. Ana López, Dentista temporal,
Sofía Torres (Látex, +525544445555, 30 ene 2001), Luis Flores, Carlos Hernández, Juan Pérez, José Ramírez.
La ficha de escritorio de Sofía **se reconstruye** con el diseño de la de Carlos Hernández y los datos de la
captura móvil; el chip *Próxima cita* en escritorio es una inferencia del diseño móvil.

## Textos que pone la pieza (no son del producto; revisar)

"Un hueco en la agenda.", "Agendado.", "Alergias a la vista.", "Próxima cita.", "También en el celular.",
"Agenda / Pacientes / Conversaciones", "CitaBot Dental".

## Entorno

`ffmpeg`, `playwright` y Chromium viven en un entorno aislado en el scratchpad de la sesión; no se instaló nada
en el Python base ni en el repo. Los archivos de la película están fuera del repo.

## Resultado

Borrador en `~/Desktop/citabot-lanzamiento/citabot-lanzamiento-borrador-1080p30.mp4` (20 s, H.264 + AAC, 5.9 MB) y el código en `fuente/`.
Verificación con `verify_promo.py`: cadencia (CV 0.28), reposo (2.58 s), ráfaga, audio (pico −8 dBFS, sin recortes), continuidad 1.00 y curvas, todo en PASS.
El render 4K60 tarda alrededor de 4× más y solo se hace tras aprobar el corte. El sonido es la paleta sintética de la skill; no hay música.

## Cambio 2026-09-29 (cortinilla de entrada)

Se añadió al inicio una cortinilla de 2.4 s igual a la del cierre (marca, subrayado y *Agenda · Pacientes · Conversaciones*). El subrayado se convierte en el anillo del hueco y el film arranca. Duración total: 22.4 s. Verificación en PASS. Archivo: `~/Desktop/citabot-lanzamiento/citabot-lanzamiento-1080p30.mp4` (sustituye al borrador de 20 s). Todos los tiempos de la tabla anterior se desplazan +2.4 s.

## Cambio 2026-09-29 (versión vertical 9:16)

Se generó una versión 1080×1920 del mismo film (22.4 s), conservando la horizontal. Es una copia de la composición con la cámara reencuadrada (primeros planos más cerrados, la agenda móvil a ~900 px de ancho), subtítulos a 190 px del borde superior para librar la zona que tapan las apps, y cierre con tipografía menor centrada. Archivo: `~/Desktop/citabot-lanzamiento/citabot-lanzamiento-vertical-1080x1920.mp4`; código en `fuente-vertical/`. Verificación en PASS.
