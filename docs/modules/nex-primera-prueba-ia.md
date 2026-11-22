# NEX — propuesta de la primera prueba de IA (borrador de captación)

> **Estado: PROPUESTA. Nada de esto está encendido, conectado ni gastado.** `FIRST_WORK_AI.enabled = false`; no hay claves; la migración del presupuesto (ADR-0036) no está aplicada en remoto.
> Fecha de la verificación de precios: **2026-11-20**. Los precios cambian: se vuelven a verificar el día que se active la prueba.

## 1. Proveedor y modelo (compatibles con el adaptador existente)

| | |
|---|---|
| Modelo interno del registro | `gw-fast-1` (`lib/ai/providers.ts`, `NATIVE_MODELS`) |
| Proveedor / modelo nativo | OpenAI · `gpt-4o-mini`, por `openaiAdapter` (`/chat/completions`, `max_completion_tokens`) |
| Cambios de registro necesarios | **Ninguno**: el modelo y su precio ya están en el registro y coinciden con la documentación oficial |
| Cadena de modelos de la prueba | **Solo `gw-fast-1`, sin respaldo** (un respaldo duplicaría el peor caso) |
| Intentos | **1 por petición** (`retry.maxAttempts = 1` en la prueba; el valor por defecto sería 2 y `critical` 3: no se usan). Sin reintentos automáticos |
| Ya es proveedor «conectado» en el registro | Sí (`connected: true`), pero sin secreto no se llama a nadie |

Alternativas descartadas por ahora: Claude Haiku 5.5 y Gemini 2.5 Flash-Lite son más baratos, pero no tienen entrada en el registro (habría que añadirla, con su tokenizador y sus pruebas); `gw-balanced-1` (Gemini 2.5 Flash) cuesta más. Elegir `gw-fast-1` evita tocar el registro en la primera prueba.

## 2. Precios verificados (documentación oficial, consultada el 2026-11-20)

| Modelo | Entrada / 1 M tokens | Salida / 1 M tokens | Fuente |
|---|---|---|---|
| **OpenAI `gpt-4o-mini`** (estándar) | **$0.15** | **$0.60** | developers.openai.com/api/docs/pricing (la página no muestra fecha de edición) |
| Gemini 2.5 Flash (de pago, estándar) | $0.30 | $2.50 | aistudio.google.com/docs/pricing (sin fecha visible; leídos 100 000 de 117 956 caracteres) |
| Claude Haiku 5.5 (prompts ≤ 100 000 tokens) | $0.10 | $0.50 | platform.claude.com/docs/en/about-claude/pricing |
| Claude Opus 5.5 | $4 | $20 | idem |

**Hallazgo (sin corregir, no se usa en esta prueba):** el registro tiene `gw-reason-1` (Claude Opus 5.5) a $15 / $75 por millón; la documentación oficial dice $4 / $20. El registro **sobrestima** (es el lado seguro), pero hay que corregirlo antes de usar ese modelo. Los precios de `gw-fast-1` y `gw-balanced-1` sí coinciden con la documentación.
Los precios de la facturación real **no** se contrastaron con una factura (no hay cuenta de proveedor): `BILLING_POLICY` (qué se cobra en timeout/red/5xx: peor caso) sigue sin validar frente a facturas.

## 3. Límites de entrada y salida y coste máximo por llamada

**Qué está garantizado y qué no.** Se retiró la estimación por longitud (≈ 3,5 caracteres por token). La entrada **no tiene un máximo garantizado por el proveedor**: la API de chat no permite limitarla, y la guía oficial de OpenAI para contar tokens de mensajes lo dice así: el recuento «puede cambiar», su resultado es «una estimación, no una garantía atemporal», y la página está archivada y sin fecha. Por eso lo que se usa se llama **cota conservadora**, no máximo garantizado. Está en `lib/ai/input-bound.ts` (`chatInputTokenBound`), y sus fuentes y límites están escritos en ese archivo:

