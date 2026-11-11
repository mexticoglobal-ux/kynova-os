# ADR-0022: Beta interna: KYNOVA administra cuatro empresas con la plataforma existente

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-12 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | beta · operación · multiempresa · datos |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
Con el AI Business Architect (ADR-0021) y las plantillas (ADR-0018), KYNOVA puede crear una empresa configurada en minutos. Falta probarlo con los primeros negocios: Nova Marketing Studio, PSI Sostenible, Real Estate y YouTube Studio, cada uno con sus casos de uso, sin añadir módulos ni conectar WhatsApp, Stripe, MakaPay ni redes sociales.

## Decisión
1. **Un guion, no un módulo** (`lib/contracts/platform/internal-beta.ts`, `runInternalBeta`): crea cada empresa **con el AI Business Architect** (preguntas, vista previa y confirmación del propietario) y luego configura sus casos de uso con los reductores existentes (Organization, CRM, Communications, Billing, Workers, Runtime de Agentes, AI Studio, Automations e Insights). No añade reglas, estados ni eventos.
2. **Cuatro empresas:** Nova Marketing Studio (Agencia de Marketing), PSI Sostenible (Empresa Genérica: el asistente no reconoció el negocio y preguntó el sector), Real Estate (Bienes Raíces) y YouTube Studio (YouTube Faceless).
3. **Casos de uso con lo que existe:** captación y seguimiento con CRM y Communications; SEO, campañas, guiones, miniaturas, fichas de propiedades y catálogo de productos como prompts de AI Studio probados por KOE; cotizaciones como borradores que aprueba una persona; agenda y visitas como reuniones del CRM con su automatización; calendario y producción como automatizaciones con tareas con fecha; analíticas como hechos y reportes de Insights; distribuidores como prospectos y clientes del CRM.
4. **Dos personas por empresa:** el propietario prepara y una segunda persona aprueba (la plataforma lo exige para publicar agentes, reportes y pagos). Todo en Nivel 1: no se concede ninguna autorización.
5. **KYNOVA como administrador:** `portfolio` y `mrrMicros` leen las cuatro empresas (plan, embudo, actividad, salud e ingresos recurrentes que KYNOVA les factura). Es una lectura.
6. **Aislamiento:** las cuatro comparten los mismos registros y ninguna ve a otra; todas sus trazas pasan por el Event Bus con cobertura completa por empresa (probado con `backfill` del conector).
7. **Datos: solo de ejemplo.** Son negocios reales, pero **toda persona, prospecto, propiedad, producto y cifra es inventada** (direcciones `.test`). Los datos reales de clientes siguen bloqueados por las cuatro puertas del ADR-0006, todas abiertas (`REAL_DATA_GATES`), y Preview no es un entorno de datos reales.

## Consecuencias
- **Lo que prueba:** que el flujo Architect → plantilla → casos de uso funciona de punta a punta para cuatro tipos de negocio, de forma determinista y aislada.
- **Límites:** (a) la plataforma no tiene catálogo de productos ni de propiedades: viven como prompts de AI Studio; (b) las redes sociales no se conectan: un lead «social» es una etiqueta que escribe una persona; (c) Billing no registra pagos todavía (el Router de pagos no está conectado), por eso su salud aparece en «atención»; (d) los propietarios son marcadores de posición, no personas reales.
- **Para pasar a datos reales:** cumplir las puertas del ADR-0006 y la aprobación de producción de `AGENTS.md` §7.11; después, cargar los datos reales de cada negocio por sus propias vías.

## Referencias
ADR-0006, ADR-0017, ADR-0018, ADR-0021, `lib/contracts/platform/internal-beta.test.ts`.
