# KYNOVA Premium UI — Design System v1.0

> Identidad: **azul petróleo + grafito + dorado premium**. Referencia viva en `/design-system` (no indexada). Fecha: 2026-11-05.

## Reglas

1. **Ningún color escrito a mano.** Los colores son variables por tema (`app/globals.css`) expuestas como utilidades de Tailwind (`bg-surface`, `text-ink-muted`, `border-line`...). No usar `white/N`, `zinc-*`, `black/N` ni hex.
2. **Ningún fondo negro ni blanco puro.** Lo comprueba `app/design-tokens.test.ts`.
3. **Reutilizar antes de crear.** Botones, tarjetas, badges, campos y encabezados salen de `components/ui/`. Si una pieza se repite, se añade ahí, no se copia.
4. **Contraste AA (4.5:1)** para el texto en los tres temas; también lo comprueba esa prueba.

## Temas

`premium` (por defecto), `dark` y `light` comparten **exactamente los mismos nombres de token**. Cambiar de tema es cambiar `data-theme` en `<html>`; ningún componente cambia. Hoy solo se ofrece Premium: el selector existe únicamente en `/design-system` y no guarda nada.

## Tokens

| Grupo | Tokens |
|-------|--------|
| Superficies | `canvas` (página), `surface` (tarjetas), `raised` y `raised-strong` (controles, hover), `shade` (campos), `scrim` |
| Líneas | `line`, `line-soft`, `line-strong` |
| Texto | `ink`, `ink-soft`, `ink-muted` |
| Marca | `primary` (azul petróleo), `primary-soft` (texto e iconos), `accent` (dorado), `accent-soft`, `on-primary`, `on-accent` |
| Estado | `success`, `warning`, `danger`, `danger-soft` |
| Sombras | `shadow-card`, `shadow-raised` |

## Componentes (`components/ui/`)

| Pieza | Uso |
|-------|-----|
| `Button` / `buttonClass` | Variantes `primary`, `secondary`, `accent`, `ghost`; tamaños `sm`, `md`, `lg`. `buttonClass` para enlaces |
| `Card` | Superficie estándar (`.card`) |
| `Badge` | Etiquetas en seis tonos |
| `IconBadge` | Icono enmarcado al inicio de una tarjeta |
| `PageHeader` | Encabezado de cada página de módulo |
| `Brand` | Marca KYNOVA (rombo dorado + nombre) |
| `choice.ts`, `form.ts` | Opciones seleccionables y campos (`.field`), etiquetas |
| `StatusBadge`, `KpiCard`, `Skeleton` | Construidos sobre los anteriores |

Gráficos (`components/charts/`): usan `stroke-primary-soft`, `stroke-line-soft` y el degradado petróleo→dorado; nunca colores fijos. Iconos: solo `lucide-react`, 16 px en línea y 20 px en navegación, siempre `aria-hidden`.

## Para añadir un tema

Copiar un bloque `[data-theme="..."]` de `globals.css` con todos los tokens, añadirlo a `THEMES` en `lib/theme.ts` y ejecutar las pruebas: validan que no falte ningún token y que el contraste sea AA.
