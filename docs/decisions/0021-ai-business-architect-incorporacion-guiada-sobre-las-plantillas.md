# ADR-0021: AI Business Architect, la incorporación guiada que instala una plantilla a la medida

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-11 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | onboarding · plantillas · recomendación · multiempresa |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
Las plantillas de negocio (ADR-0018) configuran una empresa en milisegundos, pero el cliente nuevo todavía tendría que saber cuál elegir, qué plan, cuántos agentes y qué presupuesto. Se busca que responda unas pocas preguntas y tenga KYNOVA configurado en menos de 5 minutos, sin añadir módulos de negocio ni reglas nuevas y sin conectar IA real.

## Decisión
1. **Una guía, no un módulo de negocio** (`lib/contracts/platform/business-architect.ts`, `reduceArchitect`): solo elige y escala lo que ya existe. No importa nada de IA, de KOE, del Router ni del Backend Core.
2. **Asistente de bienvenida y cuestionario:** NEX se presenta como IA y hace **siete preguntas cortas** (nombre, descripción, tamaño del equipo, consultas al mes, canales, primer objetivo, cuánto quiere que haga la IA); una octava (el sector) solo si la descripción no dejó claro el negocio. A 30 segundos por pregunta, 4 minutos como máximo.
3. **Detección determinista:** palabras clave (sin acentos) por plantilla (`SECTOR_SIGNALS`) sobre lo que el cliente escribió; si no es claro, se le pregunta; lo que elige el cliente siempre gana. **No es un modelo de IA**: un modelo podría redactar las preguntas más adelante a través de KOE.
4. **Recomendación derivada de datos existentes:** plantilla (de las doce), plan (el más barato de autoservicio cuyos **límites de Billing** cubren lo que se instalará, nunca por debajo del plan sugerido por la plantilla), número de agentes (uno si es cauto, todos si no), presupuesto de IA (el de la plantilla × 0,6 / 1 / 1,6), automatizaciones (sin la del formulario web si no tiene formulario), Workers (los que sus agentes necesitan primero, hasta el límite del plan), equipos (uno si trabaja solo), KPIs y panel (reordenados según su primer objetivo).
5. **Vista previa exacta:** `previewInstall` ejecuta el instalador real sobre registros desechables; lo que se muestra es lo que hará el clic, y cualquier problema aparece antes.
6. **Instalación con un clic:** `install.confirm` llama a `installBusinessTemplate` (con `overrides` validados otra vez contra los catálogos) y devuelve los registros; Organization, KOE, la IA de NEX, Billing, AI Studio, Automations e Insights se configuran por sus reductores, y CRM, Communications, Marketplace y Academy quedan listos como siguientes pasos.
7. **Solo la persona decide:** NEX hace las preguntas; solo el propietario responde, ajusta y confirma. Todo en Nivel 1: no se concede ninguna autorización.
8. **Multiempresa y auditoría:** una sesión por empresa, registros con `tenantId`, trail de auditoría (sin datos personales) compatible con el Event Bus (probado con el `Connector`), 2 tablas futuras con RLS validadas por `auditPolicies`. Sin migración.

## Consecuencias
- **Cambio acotado en código existente:** `installBusinessTemplate` acepta `overrides` (Sprint 34); no cambia su comportamiento sin ellos.
- **Pendiente con aprobación propia:** puente en `bridges.ts` (Backend Core), migración, pantalla del asistente, y, si se quiere, que un modelo reconozca el negocio y redacte preguntas (por KOE).
- **Límites:** la detección es por palabras; las reglas de escalado (equipo → usuarios, consultas → CRM, apetito → presupuesto) son supuestos míos a validar con clientes reales; un solo propietario no puede publicar sus agentes (hace falta una segunda persona).

## Referencias
ADR-0009, ADR-0018, ADR-0019/0020, `lib/contracts/platform/business-architect.test.ts`.
