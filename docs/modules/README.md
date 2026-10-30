# Módulos de KYNOVA OS

> Referencia de negocio de cada módulo. Describe qué hace el módulo y para quién, no cómo está construido.
> Los conceptos transversales (Tenant, Workspace, Usuario, Lead, Cliente, Propiedad…) se definen en `docs/DOMAIN.md`;
> las entidades propias de un módulo se definen en su documento.

## Catálogo

| Módulo | Documento | Área | Estado |
|--------|-----------|------|--------|
| Dashboard | `dashboard.md` | Núcleo | Prototipo |
| NEX | `nex.md` | Núcleo | Prototipo |
| Sales | `sales.md` | CRM | Planificado |
| Clients | `clients.md` | CRM | Planificado |
| Marketing | `marketing.md` | Crecimiento | Planificado |
| Properties | `properties.md` | Vertical inmobiliaria | Planificado |
| Finance | `finance.md` | Operaciones | Planificado |
| Automation | `automation.md` | Operaciones | Planificado |
| Analytics | `analytics.md` | Inteligencia | Planificado |
| Settings | `settings.md` | Plataforma | Planificado |
| AI Studio | `ai-studio.md` | Inteligencia | Planificado |
| Marketplace | `marketplace.md` | Plataforma | Planificado |
| Academy | `academy.md` | Plataforma | Planificado |

## Mapa de relaciones

| Módulo | Provee a |
|--------|----------|
| Marketing | Sales (leads), Analytics |
| Sales | Clients (conversiones), Finance (ventas cerradas), Analytics |
| Clients | Sales, Marketing (audiencias), Properties, Finance |
| Properties | Sales (oportunidades), Finance (operaciones), Analytics |
| Finance | Dashboard (salud financiera), Analytics |
| Automation | Todos los módulos (ejecución de flujos) |
| Analytics | Dashboard, NEX |
| NEX | Todos los módulos (análisis y recomendaciones) |
| AI Studio | NEX (configuración) |
| Marketplace | Automation, NEX, Settings (extensiones) |
| Settings | Todos los módulos (configuración del tenant) |

## Estructura de cada documento

| Sección | Contenido |
|---------|-----------|
| Objetivo | Valor de negocio para el tenant |
| Actores | Personas que usan el módulo |
| Casos de uso | Qué pueden hacer, con prioridad Núcleo o Ampliación |
| Fuera de alcance | Lo que el módulo no hace |
| Entidades | Entidades propias, su clasificación de datos y su alcance |
| Reglas de negocio | Invariantes del dominio |
| Capacidades de NEX | Qué aporta NEX y con qué nivel de autonomía |
| Dependencias | Módulos de los que consume y a los que provee |
| Métricas | Cómo se mide el éxito del módulo |
| Preguntas abiertas | Decisiones de negocio pendientes de validar |

## Reglas

1. Los documentos de módulo no contienen rutas, contratos, APIs ni detalles técnicos.
2. Al implementar un módulo con `kyn-module`, sus secciones técnicas se añaden según `framework/templates/module.md`.
3. Los permisos por rol se documentan cuando exista el modelo de roles de la plataforma.
4. Clasificación de datos según `framework/standards/security.md`; niveles de autonomía de NEX según `framework/standards/ai.md`.
