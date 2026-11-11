# ADR-0018: Las plantillas de negocio son datos que se instalan con los reducers existentes

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-10 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | plantillas · onboarding · ingresos · dominio |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
Una empresa nueva debe poder trabajar desde el primer día sin armar a mano organización, equipos, Workers, agentes, automatizaciones, KPIs y plan. Las piezas ya existen (ADR-0017 demostró que una empresa opera con ellas). Falta el atajo: configurarlas de una vez según el tipo de negocio, sin duplicar lógica ni crear módulos.

## Decisión
1. **Una plantilla es solo datos** (`lib/contracts/platform/business-templates.ts`): roles, equipos, Workers, agentes recomendados, automatizaciones, flujos, KPIs, objetivos, panel, plan y presupuesto de IA. Doce plantillas: Agencia de Marketing, Bienes Raíces, Restaurante, Clínica, Abogado, Contador, Constructora, E-commerce, YouTube Faceless, Consultor, Educación y Empresa Genérica.
2. **Instalar = aplicar esos datos por los reducers existentes** (Organization, KOE, IA de NEX, Billing, AI Studio, Automations, Insights). No hay una segunda implementación de ninguno. Cada referencia se valida contra los catálogos reales (`validateTemplate`).
3. **Las automatizaciones se escriben una vez** (`automationLibrary`) y cambian solo de palabras según el negocio (paciente, cliente, alumno…).
4. **Nivel 1 siempre:** instalar no concede ninguna autorización. La autonomía (Nivel 2) es una decisión posterior del propietario (ADR-0009). Por eso los agentes de Studio se crean sin Workers asignados (asignarlos exige una autorización) y quedan en revisión; el Worker recomendado queda como etiqueta.
5. **CRM y Communications no tienen evento de configuración:** la plantilla les da su configuración inicial como datos (fuentes de prospectos, canales, tiempo de primera respuesta, foco del embudo) que el motor de ingresos y el panel leen; no se inventan registros.
6. **Revenue Engine = lectura:** `revenueEngine` calcula, con lo que CRM e Insights ya guardan, lo ganado, el embudo ponderado por la tasa de cierre, lo que falta para la meta mensual y los prospectos necesarios. `readKpis` mide cada KPI con los hechos de Insights. Ninguno guarda ni decide nada.
7. **Aislamiento:** doce empresas pueden instalarse sobre los mismos registros; cada una queda separada por su `tenant`. Reinstalar la misma empresa se rechaza.

## Consecuencias
- **Positivas:** alta en milisegundos; una sola fuente de verdad por regla; las plantillas se prueban contra la plataforma, así que no pueden quedar desfasadas.
- **Límites:** objetivos, metas, precios y plan recomendado son valores de referencia a ajustar con clientes reales; el panel y los KPI arrancan en cero; los agentes necesitan aprobación de una segunda persona; no hay interfaz de selección todavía.
- **No hecho a propósito:** pantalla de instalación, persistencia en base de datos, conectores y cambios en KOE, NEX, Gateway, Runtime o Backend Core.

## Referencias
ADR-0009, ADR-0017, `lib/contracts/platform/business-templates.test.ts`.
