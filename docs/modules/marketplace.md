# Módulo: Marketplace

| Estado | Área |
|--------|------|
| Planificado | Plataforma (`docs/DOMAIN.md` §7) |

## Objetivo
Ampliar KYNOVA OS con integraciones, plantillas y capacidades que el tenant instala según sus necesidades.

## Actores
- Administradores del tenant.
- Proveedores de extensiones.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Explorar el catálogo de extensiones | Núcleo |
| Instalar una extensión revisando y aprobando sus permisos | Núcleo |
| Desinstalar una extensión y revocar su acceso | Núcleo |
| Valorar extensiones | Ampliación |
| Publicar extensiones como proveedor | Ampliación |

## Fuera de alcance
- Uso funcional de cada extensión: ocurre en el módulo que la utiliza.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Extensión | Integración, plantilla o capacidad publicada en el catálogo | Público | Plataforma |
| Instalación | Extensión activada en un tenant con los permisos aprobados | Confidencial | Tenant |
| Permiso de extensión | Acceso a datos o acciones que una extensión solicita | Interno | Plataforma |
| Proveedor | Organización que publica extensiones | Interno | Plataforma |

## Reglas de negocio
1. Una extensión solo accede a lo que el tenant aprobó al instalarla.
2. Si una actualización solicita permisos nuevos, requiere nueva aprobación.
3. Desinstalar revoca todos los accesos de inmediato.
4. Toda extensión publicada pasa una revisión previa.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Recomendar extensiones según el uso del tenant | Sugerir |

## Dependencias
- **Consume de:** Settings.
- **Provee a:** Automation, NEX, AI Studio, Marketing, Finance, Properties, Settings.

## Métricas
- Extensiones instaladas por tenant.
- Retención de extensiones instaladas.

## Preguntas abiertas
- Extensiones de terceros o solo propias en la primera versión.
- Modelo económico para proveedores.
