# Módulo: Analytics

| Estado | Área |
|--------|------|
| Planificado | Inteligencia |

## Objetivo
Convertir los datos de todos los módulos en indicadores e informes que expliquen cómo evoluciona el negocio.

## Actores
- Dirección.
- Responsables de área.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Consultar indicadores por área y periodo | Núcleo |
| Comparar periodos y detectar tendencias | Núcleo |
| Crear y guardar informes | Ampliación |
| Programar el envío periódico de informes | Ampliación |
| Exportar datos de informes | Ampliación |

## Fuera de alcance
- Vista resumida diaria: corresponde a Dashboard.
- Edición de los datos de origen.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Indicador | Medida de negocio con definición, fuente y periodicidad | Interno | Plataforma o tenant |
| Informe | Conjunto guardado de indicadores, filtros y visualizaciones | Confidencial | Workspace |
| Panel | Agrupación de informes para una audiencia | Confidencial | Workspace |

## Reglas de negocio
1. Cada indicador tiene una única definición, compartida por todos los módulos.
2. Todo valor mostrado indica su periodo y la fecha de su último cálculo.
3. Un usuario solo ve indicadores calculados sobre datos a los que tiene acceso.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Explicar variaciones de un indicador | Informar |
| Detectar anomalías | Informar |
| Proponer informes relevantes | Sugerir |

## Dependencias
- **Consume de:** Sales, Clients, Marketing, Properties, Finance, Automation.
- **Provee a:** Dashboard, NEX.

## Métricas
- Informes consultados por usuario activo.
- Informes programados en uso.

## Preguntas abiertas
- Catálogo inicial de indicadores.
- Frecuencia de actualización de los indicadores.
