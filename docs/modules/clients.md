# Módulo: Clients

| Estado | Área |
|--------|------|
| Planificado | CRM (`docs/DOMAIN.md` §6) |

## Objetivo
Mantener una visión única y completa de cada cliente para fidelizarlo y aumentar su valor.

## Actores
- Comerciales y gestores de cuenta.
- Atención al cliente.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Consultar la ficha completa de un cliente y su historial | Núcleo |
| Gestionar los contactos de un cliente organización | Núcleo |
| Registrar interacciones y notas | Núcleo |
| Segmentar clientes por atributos y comportamiento | Núcleo |
| Detectar clientes en riesgo de abandono | Ampliación |

## Fuera de alcance
- Proceso de venta: corresponde a Sales.
- Campañas a segmentos: corresponden a Marketing.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Cliente | Ver `docs/DOMAIN.md` §1 | Confidencial | Workspace |
| Contacto | Persona asociada a un cliente organización | Restringido | Workspace |
| Interacción | Comunicación o evento registrado con un cliente | Confidencial | Workspace |
| Segmento | Grupo de clientes definido por criterios | Interno | Workspace |

## Reglas de negocio
1. Un cliente no se duplica: antes de crear uno se comprueba si ya existe.
2. El historial de interacciones de un cliente no se edita; se corrige con una nueva interacción.
3. Los datos personales de contactos se pueden exportar y eliminar a petición del interesado.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Resumir la relación con un cliente | Informar |
| Detectar clientes en riesgo | Informar |
| Proponer acciones de fidelización | Sugerir |

## Dependencias
- **Consume de:** Sales.
- **Provee a:** Sales, Marketing, Properties, Finance, Analytics.

## Métricas
- Retención de clientes.
- Valor de vida del cliente.
- Clientes en riesgo recuperados.

## Preguntas abiertas
- Criterios para detectar duplicados.
- Señales que definen el riesgo de abandono.
