# KYNOVA Design System V3 (NOVA)

> Identidad: **un azul muy oscuro iluminado por azul eléctrico y cian**, tarjetas de vidrio, tipografía premium y un solo degradado para la acción principal. Referencia viva en `/design-system` (no indexada). Actualizado: 2026-11-10 (Sprint 29).

## Reglas

1. **Ningún color escrito a mano.** Los colores son variables por tema (`app/globals.css`) expuestas como utilidades de Tailwind (`bg-surface`, `text-ink-muted`, `border-line`...). No usar `white/N`, `zinc-*`, `black/N` ni hex (el único hex permitido está en `lib/theme.ts`: el color de la barra del navegador).
2. **Ningún fondo negro ni blanco puro.** Lo comprueba `app/design-tokens.test.ts`.
3. **Reutilizar antes de crear.** Botones, tarjetas, badges, campos, tablas, cifras y estados salen de `components/ui/`. Si una pieza se repite, se añade ahí, no se copia.
4. **Contraste AA (4.5:1)** para el texto en los dos temas, incluidos el texto sobre ambos extremos del degradado, sobre el cian y sobre el vidrio. Lo comprueban `app/design-tokens.test.ts` y `app/design-system-v3.test.ts`.
5. **El aspecto vive en un solo archivo** (`app/globals.css`). Un componente nunca restyla una pieza compartida: cambia la pieza.
6. **Solo UI/UX.** Un cambio de este sistema no toca lógica, contratos, KOE, NEX, el AI Gateway ni los Workers.

## Temas

`nova-dark` (por defecto) y `nova-light` comparten **exactamente los mismos nombres de token**. Cambiar de tema es cambiar `data-theme` en `<html>`; ningún componente cambia. El selector está en la barra superior y recuerda la elección en el dispositivo.

- **NOVA Dark:** lienzo `#060B18`, dos auras (azul y cian) detrás de la página, vidrio oscuro.
- **NOVA Light:** lienzo azul frío `#EDF2FC`, vidrio blanco, mismos azul y cian en tonos más profundos para que el texto cumpla AA.

## Tokens

| Grupo | Tokens |
|-------|--------|
| Superficies | `canvas` (página), `surface` (menús y superficies sólidas), `glass` (tinte de las tarjetas), `raised` y `raised-strong` (controles, hover), `shade` (campos, barras de pestañas), `scrim` |
| Líneas | `line`, `line-soft`, `line-strong` |
| Texto | `ink`, `ink-soft`, `ink-muted` |
| Marca | `primary` (azul eléctrico), `primary-deep` (fin cian del degradado), `primary-soft` (texto e iconos), `accent` (cian eléctrico), `accent-soft`, `on-primary`, `on-accent` |
| Estado | `success`, `warning`, `danger`, `danger-soft` |
| Luz | `aurora-a`, `aurora-b`, `aurora-strength` |
| Sombras | `shadow-card`, `shadow-raised`, `shadow-glow` |

## Piezas compartidas

| Pieza | Qué es |
|-------|--------|
| `.card` / `Card` | **Vidrio:** tinte translúcido con desenfoque y borde suave. Sólida donde no hay `backdrop-filter` o la persona pide menos transparencia |
| `Button` / `buttonClass` | `primary` (degradado eléctrico con brillo), `secondary` (vidrio), `accent` (cian), `ghost`; tamaños `sm`, `md`, `lg`; esquinas de 14 px |
| `.field`, `.field-sm`, `form.ts` | Campos con hueco interior y anillo cian de 3 px al enfocar |
| `Badge` | Seis tonos con relleno suave y borde interior fino; `dot` añade una luz de estado. `StatusBadge` la usa siempre |
| `Tabs` | Barra segmentada; la pestaña activa lleva el degradado |
| `Table` | Marco con borde, encabezado discreto, separadores, cebra suave y resalte al pasar |
| `Stat` / `KpiCard` | Etiqueta tenue, cifra grande en la tipografía de títulos y una línea de luz arriba |
| `PageHeader` | Encabezado de cada módulo sobre una tarjeta con la luz azul y cian |
| Navegación (`.nav-item`) | Barra lateral y menú móvil comparten un ítem; el actual lleva una barra de luz y un baño azul. Barra superior de vidrio (`.app-header`) |
| `EmptyState` | Halo que respira despacio detrás del icono |
| `Skeleton`, `SkeletonPage` | Brillo cian suave mientras carga |
| `IconBadge`, `ProductMark`, `Brand` | Iconos y marcas con baño eléctrico y borde fino |
| `Dialog` | Tarjeta de vidrio sobre un velo desenfocado; atrapa el foco |

## Tipografía

Dos familias, ambas con `display: swap`: **Inter** para el texto y **Manrope** (una sola fuente variable, solo latín) para títulos (`h1`–`h3`), marca y cifras. Las cifras usan números tabulares y un tamaño que escala con la pantalla (`clamp`).

## Movimiento, accesibilidad y rendimiento

- **Animaciones:** `page-in`, `pop-in`, `fade-up`, `shimmer` y las dos nuevas, `fade-in` y `breathe` (lenta y suave). `prefers-reduced-motion` las desactiva todas.
- **Un solo anillo de foco** (`:focus-visible`) para todo el producto; los campos añaden el suyo en cian. Enlace "saltar al contenido" siempre disponible.
- **Transparencia:** `prefers-reduced-transparency` y los navegadores sin desenfoque reciben tarjetas sólidas, así que el texto nunca depende de lo que haya detrás.
- **Rendimiento:** el fondo de auras es una sola capa fija (`body::before`) que no hace scroll ni bloquea clics; solo se añade una fuente (Manrope variable, latín); no hay imágenes ni dependencias nuevas.
- **Responsive:** las cifras y el espaciado escalan; las tablas se desplazan dentro de su caja; la barra lateral se pliega y en el teléfono pasa a un menú.

## Cómo se comprueba

`app/design-tokens.test.ts` (mismos tokens en los dos temas, sin blanco ni negro puro, contraste), `app/design-system-audit.test.ts` (una sola pieza por trabajo, ningún color suelto, un solo anillo de foco, movimiento reducido) y `app/design-system-v3.test.ts` (la identidad: azul muy oscuro, azul y cian, sin dorado, degradado con texto legible, vidrio con respaldo sólido, tablas, navegación, tipografía y colores de la barra del navegador y del ícono).
