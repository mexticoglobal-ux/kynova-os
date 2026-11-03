# Módulo: AI Studio

| Estado | Área |
|--------|------|
| Planificado | Inteligencia (`docs/DOMAIN.md` §9) |

## Objetivo
Permitir al tenant adaptar NEX a su negocio sin conocimientos técnicos y sin comprometer la seguridad.

## Actores
- Administradores del tenant.
- Responsables de área autorizados.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Aportar conocimiento del negocio a NEX (documentos, políticas, catálogos) | Núcleo |
| Definir el tono y las indicaciones generales de NEX | Núcleo |
| Habilitar o deshabilitar capacidades de NEX | Núcleo |
| Probar el comportamiento de NEX antes de publicar cambios | Ampliación |
| Crear asistentes especializados por área | Ampliación |

## Fuera de alcance
- Uso diario de NEX: corresponde al módulo NEX.
- Elección del proveedor o modelo de IA: la gestiona la plataforma.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Configuración de NEX | Tono, indicaciones y capacidades habilitadas | Confidencial | Tenant o workspace |
| Fuente de conocimiento | Documento o dato que el tenant pone a disposición de NEX | Confidencial | Tenant o workspace |
| Asistente especializado | Variante de NEX con conocimiento y capacidades acotadas a un área | Confidencial | Workspace |

## Reglas de negocio
1. Ninguna configuración permite eludir el aislamiento entre tenants ni la confirmación de acciones con efectos.
2. Los cambios de configuración quedan versionados y pueden revertirse.
3. Una fuente de conocimiento eliminada deja de usarse de inmediato.
4. Las capacidades disponibles dependen del plan del tenant.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Sugerir mejoras de configuración a partir del uso | Sugerir |
| Detectar conocimiento desactualizado o contradictorio | Informar |

## Dependencias
- **Consume de:** Settings, Marketplace.
- **Provee a:** NEX.

## Métricas
- Tenants con NEX personalizado.
- Mejora de la valoración de respuestas tras personalizar.

## Preguntas abiertas
- Formatos y volumen de conocimiento admitidos por plan.
- Disponibilidad de asistentes especializados por plan.
