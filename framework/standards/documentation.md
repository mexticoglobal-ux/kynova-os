# Estándar: Documentación

> Fuente normativa: este documento. Aplica a toda la documentación del framework y del producto.

## Mapa de documentación
| Documento | Ubicación | Audiencia | Contenido |
|-----------|-----------|-----------|-----------|
| Reglas de agentes | `AGENTS.md` | IA | Reglas, flujo, clasificación, roles |
| Integración Claude | `CLAUDE.md` | IA | Uso de herramientas de Claude Code |
| Reglas por área | `.claude/rules/` | IA | Estándares obligatorios por ruta |
| Skills | `.claude/skills/` | IA | Procedimientos |
| Estado | `docs/STATE.md` | IA y equipo | Estado vivo, deuda, trabajo en curso |
| Dominio | `docs/DOMAIN.md` | IA y equipo | Lenguaje de negocio |
| Decisiones | `docs/decisions/` | IA y equipo | ADRs |
| Módulos | `docs/modules/` | IA y equipo | Alcance y contratos por módulo |
| Framework | `framework/` | Equipo | Catálogo, workflows, estándares y plantillas |

## Fuente única
Aplica los principios 3 y 6 de `AGENTS.md` §3: las referencias se hacen por ruta y sección.

## Idioma y estilo
1. Documentación en español; código, identificadores, nombres de archivo y mensajes de commit en inglés.
2. Documentación para IA: imperativa, breve y verificable.
3. Documentación para personas: clara y orientada a la tarea.
4. Términos de negocio según `docs/DOMAIN.md`.
5. Tablas y listas antes que párrafos largos.
6. Rutas relativas a la raíz del repositorio.

## Límites de tamaño
| Documento | Máximo |
|-----------|--------|
| `AGENTS.md` | 120 líneas |
| `CLAUDE.md` | 150 líneas |
| `SKILL.md` | 300 líneas |
| `docs/STATE.md` | Una pantalla por sección |

El detalle que excede el límite se mueve a documentos referenciados bajo demanda.

## Cuándo actualizar
| Cambio | Documento |
|--------|-----------|
| Foco, estado, deuda o trabajo en curso | `docs/STATE.md` |
| Decisión estructural | `docs/decisions/` |
| Concepto de negocio | `docs/DOMAIN.md` |
| Alcance o contrato de un módulo | `docs/modules/<módulo>.md` |
| Componente del framework | `framework/REGISTRY.md` y `framework/CHANGELOG.md` |

La documentación se actualiza en el mismo cambio que el código que la afecta.

## Calidad
1. Ningún documento describe algo que el código no hace.
2. Sin documentos huérfanos: todo documento está enlazado desde el mapa o desde `framework/REGISTRY.md`.
3. Plantillas oficiales en `framework/templates/`.
