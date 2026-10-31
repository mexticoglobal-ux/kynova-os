# Estándar: UI

> Fuente normativa: `.claude/rules/ui.md`. Este documento solo añade lo que la regla no cubre; no la repite.

## Identidad visual
1. Estética oscura con superficies translúcidas como lenguaje base de KYNOVA OS.
2. Los tokens de color, tipografía, radio, sombra y espaciado se definen una sola vez en `tailwind.config.ts`.
3. Toda superficie, estado y acento usa tokens semánticos (primario, éxito, advertencia, error, superficie, texto); nunca colores literales.
4. Los gráficos y visualizaciones usan una paleta semántica única, legible en tema oscuro y claro.

## Sistema de componentes
1. Los componentes base compartidos (botón, campo, selector, tabla, tarjeta, modal, navegación, estado vacío, estado de error, esqueleto de carga) viven en `components/` y son la única implementación de su patrón.
2. Cada componente base expone variantes y tamaños cerrados; no se crean variantes locales.
3. Un patrón repetido en dos módulos se promueve a componente base.

## Patrones de interacción
1. Acciones destructivas con confirmación explícita y descripción de su efecto.
2. Formularios con validación en línea, mensajes junto al campo y preservación de lo introducido ante errores.
3. Acciones asíncronas con estado de progreso y bloqueo de envíos duplicados.
4. Las acciones propuestas por NEX se presentan siempre como sugerencias que el usuario confirma.
5. Navegación consistente: la misma acción ocupa la misma posición en todos los módulos.

## Contenido
1. Los textos de interfaz usan los términos de `docs/DOMAIN.md`.
2. Tono claro, directo y orientado a la acción; sin jerga técnica.
3. Los textos visibles se centralizan para permitir la internacionalización.
4. Fechas, números y monedas se formatean según la configuración regional del tenant.

## Temas y escalado
1. La interfaz está preparada para tema oscuro y claro mediante tokens.
2. Preparada para personalización de marca por tenant sin modificar componentes.

## Verificación
1. Auditoría automática de accesibilidad sin errores, además del checklist de `.claude/rules/ui.md`.
