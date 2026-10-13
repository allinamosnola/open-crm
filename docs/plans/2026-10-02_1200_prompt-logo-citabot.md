# Prompt de logo y favicon de CitaBot Dental

Prompts para un generador de imágenes (Midjourney, DALL·E, Ideogram, Firefly, etc.). Los colores salen de
`src/app/globals.css` (paleta clínica: teal como marca; cada sección tiene su color).

## Qué es la app (para el generador)
CRM para consultorios dentales en México: agenda, pacientes y un bot de WhatsApp que agenda citas solo.
Nombre: **CitaBot Dental**. Tono: confiable, limpio, clínico pero cercano y tecnológico.

## Paleta (valores de la app, en hex)
| Uso | Color | Hex |
|---|---|---|
| Marca / primario (claro) | teal | `#007475` |
| Primario en tema oscuro | teal claro | `#45C4BD` |
| Fondo claro | blanco frío | `#F6FBFB` |
| Fondo suave de marca | teal muy claro | `#D5F2F1` |
| Texto / fondo oscuro | azul petróleo | `#0A1D26` / `#061116` |
| Acento Pacientes | azul | `#0961BB` |
| Acento Conversaciones | violeta | `#6E44BC` |
| Acento Configuración | ámbar | `#975800` |

Regla: teal dominante (≥ 80 %), un solo acento secundario como máximo (sugerido: violeta, por la conversación del bot).

## Prompt 1: logo principal (isotipo + wordmark)
```
Modern, bold, memorable logo for "CitaBot Dental", a SaaS for dental clinics whose WhatsApp chatbot books
appointments automatically. Symbol: a minimalist tooth silhouette whose negative space forms a speech bubble
with a small check mark (or a tiny calendar notch), combining tooth + chat + appointment into one simple
geometric mark. Flat vector style, smooth rounded corners, thick uniform strokes, subtle gradient from
#007475 to #45C4BD, optional tiny accent dot in #6E44BC. Wordmark "CitaBot" in a geometric sans-serif
(Geist / Inter / Poppins semibold) in #0A1D26, with "Dental" lighter weight in #007475, set to the right of
the symbol. Clean white-ish background #F6FBFB, generous padding, centered, no mockup, no 3D, no shadows,
no photo, no stock-icon look, high contrast, scalable, professional healthcare feel with a friendly tech vibe.
Vector logo, dribbble / behance quality.
```

## Prompt 2: isotipo cuadrado para favicon y redes sociales
```
App icon / favicon for "CitaBot Dental": only the symbol, no text. Minimalist tooth shape merged with a
speech bubble and a check mark, flat vector, ultra simple, readable at 16x16 px. Solid teal #007475 rounded
square (corner radius ~22 %) with the symbol in white #F6FBFB, centered with 20 % safe margin. Very bold
shapes, no fine details, no gradients, no text, no border. Square 1:1, 1024x1024.
```

## Variantes que conviene pedir
- **Tema oscuro:** mismo símbolo en `#45C4BD` sobre `#061116`.
- **Monocromo:** símbolo en un solo color (para sellos, WhatsApp Business y PDFs).
- **Avatar de redes:** símbolo blanco sobre círculo teal `#007475` (las redes recortan en círculo; margen de seguridad del 20 %).
- **Banner / portada:** logo horizontal sobre degradado `#007475` → `#061116`.

## Prompt negativo (si el generador lo admite)
```
text errors, misspelled letters, photorealistic, 3D render, glossy, drop shadow, complex details, realistic
teeth, gums, mouth, stock clipart, more than three colors, thin lines, clutter, watermark, mockup
```

## Entregables y tamaños
| Archivo | Tamaño | Uso |
|---|---|---|
| `logo.svg` | vectorial | Landing, panel, PDFs |
| `icon.svg` / `favicon.ico` | 16, 32, 48 px | Pestaña del navegador |
| `apple-icon.png` | 180x180 | iPhone / iPad |
| `icon-192.png`, `icon-512.png` | 192, 512 | PWA / Android |
| `avatar.png` | 1024x1024 (círculo) | Perfil de Instagram, Facebook, WhatsApp Business |
| `og-image.png` | 1200x630 | Vista previa al compartir el enlace |

## Después de generar
1. Probar el símbolo a 16 px: si no se lee, simplificar (quitar la palomita o el detalle interno).
2. Vectorizar (Illustrator, Figma o Vectorizer.ai) y exportar los tamaños de la tabla.
3. En Next.js (App Router) basta con poner `icon.svg` o `favicon.ico`, `apple-icon.png` y `opengraph-image.png`
   en `src/app/`; Next genera las etiquetas solas.
4. Revisar el contraste sobre `#F6FBFB` y sobre `#061116`.
