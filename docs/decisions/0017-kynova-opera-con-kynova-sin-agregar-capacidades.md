# ADR-0017: KYNOVA opera KYNOVA usando solo la plataforma existente

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-10 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | operación · demostración · dominio · pruebas |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
La plataforma ya tiene Organization, Billing, Communications, CRM, Marketplace, Academy, AI Studio, Insights, Automations, KOE, la IA de NEX y el Runtime de Agentes. Falta demostrar que **una empresa real puede operar solo con ellos**, empezando por la propia KYNOVA, sin añadir módulos, pantallas ni capacidades, y sin conectar WhatsApp, Stripe ni redes sociales.

## Decisión
1. **Un guion, no un módulo.** `lib/contracts/platform/kynova-operation.ts` solo **describe** la empresa KYNOVA (`tenant-kynova`) y un día de trabajo, y aplica cada paso por los reducers existentes. No añade reglas, estados ni eventos. Un paso que la plataforma no pueda hacer vuelve como error y rompe la prueba de extremo a extremo.
2. **Empresa interna:** propietario, 5 personas, 5 departamentos, equipos y los 5 Workers internos (coordinador, ventas, seguimiento, reportes, cobros) en equipos como una persona más; plan Business; IA de NEX con política balanceada y presupuesto; 6 automatizaciones internas; prompts y agente en AI Studio; productos en el Marketplace; curso oficial en Academy.
3. **Día de operación simulado:** generación de prospectos, seguimiento, soporte, facturación, marketing, contenido, métricas, reuniones y tareas. NEX prepara y, dentro de una autorización de Nivel 2, mueve una etapa o reasigna; **solo personas** aprueban, envían, cobran y publican.
4. **Panel operativo** (`operatingDashboard`): una **lectura** de lo que los módulos ya guardan; no guarda ni decide nada y no es una pantalla nueva.
5. **Aislamiento:** el panel de otra empresa (`tenant-cliente-demo`) queda vacío; el Marketplace es lo único que cruza, por compra.
6. **Todo simulado:** canales solo correo, chat web y formulario; pagos con tarjeta simulada; la IA pasa por KOE → Optimizer → Gateway (simulado). Sin datos reales de clientes (ADR-0006).

## Consecuencias
- **Positivas:** prueba reproducible (determinista) de que la plataforma sostiene una empresa; sirve de regresión de integración entre módulos.
- **Negativas / límites:** es una simulación; las métricas de volumen reutilizan el generador determinista de Insights; no prueba proveedores reales, canales reales ni carga.
- **No hecho a propósito:** UI nueva, conectores, módulos, cambios en KOE, NEX, Gateway o Runtime.

## Referencias
ADR-0009 (autonomía por niveles), ADR-0012/0013/0016 (IA, Runtime, proveedores), `lib/contracts/platform/kynova-operation.test.ts`.
