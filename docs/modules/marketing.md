# Módulo: Marketing

| Estado | Área |
|--------|------|
| Planificado | Crecimiento (`docs/DOMAIN.md` §11) |

## Objetivo
Atraer demanda cualificada y medir qué inversión de marketing genera negocio real.

## Actores
- Responsables de marketing.
- Dirección.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Planificar campañas por canal y presupuesto | Núcleo |
| Registrar el origen de cada lead | Núcleo |
| Medir rendimiento y retorno por campaña y canal | Núcleo |
| Definir audiencias a partir de segmentos de clientes | Ampliación |
| Planificar contenidos en un calendario | Ampliación |

## Fuera de alcance
- Seguimiento comercial de leads: corresponde a Sales.
- Ejecución técnica de envíos y publicaciones: se realiza mediante integraciones de Marketplace.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Campaña | Acción de marketing con objetivo, canal, presupuesto y periodo | Confidencial | Workspace |
| Canal | Medio por el que se capta demanda | Interno | Workspace |
| Audiencia | Conjunto de personas o clientes al que se dirige una campaña | Confidencial | Workspace |
| Contenido | Pieza publicada o enviada en una campaña | Interno | Workspace |

## Reglas de negocio
1. Todo lead tiene un origen atribuido a un canal y, si aplica, a una campaña.
2. Una campaña activa tiene objetivo medible y presupuesto definido.
3. Las audiencias respetan el consentimiento de comunicación de cada persona.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Analizar el rendimiento de campañas | Informar |
| Recomendar redistribución de presupuesto | Sugerir |
| Redactar contenidos | Sugerir |

## Dependencias
- **Consume de:** Clients, Marketplace.
- **Provee a:** Sales, Analytics, Dashboard.

## Métricas
- Coste por lead y por cliente adquirido.
- Retorno de la inversión por campaña y canal.
- Leads cualificados generados.

## Preguntas abiertas
- Modelo de atribución entre canales.
- Canales soportados en la primera versión.
