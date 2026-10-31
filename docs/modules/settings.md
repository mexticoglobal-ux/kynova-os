# Módulo: Settings

| Estado | Área |
|--------|------|
| Planificado | Plataforma |

## Objetivo
Permitir al tenant administrar su organización, sus usuarios, su plan y sus preferencias en un único lugar.

## Actores
- Administradores del tenant.
- Cualquier usuario, para sus preferencias personales.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Gestionar los datos de la organización | Núcleo |
| Invitar, desactivar y asignar roles a usuarios | Núcleo |
| Crear y gestionar workspaces | Núcleo |
| Consultar y cambiar el plan de suscripción | Núcleo |
| Gestionar preferencias personales (idioma, zona horaria, notificaciones) | Núcleo |
| Gestionar extensiones instaladas y sus permisos | Ampliación |
| Exportar o eliminar los datos del tenant | Ampliación |

## Fuera de alcance
- Configuración de NEX: corresponde a AI Studio.
- Catálogo de extensiones: corresponde a Marketplace.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Tenant | Ver `docs/DOMAIN.md` §4 | Confidencial | Tenant |
| Workspace | Ver `docs/DOMAIN.md` §5 | Confidencial | Tenant |
| Usuario | Ver `docs/DOMAIN.md` §1 | Restringido | Tenant |
| Invitación | Solicitud pendiente para que una persona se una al tenant | Confidencial | Tenant |
| Suscripción | Plan contratado, periodo y estado de pago del tenant | Restringido | Tenant |
| Preferencias | Configuración regional y de notificaciones de un usuario o del tenant | Interno | Usuario o tenant |
| Perfil de empresa | Nombre comercial, país, idioma y seis respuestas cerradas del Business Assessment; uno por tenant (ADR-0006). Lectura para miembros, escritura solo para propietarios, sin borrado en v1. Núcleo y `/api/profile` implementados, pendientes de Go; la pantalla llega en la fase 2 | Confidencial | Tenant |
| Membresía | Relación usuario ↔ tenant con rol `owner` o `member`; solo lectura desde la API, se gestiona por vías administrativas hasta definir las invitaciones | Restringido | Tenant |

## Reglas de negocio
1. Un tenant tiene siempre al menos un administrador activo.
2. Los cambios de permisos y de plan quedan auditados.
3. Bajar de plan no elimina datos; limita capacidades.
4. La eliminación del tenant requiere confirmación reforzada y un periodo de gracia.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Explicar las capacidades y límites del plan | Informar |
| Recomendar el plan adecuado según el uso | Sugerir |

## Dependencias
- **Consume de:** Marketplace.
- **Provee a:** todos los módulos.

## Métricas
- Tiempo hasta invitar al primer compañero.
- Cambios de plan al alza.

## Preguntas abiertas
- Modelo de roles y permisos de la plataforma.
- Periodo de gracia antes de eliminar un tenant.
