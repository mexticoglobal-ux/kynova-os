# Módulo: Dashboard

| Estado | Área |
|--------|------|
| Prototipo | Núcleo |

## Objetivo
Dar al responsable del negocio una visión inmediata del estado de su empresa y de las acciones prioritarias del día.

## Actores
- Dirección o propietario del negocio.
- Responsables de área.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Consultar el Business Health Score y su desglose por área | Núcleo |
| Ver los indicadores clave del día frente al periodo anterior | Núcleo |
| Revisar y aceptar o descartar acciones recomendadas por NEX | Núcleo |
| Personalizar los indicadores visibles | Ampliación |

## Fuera de alcance
- Análisis en profundidad e informes: corresponden a Analytics.
- Edición de datos de negocio: se realiza en cada módulo.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Business Health Score | Ver `docs/DOMAIN.md` §1 | Confidencial | Tenant |
| Acción recomendada | Ver `docs/DOMAIN.md` §1 | Confidencial | Tenant |
| Indicador del día | Valor de un indicador clave en el periodo actual y su variación | Confidencial | Tenant |

## Reglas de negocio
1. Cada área del Business Health Score muestra de qué datos procede su puntuación.
2. Las acciones recomendadas se ordenan por impacto estimado.
3. Un área sin datos suficientes se muestra como no evaluada, nunca con una puntuación inventada.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Resumen diario del negocio | Informar |
| Acciones recomendadas priorizadas | Sugerir |

## Dependencias
- **Consume de:** Analytics, Finance, Sales, Marketing, Automation, NEX.
- **Provee a:** —

## Métricas
- Usuarios activos diarios del Dashboard.
- Porcentaje de acciones recomendadas aceptadas.

## Preguntas abiertas
- Fórmula y ponderación de cada área del Business Health Score.
- Indicadores clave por defecto según el tipo de negocio.
