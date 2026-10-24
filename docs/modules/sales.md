# Módulo: Sales

| Estado | Área |
|--------|------|
| Planificado | CRM (`docs/DOMAIN.md` §6) |

## Objetivo
Convertir leads en clientes con un proceso comercial ordenado, medible y sin oportunidades olvidadas.

## Actores
- Comerciales.
- Responsables comerciales.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Registrar y calificar leads | Núcleo |
| Gestionar oportunidades a lo largo de las etapas del pipeline | Núcleo |
| Registrar actividades comerciales (llamadas, reuniones, correos) | Núcleo |
| Planificar seguimientos y recibir avisos de leads sin contactar | Núcleo |
| Convertir una oportunidad ganada en cliente | Núcleo |
| Prever ventas del periodo | Ampliación |

## Fuera de alcance
- Gestión de la relación posterior a la venta: corresponde a Clients.
- Facturación: corresponde a Finance.
- Generación de leads: corresponde a Marketing.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Lead | Ver `docs/DOMAIN.md` §1 | Confidencial | Workspace |
| Oportunidad | Posible venta asociada a un lead o cliente, con importe estimado y etapa | Confidencial | Workspace |
| Pipeline | Secuencia de etapas por la que avanzan las oportunidades | Interno | Workspace |
| Actividad comercial | Interacción registrada con un lead o cliente | Confidencial | Workspace |

## Reglas de negocio
1. Toda oportunidad abierta tiene un responsable y una próxima acción con fecha.
2. Una oportunidad solo se cierra como ganada o perdida; las perdidas registran el motivo.
3. Un lead convertido no se elimina: queda vinculado al cliente resultante.
4. Un lead sin actividad en el plazo definido por el tenant se marca como desatendido.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Detectar leads y oportunidades desatendidos | Informar |
| Priorizar a quién contactar | Sugerir |
| Redactar seguimientos | Sugerir |
| Registrar actividades y mover etapas | Ejecutar con confirmación |

## Dependencias
- **Consume de:** Marketing, Clients.
- **Provee a:** Clients, Finance, Analytics, Dashboard.

## Métricas
- Tasa de conversión de lead a cliente.
- Duración media del ciclo de venta.
- Valor del pipeline por etapa.
- Leads desatendidos.

## Preguntas abiertas
- Etapas por defecto del pipeline y si son configurables por workspace.
- Plazo por defecto para considerar un lead desatendido.
