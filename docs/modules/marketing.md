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
| Planificar y producir un canal de YouTube sin mostrar la cara (prueba de Creator Economy): tema y audiencia, banco de ideas, guiones y estado de producción | Piloto (v0 local, ver abajo) |

## Fuera de alcance
- Seguimiento comercial de leads: corresponde a Sales.
- Ejecución técnica de envíos y publicaciones: se realiza mediante integraciones de Marketplace.
- Conexión con YouTube o con redes sociales y publicación de contenido: no existe en el estudio de creadores v0.
- Formación sobre el producto: corresponde a Academy, que no interviene en el estudio de creadores.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Campaña | Acción de marketing con objetivo, canal, presupuesto y periodo | Confidencial | Workspace |
| Canal | Medio por el que se capta demanda | Interno | Workspace |
| Audiencia | Conjunto de personas o clientes al que se dirige una campaña | Confidencial | Workspace |
| Contenido | Pieza publicada o enviada en una campaña | Interno | Workspace |
| Canal de creador (v0) | Tema, audiencia, tono, formato sin mostrar la cara y cadencia semanal de un canal de YouTube de prueba | Interno | Navegador, sin tenant |
| Idea (v0) | Tema candidato con ángulo, prioridad y estado (pendiente, seleccionada, descartada) | Interno | Navegador, sin tenant |
| Guion / vídeo (v0) | Borrador en tres secciones (gancho, desarrollo, cierre) con etapa de producción y fecha planificada | Interno | Navegador, sin tenant |

## Reglas de negocio
1. Todo lead tiene un origen atribuido a un canal y, si aplica, a una campaña.
2. Una campaña activa tiene objetivo medible y presupuesto definido.
3. Las audiencias respetan el consentimiento de comunicación de cada persona.
4. **Estudio de creadores v0** (`app/(app)/marketing/_components/`, ADR-0005; contrato `lib/contracts/creator.ts`, lógica pura `lib/creator.ts`): vive solo en el navegador (`localStorage`), sin servidor, sin tenant y sin red. No se conecta a YouTube ni a redes, no publica ni programa nada: la fecha de un vídeo es solo de planificación. Se prueba con contenido de muestra ficticio y sin datos reales de clientes. Etapas de producción, en orden: guion, voz en off, material visual, edición, revisión, listo.

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
- Estudio de creadores: persistencia por tenant (ADR-0006, fases 2 y 3), ayuda de NEX para ideas y guiones (`kyn-ai`), exportación de guiones, métricas del canal y conexión con YouTube mediante Marketplace; ninguna está decidida.
