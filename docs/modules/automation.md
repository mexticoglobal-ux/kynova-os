# Módulo: Automation

| Estado | Área |
|--------|------|
| Planificado | Operaciones (`docs/DOMAIN.md` §12) |

## Objetivo
Eliminar trabajo repetitivo del tenant mediante flujos que se ejecutan solos, de forma fiable y auditable.

## Actores
- Responsables de área que diseñan flujos.
- Administradores del tenant que los autorizan.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Crear un flujo a partir de un disparador y una secuencia de acciones | Núcleo |
| Activar, pausar y desactivar flujos | Núcleo |
| Consultar el historial de ejecuciones y sus resultados | Núcleo |
| Crear flujos a partir de plantillas | Ampliación |
| Describir un flujo en lenguaje natural para que NEX lo construya | Ampliación |

## Fuera de alcance
- Conectores con servicios externos: los aporta Marketplace.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Flujo | Automatización formada por un disparador y una secuencia de acciones | Confidencial | Workspace |
| Disparador | Evento o programación que inicia un flujo | Interno | Workspace |
| Acción | Paso que ejecuta un flujo | Interno | Workspace |
| Ejecución | Registro de una ejecución de un flujo con su resultado | Confidencial | Workspace |

## Reglas de negocio
1. Un flujo con acciones de efecto externo requiere autorización previa del tenant para activarse.
2. Toda ejecución queda registrada con su resultado, incluso si falla.
3. Un flujo que falla de forma repetida se pausa y se notifica a su responsable.
4. Un flujo solo actúa sobre datos de su workspace.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Detectar tareas repetitivas automatizables | Sugerir |
| Construir flujos a partir de una descripción | Sugerir |
| Explicar por qué falló una ejecución | Informar |

## Dependencias
- **Consume de:** Marketplace y los módulos sobre los que actúa.
- **Provee a:** todos los módulos, Dashboard.

## Métricas
- Horas de trabajo ahorradas estimadas.
- Tasa de éxito de ejecuciones.
- Flujos activos por tenant.

## Preguntas abiertas
- Límites de ejecuciones por plan.
- Disparadores y acciones disponibles en la primera versión.
