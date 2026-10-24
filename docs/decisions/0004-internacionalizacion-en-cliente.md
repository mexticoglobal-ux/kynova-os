# ADR-0004: Internacionalizar la interfaz con diccionarios tipados en cliente y español por defecto

| Campo | Valor |
|-------|-------|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-23 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | ui · plataforma |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
La interfaz mezcla textos en inglés y español fijos en el código. El producto debe ofrecerse en español (por defecto),
inglés, francés, alemán, italiano, portugués, japonés y chino; el cambio de idioma debe ser inmediato, sin recargar,
y la preferencia debe recordarse en el navegador. El despliegue es estático sobre Cloudflare Workers (ADR-0002).

## Problema
¿Cómo se traducen todas las vistas a 8 idiomas con cambio instantáneo, sin dependencias nuevas y sin romper el
renderizado estático?

## Criterios de decisión
- Cambio de idioma inmediato y persistente.
- Sin dependencias nuevas.
- Diccionarios completos verificables por tipos y tests.
- Coste mínimo de JavaScript para el idioma por defecto.

## Opciones consideradas

### Opción A: Diccionarios tipados en cliente
- **Ventajas:** cambio instantáneo; sin dependencias; el español se renderiza en servidor; los demás idiomas se cargan bajo demanda.
- **Inconvenientes:** solo el español es indexable por buscadores; un visitante con otro idioma guardado ve el español durante la hidratación.
- **Coste y esfuerzo:** medio.

### Opción B: Rutas por idioma con `next-intl`
- **Ventajas:** los 8 idiomas indexables con `hreflang`.
- **Inconvenientes:** dependencia nueva; reestructura todas las rutas; el cambio de idioma navega a otra URL.
- **Coste y esfuerzo:** alto.

## Decisión
Opción A. Los textos viven en `lib/i18n/messages/<idioma>.ts`; `es.ts` define la forma (`Messages`) y el resto de idiomas
la cumplen por tipo. Un proveedor de cliente expone los mensajes, guarda la preferencia en `localStorage`
(`kynova.locale`), actualiza `<html lang>` y carga los idiomas distintos del español bajo demanda. Los metadatos SEO
se generan en servidor en español. Ningún componente contiene textos visibles fijos.

## Consecuencias
- **Positivas:** interfaz sin textos mezclados; idiomas añadibles sin tocar componentes.
- **Negativas:** SEO limitado al español; las páginas con texto dependen de componentes de cliente.
- **Riesgos y mitigaciones:** diccionarios incompletos, mitigado con el tipo `Messages` y un test de paridad de claves.

## Impacto en el framework
- **Reglas no negociables (`AGENTS.md` §7) afectadas:** ninguna.
- **RULES afectadas:** `ui` (los textos visibles salen siempre del diccionario).
- **Skills afectados:** `kyn-module` (los módulos usan `lib/i18n`).
- **Módulos afectados:** todos.

## Plan de implementación
1. Crear `lib/i18n/` con configuración, diccionarios y carga bajo demanda.
2. Crear el proveedor y el selector de idioma en `components/i18n/`.
3. Migrar todas las vistas a los diccionarios.
4. Añadir el test de paridad de diccionarios.

## Plan de reversión
Sustituir el proveedor por textos fijos en español. Reversible mientras no exista contenido indexado por idioma.

## Verificación
- Ningún texto visible fijo en componentes.
- Test de paridad de los 8 diccionarios en verde.
- El cambio de idioma se aplica sin recargar y persiste tras recargar.

## Revisión
Cuando se necesite posicionamiento orgánico en un idioma distinto del español.

## Referencias
- `.claude/rules/ui.md`
- `framework/standards/ui.md`
