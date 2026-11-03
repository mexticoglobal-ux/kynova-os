# Plantilla: ADR

> Plantilla oficial: `docs/decisions/0000-template.md`. Este documento define su uso; no la duplica.

## Cuándo crear un ADR
Ante cualquier disparador de `framework/standards/architecture.md` o cuando `AGENTS.md`, una regla o un Skill lo exigen.

## Procedimiento
1. Copiar `docs/decisions/0000-template.md` a `docs/decisions/NNNN-titulo-en-kebab-case.md`.
2. `NNNN` es el siguiente número libre, con cuatro dígitos; los números nunca se reutilizan.
3. El título expresa la decisión, no el problema.
4. Completar todas las secciones; las que no aplican indican "No aplica" y el motivo.
5. Rellenar la fila **Etiquetas** para permitir la búsqueda por tema.
6. Crear con estado **Propuesto** y presentarlo para aprobación junto al brief.
7. Al aprobarse, cambiar a **Aceptado** en el mismo cambio que inicia su implementación.

## Ciclo de vida
| Estado | Transición |
|--------|------------|
| Propuesto | → Aceptado o Rechazado |
| Aceptado | → Deprecado o Sustituido |
| Sustituido | Indica el ADR que lo sustituye; el ADR nuevo indica a cuál sustituye |

## Reglas
1. Un ADR aceptado no se edita salvo para cambiar su estado y sus enlaces de sustitución.
2. Cambiar una decisión aceptada exige un ADR nuevo que la sustituya.
3. Todo ADR aceptado se enlaza desde el pull request que lo implementa.
