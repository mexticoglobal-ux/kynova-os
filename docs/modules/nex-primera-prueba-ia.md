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

## 6. Preparación de Preview y pasos exactos (nada de esto está hecho)

Estado hoy: las migraciones están aplicadas en el proyecto `hrridjfbrkewpengrmmh` (verificación de ChatGPT con el conector de Supabase), **sin presupuesto asignado, sin claves cargadas, con el interruptor apagado y sin despliegue de esta versión en Preview**. Las cifras de coste de entrada son **estimaciones**: el proveedor no limita la entrada y su recuento de mensajes está documentado como estimación. Tampoco se verificó que las alertas o límites de gasto del proveedor corten el gasto de forma dura: se tratan como avisos, no como tope. Los topes que sí imponemos son los de la base: el presupuesto propuesto de **US$0.10 (100 000 µ$)** y el tope de **30 llamadas**, ambos **todavía sin asignar**.

**Orden (cada paso con su autorización; ninguno se ejecuta solo):**

1. **Elegir la empresa ficticia.** Debe existir en el proyecto de desarrollo y el usuario de prueba debe ser miembro con rol `owner`, `admin` o `member`. Su UUID se lee en Supabase (Table Editor › `tenants`); **no se inventa ni se copia de documentos**. En lo que sigue se escribe `<UUID_EMPRESA>`.
2. **Presupuesto y tope (SQL Editor del proyecto; solo tras autorización).** Las funciones son solo del servidor y el SQL Editor corre con el rol dueño, que sí puede ejecutarlas:
   ```sql
   select public.assign_ai_budget('<UUID_EMPRESA>', date_trunc('month', now() at time zone 'utc')::date, 100000);
   select public.assign_ai_call_cap('<UUID_EMPRESA>', date_trunc('month', now() at time zone 'utc')::date, 30);
   ```
   Sin esto el presupuesto es 0 y la prueba responde por reglas aunque todo lo demás esté encendido.
3. **Proveedor.** Proyecto de OpenAI propio de la prueba, con el límite de gasto mensual más bajo que permita. La clave se crea ahí y **no se escribe en archivos del repositorio**.
4. **Secretos solo de Preview** (el valor se pide por teclado; nunca va en la línea de comandos ni en un archivo):
   ```bash
   npx wrangler secret put OPENAI_API_KEY --env preview
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env preview
   ```
   `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` ya existen en Preview (la sesión funciona con ellas). La clave de servicio solo ejecuta las funciones de presupuesto; en esta base no puede leer ni escribir tablas (ADR-0036).
5. **El interruptor, limitado a una empresa.** Variable (no secreto) `NEX_AI_FIRST_TEST_TENANT` = `<UUID_EMPRESA>` en el Worker `kynova-os-preview` (panel de Cloudflare › Workers › kynova-os-preview › Settings › Variables). El `wrangler.jsonc` tiene `keep_vars: true`, así que un despliegue no la borra. **No se escribe en el repositorio.** Sin la variable, o para cualquier otra empresa, la ruta responde por reglas sin tocar presupuesto ni proveedor.
6. **Desplegar esta versión en Preview** (`npm run deploy`, que solo despliega a Preview; requiere autorización). Hasta aquí ninguna llamada ha salido.
7. **Evals.** Primero el dry-run, que no hace ninguna llamada de red ni a la base: `npm run evals:first-work` (valida la suite y las fixtures y muestra el plan: 18 llamadas reales y 3 casos simulados sin proveedor, con la reserva estimada de cada una). El modo real exige activación explícita y las variables en la **terminal actual** (no en archivos; cerrar la terminal al terminar): `KYNOVA_EVALS_CONFIRM=run-real-calls`, `NEX_AI_FIRST_TEST_TENANT`, `KYNOVA_EVALS_USER_ID` (UUID de un miembro de esa empresa), `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SERVICE_ROLE_KEY`; después `npm run evals:first-work -- --real`. Usa la misma ruta controlada que la API (reserva, tope de 30, un intento sin reintentos ni respaldo, validación de la salida), comparte el contador con las pruebas manuales y **no puede reiniciarlo**. Si falta algo, termina nombrando qué falta (nunca imprime valores) y sin llamar al proveedor. `--run-id <UUID>` reanuda una ejecución interrumpida sin repetir llamadas.
8. **Pruebas manuales** en Preview con las dos frases ficticias (hasta 6; el contador de 30 es compartido: 18 evals + 6 manuales + 6 de reserva).
9. **Criterio de salida:** formato 1.0 y seguridad 1.0; exactitud ≥ 0.9; fidelidad ≥ 0.95; coste/latencia ≥ 0.9; y la rúbrica revisada por una persona. Si algo falla, se apaga y se ajusta el prompt (sigue en `draft`).

