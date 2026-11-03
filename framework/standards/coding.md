# Estándar: Código

> Fuente normativa: este documento. Aplica a todo el código de KYNOVA OS.

## TypeScript
1. Modo estricto activado; ningún archivo lo desactiva.
2. Prohibido `any`; usar `unknown` y estrechar el tipo.
3. Prohibidas las aserciones no nulas y las aserciones de tipo sin validación previa.
4. Los datos externos (peticiones, base de datos, modelos de IA, servicios externos) se validan con esquemas antes de tiparse.
5. Tipos explícitos en funciones exportadas; inferencia en el ámbito local.
6. Uniones discriminadas para estados y resultados; sin banderas booleanas combinadas.

## Nombres
| Elemento | Convención |
|----------|------------|
| Componentes React | `PascalCase` |
| Funciones y variables | `camelCase` |
| Tipos e interfaces | `PascalCase` |
| Constantes globales | `UPPER_SNAKE_CASE` |
| Archivos y carpetas (no componentes) | `kebab-case` |
| Booleanos | Prefijo `is`, `has`, `can` o `should` |

Los nombres describen intención de negocio con los términos de `docs/DOMAIN.md`.

## Estructura
1. Una responsabilidad por archivo y por función.
2. Exportaciones con nombre; exportación por defecto solo donde Next.js la exige.
3. Imports absolutos con el alias `@/`; sin rutas relativas que suban más de un nivel.
4. Sin dependencias circulares.
5. Funciones puras siempre que sea posible; los efectos se aíslan en los bordes.

## Errores
1. Los errores esperados se modelan como resultados tipados; las excepciones quedan para lo inesperado.
2. Ningún `catch` vacío ni silencioso.
3. Los errores se registran una sola vez, en el borde, con contexto y sin datos sensibles.
4. Los mensajes al usuario son claros y no exponen detalles internos.

## Comentarios
1. El código se explica por sus nombres; los comentarios explican el porqué, no el qué.
2. Sin código comentado ni comentarios obsoletos.
3. Los pendientes se registran como deuda en `docs/STATE.md`, no como comentarios sueltos.

## Formato y calidad
1. Formato y lint automáticos con la configuración del repositorio; sin excepciones locales sin justificar.
2. Sin advertencias de typecheck ni de lint en el código entregado.

## Tests
| Nivel | Cubre | Obligatorio en |
|-------|-------|----------------|
| Unitario | Lógica pura, validaciones, utilidades | Toda lógica de negocio |
| Integración | API, acceso a datos, políticas RLS, capa de IA | Todo endpoint y toda política |
| End-to-end | Flujos críticos de usuario | Autenticación, flujos de cada módulo, NEX |
| Evals | Prompts y capacidades de IA | Todo prompt de producto |

Las pruebas son deterministas, independientes entre sí y sin dependencias de servicios reales de producción.

## Dependencias
1. Preferir la plataforma y las dependencias existentes antes que añadir nuevas.
2. Toda dependencia nueva cumple `.claude/rules/security.md` y, si es relevante, tiene ADR.
3. Versiones fijadas mediante lockfile.

## Commits
Conventional Commits en inglés y modo imperativo; un cambio lógico por commit.