| Constante o propiedad | Valor | Fuente / límite |
|---|---|---|
| Codificación de `gpt-4o-mini` | `o200k_base` | OpenAI cookbook, «How to count tokens with tiktoken», tabla de codificaciones (página archivada, sin fecha; consultada el 2026-11-21) |
| Contenido: tokens ≤ bytes UTF-8 | 1 token por byte como máximo | **Propiedad del diseño de un BPE de bytes** (cada byte suelto es un token). **No verificada** contra el vocabulario de `o200k_base` (no se descargó nada); no vale para otros proveedores |
| Formato de chat | 3 por mensaje + 3 de cebado de la respuesta = 9 con dos mensajes | Misma página, para `gpt-4o-mini-2024-07-18`; dice que puede cambiar |
| Margen propio | +3, es decir **12** | Elección nuestra, no una constante del proveedor |

**Qué cubre exactamente.** Los bytes de lo que el adaptador compatible con OpenAI pone en `messages` (el texto del sistema y el del usuario) más el formato. Una prueba (`lib/ai/ai.test.ts`) captura el cuerpo real de la petición y comprueba que solo contiene `model`, `messages` (dos mensajes), `max_completion_tokens` y `stream`, sin funciones, herramientas ni nombres, y que la cota suma exactamente esos textos. **No cubre** lo que envían los adaptadores de Anthropic, Gemini u Ollama, ni el prompt que arma KOE por capas (ahí la cota debe aplicarse sobre el `ProviderPrompt` final, que es lo que `executeChain` recibe y comprueba).

| Límite | Valor | Cómo se hace cumplir |
|---|---|---|
| **Entrada** | cota ≤ **2 900** (peor caso que admite el contrato: 2 857) | **Rechazo antes de enviar**: `ExecutorDeps.maxInputTokens` hace que `executeChain` y `executeStream` no llamen a ningún proveedor si la cota supera el límite (sin intento, sin coste); `inputFits` lo comprueba además antes de reservar. La reserva se calcula con esa misma cota |
| Entrada real | la informa el proveedor (`usage.prompt_tokens`) | El presupuesto **liquida lo real**; si cuesta más de lo reservado queda como `overage_micros` (visible, no oculto) |
| **Salida** | **800** | **Es lo único que impone el proveedor**: el adaptador envía `max_completion_tokens: 800`. Si la respuesta se corta, no valida y cae a reglas (se factura hasta el tope) |
| Intentos por petición | **1** | `retry.maxAttempts = 1` en la prueba; sin modelo de respaldo |

**Reserva y coste, sin multiplicadores presentados como garantía.** Antes de llamar se reserva el precio de `gpt-4o-mini` para la cota de entrada **más** el tope de salida completo (`lib/ai/controlled-call.ts`). La **salida** queda cubierta de verdad (el proveedor se detiene en 800). La **entrada** queda cubierta **hasta la cota**, que es una estimación conservadora: **no se puede garantizar** que el proveedor no cuente más (no limita la entrada y su recuento de mensajes está documentado como estimación). Por eso el coste se presenta como **estimado** y no como máximo. Cálculo (µ$, precios de la sección 2): con la cota del tope (2 900) entrada 2 900 × 150 000 / 1 000 000 = **435** + salida 800 × 600 000 / 1 000 000 = **480** = **915 µ$ ($0.000915) por llamada**; con un prompt típico (cota ≈ 1 650) ≈ 247 + 480 ≈ **727 µ$**. Lo real se liquida con los tokens que informe el proveedor (típico ≈ 330 µ$). Si el proveedor contara más entrada que la cota, el exceso queda como `overage_micros` y el informe lo marca (`inputOverBound`).

## 4. Máximo total de llamadas facturables y presupuesto

**Tope total: 30 llamadas facturables, contando TODO** (evals, pruebas manuales y repeticiones). No hay reintentos ocultos: cada petición es, como mucho, una llamada.

