---
description: Ejecuta la fase Brain sobre una tarea y entrega el brief de decisión sin editar archivos.
argument-hint: <descripción de la tarea>
---

Tarea: $ARGUMENTS

Ejecuta los pasos 1 a 5 de la fase Brain de `AGENTS.md` §4 sobre esta tarea. No edites ningún archivo.
Si la tarea es L o tiene banderas de datos, auth o infraestructura, trabaja en modo plan.

Entrega el brief con estos campos, ajustando la profundidad al tamaño:

| Campo | S | M | L |
|-------|---|---|---|
| Clasificación: tipo · tamaño · banderas | ✓ | ✓ | ✓ |
| Objetivo en una frase | | ✓ | ✓ |
| Alcance incluido y excluido | | ✓ | ✓ |
| Áreas y módulos afectados | | ✓ | ✓ |
| Workflow, Skills y agentes, con motivo | ✓ | ✓ | ✓ |
| Reutilización: qué existe y se aprovecha | | ✓ | ✓ |
| Chequeo de `AGENTS.md` §7 y ADRs vigentes | | ✓ | ✓ |
| Alternativas descartadas | | | ✓ |
| Fases con criterio de verificación | | | ✓ |
| ADR requerido | | si aplica | ✓ |
| Criterios de terminado | | ✓ | ✓ |
| Aprobación requerida | | si hay banderas | ✓ |

Si algo bloquea la decisión, haz solo las preguntas que cambian el resultado, cada una con una opción recomendada.
Termina indicando el siguiente paso: ejecutar, aprobar o responder preguntas.
