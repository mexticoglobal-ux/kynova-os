# ADR-0016: Proveedores de IA reales detrás del AI Gateway, en `lib/ai/`, sin modificar KOE

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-10 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | ia · gateway · proveedores · secretos · observabilidad |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
KOE decide (Worker, especialidad, prioridad, política), el AI Cost Optimizer recomienda y el AI Gateway elige proveedor, modelo, fallback, reintentos y tiempo máximo (ADR-0012). Hasta ahora el Gateway **simulaba** cada intento. KOE y el reducer del Gateway son puros y síncronos; una llamada a un proveedor no lo es. El flujo obligatorio sigue siendo Módulo → KOE → AI Cost Optimizer → AI Gateway → Proveedor IA, sin tocar KOE, NEX, el Runtime ni la arquitectura.

## Problema
¿Cómo se conectan proveedores reales (streaming, timeout, reintentos, tokens y costo reales) sin que ningún módulo los llame, sin guardar claves ni prompts y sin cambiar KOE?

## Opciones consideradas
- **A. Llamar al proveedor dentro del reducer del Gateway.** Imposible: el reducer es síncrono y puro.
- **B. Que KOE llame al proveedor.** Rompe la separación decidida en el ADR-0012 y obliga a modificar KOE.
- **C. Capa `lib/ai/` con dos pasadas del mismo reducer (captura → llamada real → reproducción).** Elegida.

## Decisión
1. **`lib/ai/` es el único lugar que habla con un proveedor.** `http.ts` es el único archivo que envía una petición (`fetch` inyectado, sin SDK). Adaptadores con una interfaz común (`complete`, `stream`) y errores normalizados (`ProviderError`) que nunca llevan clave, prompt ni respuesta del proveedor.
2. **Conectados:** OpenAI, Anthropic, Google Gemini y OpenRouter. **Solo preparados (nunca se llaman, aunque exista su secreto):** Grok, DeepSeek, Mistral y Ollama (local).
3. **Dos pasadas sin modificar KOE:** (1) *captura*: KOE y el Optimizer deciden y el Gateway solo registra la `GatewayRequest`; (2) `lib/ai/` ejecuta la cadena de modelos con el prompt que armó KOE; (3) *reproducción*: el mismo reducer registra el resultado **real** (modelo, proveedor, intentos, tokens, costo). El registro de KOE queda con tokens y costo reales. Sin conductor, el Gateway simula como antes. Lo que KOE rechaza nunca llega a un proveedor.
4. **Reglas del Gateway que se conservan:** las cinco políticas, la regla dura de privacidad, reintento solo para límite de tasa y timeout, +1 intento en prioridad crítica y 1 en baja, backoff de la empresa, cortacircuitos, fallback a **otro** proveedor y, en streaming, solo antes del primer fragmento.
5. **Secretos:** solo por el `SecretsManager` del Backend Core con lista de nombres permitidos (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`; dirección `OLLAMA_BASE_URL`). La clave se pasa por llamada, no se guarda y el acceso queda registrado por nombre y propósito. Se definen en Wrangler, nunca en el repositorio.
6. **Tokens y costo:** tokens del propio proveedor (`tokenSource: "provider"`); si no los informa, estimación (`"estimated"`). El costo sale de una tabla de precios de referencia.
7. Ningún texto de prompt ni de respuesta queda en estado, registros ni métricas; la respuesta solo se devuelve a quien preguntó.

## Consecuencias
- **Positivas:** KOE, NEX y el Runtime sin cambios; el Backend Core observa las llamadas reales por el conector existente; el mismo conjunto de pruebas cubre simulación y ejecución real.
- **Negativas / deuda:** los nombres de modelo nativos y los precios son **valores de referencia a verificar** contra cada proveedor y su factura; **ninguna llamada se ha probado contra una API real**; los proveedores preparados necesitan una decisión propia para conectarse; con «Privacidad primero» los datos personales fallan de forma segura hasta que Ollama se conecte; `lib/ai/` importa el Backend Core solo para los secretos (excepción explícita en las pruebas de guarda).
- **No hecho a propósito:** UI, WhatsApp, Stripe, desplegar, configurar secretos reales.

## Referencias
ADR-0012 (AI Gateway), ADR-0013 (Runtime), ADR-0014 (Backend Core), `lib/ai/`, `lib/ai/ai.test.ts`, `lib/ai/guards.test.ts`.