| Concepto | Llamadas |
|---|---|
| Evals: 6 casos con modelo × 3 repeticiones (`nominal-01/02`, `limite-01/02`, `inyeccion-01`, `mezcla-tenants-01`) | 18 |
| `fallo-proveedor-01` (fallo simulado del proveedor, no llama a ninguno) | 0 |
| Pruebas manuales en Preview (las dos frases ficticias, distintas combinaciones) | 6 |
| Reserva para repetir una llamada fallida o un ajuste del prompt (cada repetición es una llamada nueva que cuenta) | 6 |
| **Máximo total** | **30** |

Si la reserva se agota, la prueba se detiene y se vuelve a pedir aprobación; no se amplía sola.

| | |
|---|---|
| Peor caso total | 30 × 915 = **27 450 µ$ ≈ $0.0275** |
| Coste esperado | ≈ 30 × 330 = ≈ **$0.0099** |
| **Presupuesto total propuesto (NO asignado)** | **$0.10 (100 000 µ$)** del mes UTC, con `assign_ai_budget`, solo tras la aprobación final |

Dos topes independientes, **ambos en la base de datos** (la migración `20261118000100`, aún sin aplicar):

1. **Dinero:** $0.10 (`assign_ai_budget`), reserva atómica; sin asignación vale 0.
2. **Llamadas: 30 en total** (`assign_ai_call_cap(tenant, mes, 30)`, solo con la clave de servidor). El contador `calls_used` se comprueba **en el mismo `UPDATE` atómico** que el dinero: la reserva número 31 se rechaza con `call_limit_reached` sin dejar fila. Una petición repetida con la misma clave de idempotencia no gasta otra llamada; una liberación (la llamada nunca llegó al proveedor) devuelve su hueco; una reserva vencida **no** libera nada; y una liquidación que informe de más de un intento facturable suma los extra (queda por encima del tope y bloquea las siguientes). Probado en SQL real y con 60 sesiones concurrentes (ver STATE).

El tope de 30 manda (27 450 µ$ < 100 000 µ$). **Un solo intento, comprobado antes de llamar:** la llamada controlada (`lib/ai/controlled-call.ts`) usa un único modelo, `maxAttempts = 1` y `maxProviderCalls = 1` en el ejecutor, que rechaza una segunda llamada **antes** de iniciarla; no hay reintentos ni respaldo. El conteo al liquidar queda como red de seguridad, no como control principal. El tope real de gasto de la cuenta lo fija el límite de gasto del proyecto en el proveedor (decisión de Jeffrey; el mínimo de recarga del proveedor no se verificó).

## 5. Datos de la prueba

Solo datos ficticios: empresa «Empresa Ficticia A» y las dos frases de captación (qué ofrece / a quién se dirige) de `prompts/evals/fixtures/first-work-draft.yaml`. **Sin prospectos, sin datos de clientes, sin datos de otra empresa** (el caso `mezcla-tenants-01` usa un marcador ficticio para comprobar que no se filtra).

## 6. Pasos pendientes (en este orden; ninguno está hecho)

