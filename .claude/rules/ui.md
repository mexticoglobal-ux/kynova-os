---
paths:
  - "app/**"
  - "components/**"
  - "tailwind.config.ts"
---

# Regla UI

## Propósito
Garantizar una interfaz consistente, accesible, rápida y alineada con la identidad visual de KYNOVA OS.

## Cuándo se activa
Al crear o modificar páginas, layouts, componentes, estilos o navegación en `app/`, `components/` o `tailwind.config.ts`.

## Reglas obligatorias
1. Server Components por defecto; `"use client"` solo si hay estado, efectos, eventos o animación.
2. La frontera cliente se mantiene lo más baja posible en el árbol de componentes.
3. Estilos solo con Tailwind; sin estilos inline ni hojas de estilo nuevas fuera de `app/globals.css`.
4. Colores, tipografía, espaciados y radios salen de los tokens de `tailwind.config.ts`; sin valores arbitrarios repetidos.
5. Clases condicionales con `clsx`; iconos solo de `lucide-react`; animaciones solo con Framer Motion.
6. Toda animación respeta `prefers-reduced-motion`.
7. Accesibilidad WCAG 2.2 AA: HTML semántico, etiquetas en controles, foco visible, navegación por teclado y contraste suficiente.
8. Todo componente que carga datos contempla los estados de carga, vacío y error.
9. Los componentes no contienen lógica de negocio; reciben datos del servidor o de la API según los contratos.
10. Componentes de un único módulo viven en ese módulo; pasan a `components/` solo cuando los usan dos o más módulos.
11. La navegación tiene una única fuente: `config/site.ts`.
12. Diseño responsive mobile-first, funcional desde 360 px sin scroll horizontal.
13. Imágenes con `next/image`; fuentes con `next/font`.
14. Toda ruta pública define metadatos propios (título y descripción).

## Checklist
- [ ] Se buscó un componente existente antes de crear uno nuevo.
- [ ] `"use client"` justificado o ausente.
- [ ] Sin colores ni medidas fuera de los tokens.
- [ ] Estados de carga, vacío y error implementados.
- [ ] Navegable con teclado y con foco visible.
- [ ] Contraste AA verificado.
- [ ] `prefers-reduced-motion` respetado.
- [ ] Correcto en 360 px, tablet y escritorio.
- [ ] Metadatos definidos en rutas públicas.

## Definición de terminado
Verificación de `AGENTS.md` §7.9 en verde y checklist completo.

## Referencias
- Acceso a datos e IA: `AGENTS.md` §7.2–7.4.
- Identidad visual, componentes base y patrones: `framework/standards/ui.md`.
- Especificación de páginas: `framework/templates/page.md`.
