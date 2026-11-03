# Workflow: Feature

> Base: `AGENTS.md` §4, workflows W2 (M) y W3 (L). Este documento detalla su ejecución; ante conflicto prevalece `AGENTS.md`.

## Propósito
Entregar funcionalidad nueva o ampliada de forma planificada, verificada y coherente con la arquitectura.

## Cuándo aplica
Toda funcionalidad nueva o ampliación de una existente clasificada como M o L.
Las tareas S siguen W1 sin este documento.

## Roles y Skills

| Fase | Rol | Skill |
|------|-----|-------|
| Análisis y decisión | Brain · Explorer · Planner | — |
| Datos | Brain | `kyn-data` |
| IA | Brain | `kyn-ai` |
| Módulo multicapa | Brain | `kyn-module` |
| Revisión | Reviewer · Security | — |
| Cierre | Brain | `kyn-ship` |

## Pasos

### 1. Fase Brain
Pasos 1–5 de `AGENTS.md` §4, con estas precisiones para features:
1. El contexto incluye `docs/modules/<módulo>.md` del módulo afectado.
2. El brief declara qué casos de uso del documento de módulo se entregan.
3. En L: plan por fases con criterio de verificación por fase, alternativas descartadas y ADR si hay decisión estructural.

### 2. Aprobación
Gate según `AGENTS.md` §4 (tabla de workflows) y `CLAUDE.md` §3.

### 3. Ejecución
1. Crear la rama de la tarea.
2. Construir por capas en orden: datos → contratos → servidor → API → IA → interfaz.
3. Verificar al cerrar cada capa o fase.
4. Si el alcance o el tamaño crecen, detener y volver a la fase Brain con un brief nuevo.

### 4. Verificación y revisión
1. Verificación de `AGENTS.md` §7.9 en verde, más evals si cambió la IA.
2. Revisiones según `CLAUDE.md` §7.
3. Criterios de terminado del brief cumplidos uno por uno.

### 5. Cierre
Aplicar `kyn-ship`: memoria, commits, pull request con `framework/templates/pr.md` y despliegue solo con aprobación.

## Definición de terminado
Funcionalidad dentro del alcance aprobado, verificaciones en verde, revisiones sin hallazgos altos o críticos,
memoria y documentación del módulo actualizadas, y pull request creado.

## Salida
Brief aprobado, cambios en rama, pull request, ADRs y memoria actualizados, e informe de cierre de `kyn-ship`.