1. **Decidir y aprobar** esta propuesta (modelo, límites de entrada/salida, 30 llamadas facturables en total, presupuesto de $0.10) **y ejecutar la consulta de la §7 (instrucciones en `docs/backend/ejecutar-migraciones-aplicadas.md`) para conocer el estado real de las migraciones**.
2. **Cuenta de proveedor** (Jeffrey): proyecto de OpenAI con límite de gasto propio; crear la clave **fuera del repositorio**.
3. **Secretos** (ninguno cargado): `OPENAI_API_KEY` **y `SUPABASE_SERVICE_ROLE_KEY`** solo como secretos de Wrangler del entorno de Preview. La segunda es la clave de servidor que **únicamente** ejecuta las funciones de presupuesto (reservar, liquidar, liberar, conciliar): en esta base no puede leer ni escribir tablas, y los usuarios autenticados ya no pueden ejecutar esas funciones (ADR-0036, enmienda 2026-11-22). Nunca en el repositorio, en `.dev.vars` versionado ni en logs
4. **Migración**: aplicar `20261118000100_ai_budget.sql` en el proyecto de desarrollo (con aprobación; ver §7) y asignar el límite de $0.10 al mes UTC de la empresa de prueba con `assign_ai_budget` (solo con la clave de servidor, fuera del repositorio).
5. **Conectar el presupuesto**: `createBudgetGate` → `budget.reserve/settle` en `app/api/v1/nex/draft` y el `ask` por `lib/ai/` (código nuevo: requiere aprobación; hoy no está conectado a `askAi`), con `maxAttempts = 1`, `maxOutputTokens = 800`, la reserva calculada con `inputTokenCeiling` y el contador de 30 llamadas de la base (`assign_ai_call_cap`), que rechaza la 31, más `maxInputTokens` en el ejecutor (**el contador y la guarda ya están escritos y probados; falta conectarlos a la ruta**).
6. **Configuración de la prueba**: `FIRST_WORK_AI` con `provider`, `model = gw-fast-1`, `pricesVerified`, `limitsDefined`, `persistentBudget`, y un interruptor **propio de la prueba** (variable de Wrangler en Preview, limitada al id de la empresa de prueba) para que solo esa prueba pueda activarse; por defecto `enabled` sigue en `false`.
7. **Evals**: no existe un ejecutor (`prompts/evals/README.md` define el formato, pero no hay script). Hay que escribir uno mínimo, con tope de 18 llamadas (6 casos con modelo × 3; el fallo simulado no llama), o ejecutar los casos a mano. Fijar en la suite `providers`, `budget.max_tokens` y `budget.max_cost_usd` ($0.10).
8. **Criterio de salida**: formato 1.0 y seguridad 1.0; exactitud ≥ 0.9; fidelidad ≥ 0.95; coste/latencia ≥ 0.9. Si algo falla: la IA se apaga y se ajusta el prompt (sigue en `draft`; solo pasa a `active` con evals en verde).
9. **Apagar** al terminar: `enabled=false`, borrar el secreto del Preview, dejar el límite en 0.

## 7. Proyecto de desarrollo y migraciones

**Proyecto identificado (2026-11-21).** Se leyó **solo** la URL pública de Supabase de la configuración local (`.env.local` y `.dev.vars` del repositorio de trabajo, ambos ignorados por git) y se extrajo el **Reference ID: `hrridjfbrkewpengrmmh`** (los dos archivos coinciden). No se imprimió ningún otro dato ni clave. **No se pudo compararlo con el proyecto abierto en el navegador:** no hay navegador conectado en esta sesión. Jeffrey debe confirmar que el panel de Supabase que usa muestra ese mismo Reference ID (Project Settings › General) antes de ejecutar la consulta.

**Estado de las migraciones: SIN VERIFICAR.** No hay acceso de lectura a ese proyecto desde esta sesión (no hay conector de Supabase y no se usan claves). Se distinguen dos cosas distintas:
- **Objetos presentes:** lo que existe en la base (tablas, funciones, columnas).
- **Migraciones registradas:** lo que el registro de la CLI (`supabase_migrations.schema_migrations`) dice haber aplicado. Una migración pegada a mano tiene objetos pero no registro.

La consulta de solo lectura que responde ambas está en [docs/backend/migraciones-aplicadas.sql](../backend/migraciones-aplicadas.sql) (se entrega también en la respuesta de la sesión, para pegarla sin buscar el archivo) y las instrucciones en [docs/backend/ejecutar-migraciones-aplicadas.md](../backend/ejecutar-migraciones-aplicadas.md). Devuelve una fila por migración (8): `objetos` (completos / ausentes / PARCIAL), `registro_cli` (registrada / no registrada / no hay registro de la CLI) y los objetos que faltan.

**Validación de la consulta (hecha en PostgreSQL 16.16 local, no en Supabase):** con las 8 migraciones y sin registro → 8 «objetos completos / no hay registro de la CLI»; con las 8 y un registro simulado de 2 versiones → «registrada» solo en esas 2 y «no registrada» en las otras 6 (objetos presentes sin registro); con solo `tenancy_core` → las 6 siguientes «objetos ausentes» con la lista de faltantes. `20261118000100_ai_budget.sql` no la ha aplicado nadie.
