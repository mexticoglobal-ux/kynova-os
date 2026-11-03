# Módulo: Finance

| Estado | Área |
|--------|------|
| Planificado | Operaciones (`docs/DOMAIN.md` §10) |

## Objetivo
Dar al tenant control sobre sus ingresos, gastos y caja, y anticipar su situación financiera.

## Actores
- Dirección o propietario.
- Responsable financiero o administrativo.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Registrar ingresos y gastos categorizados | Núcleo |
| Emitir facturas y seguir su cobro | Núcleo |
| Consultar el flujo de caja del periodo | Núcleo |
| Prever la caja de los próximos meses | Ampliación |
| Conciliar movimientos bancarios | Ampliación |

## Fuera de alcance
- Contabilidad legal y declaraciones fiscales: se cubren con integraciones de Marketplace.
- Suscripción del tenant a KYNOVA OS: corresponde a Settings.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Factura | Documento de cobro emitido a un cliente | Restringido | Workspace |
| Movimiento | Ingreso o gasto registrado con fecha, importe, moneda y categoría | Restringido | Workspace |
| Categoría | Clasificación de ingresos y gastos | Interno | Workspace |
| Previsión de caja | Estimación de la caja futura a partir de movimientos y compromisos | Restringido | Workspace |

## Reglas de negocio
1. Todo importe tiene moneda explícita.
2. Una factura emitida no se modifica; se corrige con una rectificativa.
3. Una factura vencida y no cobrada se marca como impagada.
4. La previsión indica siempre en qué supuestos se basa.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Explicar la evolución de ingresos y gastos | Informar |
| Alertar de riesgos de caja | Informar |
| Proponer recordatorios de cobro | Sugerir |

## Dependencias
- **Consume de:** Sales, Clients, Properties, Marketplace.
- **Provee a:** Dashboard, Analytics.

## Métricas
- Días medios de cobro.
- Importe impagado.
- Precisión de la previsión de caja.

## Preguntas abiertas
- Requisitos de facturación por país.
- Monedas e impuestos soportados en la primera versión.
