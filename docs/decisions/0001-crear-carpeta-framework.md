# ADR-0001: Crear la carpeta de primer nivel `framework/` para el catálogo, workflows, estándares y plantillas de KAF

| Campo | Valor |
|-------|-------|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-22 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | plataforma · módulo · dependencias |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
KAF v1 reparte su normativa entre `AGENTS.md`, `CLAUDE.md`, `.claude/rules/`, `.claude/skills/` y `docs/`.
No existía un lugar para el catálogo de componentes, el versionado del framework, los workflows detallados,
los estándares que las RULES no cubren y las plantillas reutilizables. `AGENTS.md` §7 exige un ADR para crear
una carpeta de primer nivel, y el principio de fuente única prohíbe duplicar contenido normativo.

## Problema
¿Dónde viven el catálogo, el versionado, los workflows, los estándares complementarios y las plantillas de KAF
sin duplicar las RULES ni la memoria del proyecto?

## Criterios de decisión
- Una única fuente normativa por tema.
- Contexto mínimo: nada se carga automáticamente si no es necesario en cada tarea.
- Preparación para extraer el framework como paquete reutilizable en versiones futuras.
- Separación clara entre framework de ingeniería y producto.

## Opciones consideradas

### Opción A: Carpeta `framework/` en la raíz
- **Ventajas:** agrupa todo el material del framework en un solo lugar, versionable y extraíble; no se carga automáticamente.
- **Inconvenientes:** añade una raíz de documentación y exige reglas explícitas para no duplicar las RULES.
- **Coste y esfuerzo:** bajo.

### Opción B: Repartir el contenido en `.claude/` y `docs/`
- **Ventajas:** no añade carpetas de primer nivel.
- **Inconvenientes:** mezcla material del framework con la memoria del proyecto y con archivos que Claude Code descubre automáticamente; dificulta su extracción.
- **Coste y esfuerzo:** bajo, con mayor coste de mantenimiento.

## Decisión
Opción A. Se crea `framework/` con `VERSION`, `CHANGELOG.md`, `REGISTRY.md`, `workflows/`, `standards/` y `templates/`.
Las RULES de `.claude/rules/` siguen siendo la fuente normativa de sus áreas; los estándares de `framework/standards/`
que coinciden con una regla solo la complementan y la referencian. La plantilla oficial de ADR sigue en
`docs/decisions/0000-template.md`.

## Consecuencias
- **Positivas:** catálogo y versionado explícitos; workflows y plantillas reutilizables; framework extraíble.
- **Negativas:** una ubicación más que mantener coherente.
- **Riesgos y mitigaciones:** riesgo de duplicación con las RULES, mitigado porque cada estándar declara su fuente normativa y `framework/REGISTRY.md` la registra.

## Impacto en el framework
- **Reglas no negociables (`AGENTS.md` §7) afectadas:** ninguna; este ADR cumple la regla 7.
- **RULES afectadas:** ninguna.
- **Skills afectados:** ninguno.
- **Módulos afectados:** ninguno.

## Plan de implementación
1. Crear `framework/` con su contenido inicial.
2. Registrar `framework/` en las referencias de `AGENTS.md` y en el orden de lectura y referencias de `CLAUDE.md`.

## Plan de reversión
Eliminar `framework/` y sus referencias en `AGENTS.md` y `CLAUDE.md`. Reversible en cualquier momento mientras
ningún otro componente dependa de su contenido.

## Verificación
- `framework/` existe con los componentes registrados en `framework/REGISTRY.md`.
- `AGENTS.md` y `CLAUDE.md` referencian `framework/`.
- Ningún estándar de `framework/standards/` duplica contenido normativo de `.claude/rules/`.

## Revisión
Al preparar la extracción del framework como paquete reutilizable o al publicar KAF v2.0.0.

## Referencias
- `AGENTS.md` §7
- `framework/REGISTRY.md`
- `framework/standards/documentation.md`
