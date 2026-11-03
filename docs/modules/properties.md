# Módulo: Properties

| Estado | Área |
|--------|------|
| Planificado | Vertical inmobiliaria |

## Objetivo
Gestionar la cartera de propiedades del tenant y conectarla con su proceso comercial.

## Actores
- Agentes inmobiliarios.
- Responsables de cartera.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Dar de alta y mantener propiedades con sus características | Núcleo |
| Gestionar la disponibilidad y el estado de cada propiedad | Núcleo |
| Asociar propiedades a clientes propietarios e interesados | Núcleo |
| Programar y registrar visitas | Núcleo |
| Cruzar demanda de clientes con la cartera disponible | Ampliación |

## Fuera de alcance
- Publicación en portales externos: se realiza mediante integraciones de Marketplace.
- Cobros y liquidaciones: corresponden a Finance.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Propiedad | Ver `docs/DOMAIN.md` §1 | Confidencial | Workspace |
| Operación | Venta o alquiler ofrecido sobre una propiedad, con precio y condiciones | Confidencial | Workspace |
| Visita | Cita de un interesado para ver una propiedad | Confidencial | Workspace |

## Reglas de negocio
1. Una propiedad tiene un único estado vigente: disponible, reservada, cerrada o retirada.
2. Una propiedad reservada o cerrada no admite nuevas operaciones.
3. Toda visita está asociada a una propiedad y a un interesado.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Encontrar propiedades que encajan con un cliente | Sugerir |
| Redactar descripciones de propiedades | Sugerir |
| Detectar propiedades sin actividad | Informar |

## Dependencias
- **Consume de:** Clients, Marketplace.
- **Provee a:** Sales, Finance, Analytics.

## Métricas
- Tiempo medio hasta el cierre de una operación.
- Visitas por propiedad.
- Tasa de conversión de visita a operación.

## Preguntas abiertas
- Si Properties es un módulo general o exclusivo de tenants inmobiliarios.
- Características mínimas obligatorias de una propiedad.