**Cómo apagar la prueba al terminar (o ante cualquier duda):**
1. **Quitar el interruptor:** borrar la variable `NEX_AI_FIRST_TEST_TENANT` del Worker de Preview. Es el apagado inmediato: la ruta vuelve a responder por reglas.
2. **Borrar los secretos:** `npx wrangler secret delete OPENAI_API_KEY --env preview` y `npx wrangler secret delete SUPABASE_SERVICE_ROLE_KEY --env preview`; revocar la clave en el proyecto de OpenAI.
3. **Cerrar el tope** (SQL Editor): dejar el tope en las llamadas ya usadas, de modo que ninguna reserva nueva sea posible:
   ```sql
   select public.assign_ai_call_cap('<UUID_EMPRESA>', date_trunc('month', now() at time zone 'utc')::date,
     (select calls_used from public.ai_budget_periods where tenant_id = '<UUID_EMPRESA>' and period_start = date_trunc('month', now() at time zone 'utc')::date));
   ```
4. **Revisar reservas pendientes** (resultado incierto: quedan retenidas y siguen contando): `select id, status, amount_micros, created_at from public.ai_reservations where tenant_id = '<UUID_EMPRESA>' and status in ('held', 'expired_unreconciled');`. Se concilian con la evidencia del proveedor (`settle_ai_budget`) o, con un motivo escrito y la decisión de la plataforma, se cancelan (`write_off_ai_reservation`); nunca se borran a mano.

## 7. Proyecto de desarrollo y migraciones

**Proyecto identificado (2026-11-21).** Se leyó **solo** la URL pública de Supabase de la configuración local (`.env.local` y `.dev.vars` del repositorio de trabajo, ambos ignorados por git) y se extrajo el **Reference ID: `hrridjfbrkewpengrmmh`** (los dos archivos coinciden). No se imprimió ningún otro dato ni clave. **No se pudo compararlo con el proyecto abierto en el navegador:** no hay navegador conectado en esta sesión. Jeffrey debe confirmar que el panel de Supabase que usa muestra ese mismo Reference ID (Project Settings › General) antes de ejecutar la consulta.

**Estado de las migraciones: SIN VERIFICAR.** No hay acceso de lectura a ese proyecto desde esta sesión (no hay conector de Supabase y no se usan claves). Se distinguen dos cosas distintas:
- **Objetos presentes:** lo que existe en la base (tablas, funciones, columnas).
- **Migraciones registradas:** lo que el registro de la CLI (`supabase_migrations.schema_migrations`) dice haber aplicado. Una migración pegada a mano tiene objetos pero no registro.

La consulta de solo lectura que responde ambas está en [docs/backend/migraciones-aplicadas.sql](../backend/migraciones-aplicadas.sql) (se entrega también en la respuesta de la sesión, para pegarla sin buscar el archivo) y las instrucciones en [docs/backend/ejecutar-migraciones-aplicadas.md](../backend/ejecutar-migraciones-aplicadas.md). Devuelve una fila por migración (8): `objetos` (completos / ausentes / PARCIAL), `registro_cli` (registrada / no registrada / no hay registro de la CLI) y los objetos que faltan.

**Validación de la consulta (hecha en PostgreSQL 16.16 local, no en Supabase):** con las 8 migraciones y sin registro → 8 «objetos completos / no hay registro de la CLI»; con las 8 y un registro simulado de 2 versiones → «registrada» solo en esas 2 y «no registrada» en las otras 6 (objetos presentes sin registro); con solo `tenancy_core` → las 6 siguientes «objetos ausentes» con la lista de faltantes. `20261118000100_ai_budget.sql` no la ha aplicado nadie.
