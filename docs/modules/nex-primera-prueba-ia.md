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

## 3. Límites garantizados y coste máximo por llamada

**Se retira la estimación por longitud** (≈ 3,5 caracteres por token): no es un máximo. Los límites quedan así, y están en `lib/first-work-draft.ts` (`FIRST_WORK_TEST_LIMITS`, con pruebas):

| Límite | Valor | Cómo se garantiza (no por estimación) |
|---|---|---|
| **Entrada** | techo de **2 900 tokens** | `inputTokenCeiling` = bytes UTF-8 de los dos mensajes + 12 de formato de chat. `gpt-4o-mini` usa `o200k_base`, un BPE a nivel de byte: un texto nunca ocupa más tokens que bytes (cada byte suelto es un token), así que es una **cota superior comprobable**, no una medida. Es deliberadamente holgada (el texto real ocupa una fracción). |
| Entrada máxima posible | 2 857 | Peor caso que admite el contrato: instrucciones reales (1 391 bytes) + empresa de 120 caracteres + dos frases de 160, todos de 3 bytes (1 454 bytes) + 12. Una prueba lo comprueba con el prompt real. Un prompt sobre el techo **no se reserva ni se envía** (cae a reglas). |
| **Salida** | **800 tokens** | El adaptador envía `max_completion_tokens: 800`: el **proveedor** corta la generación y no factura más. (`gpt-4o-mini` no tiene tokens de razonamiento ocultos.) Si la respuesta se corta, no valida y cae a reglas (se factura hasta el tope). |
| Intentos por petición | **1** | `retry.maxAttempts = 1` en la prueba (no hay reintentos automáticos); sin modelo de respaldo. |

Lo real se mide después: el proveedor informa `usage.prompt_tokens` y `completion_tokens` en cada respuesta, y el presupuesto liquida eso (la reserva solo es el techo).

Cálculo del peor caso por llamada con `gpt-4o-mini` (micros de dólar, precios de la sección 2):

| Concepto | Cuenta | Resultado |
|---|---|---|
| Entrada | 2 900 × 150 000 / 1 000 000 | 435 µ$ |
| Salida | 800 × 600 000 / 1 000 000 | 480 µ$ |
| **Peor caso por llamada facturable** | | **915 µ$ ($0.000915)** |
| Típico (≈ 600 entrada + 400 salida) | 90 + 240 | ≈ 330 µ$ |

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

Dos topes independientes: (1) el **límite de dinero** de $0.10 lo impone la base (reserva atómica; hoy no hay asignación y vale 0); (2) el **tope de 30 llamadas** es el que manda (27 450 µ$ < 100 000 µ$) y hay que hacerlo cumplir con un contador en la puerta de la prueba (cuenta las reservas del periodo y rechaza la número 31): **código pendiente**, no existe todavía. El tope real de gasto de la cuenta lo fija el límite de gasto del proyecto en el proveedor (decisión de Jeffrey; el mínimo de recarga del proveedor no se verificó).

## 5. Datos de la prueba

Solo datos ficticios: empresa «Empresa Ficticia A» y las dos frases de captación (qué ofrece / a quién se dirige) de `prompts/evals/fixtures/first-work-draft.yaml`. **Sin prospectos, sin datos de clientes, sin datos de otra empresa** (el caso `mezcla-tenants-01` usa un marcador ficticio para comprobar que no se filtra).

## 6. Pasos pendientes (en este orden; ninguno está hecho)

1. **Decidir y aprobar** esta propuesta (modelo, límites de entrada/salida, 30 llamadas facturables en total, presupuesto de $0.10) **y ejecutar la consulta de la §7 para conocer el estado real de las migraciones**.
2. **Cuenta de proveedor** (Jeffrey): proyecto de OpenAI con límite de gasto propio; crear la clave **fuera del repositorio**.
3. **Secreto**: `OPENAI_API_KEY` solo como secreto de Wrangler del entorno de Preview (nunca en el repo, `.dev.vars` versionado ni logs).
4. **Migración**: aplicar `20261118000100_ai_budget.sql` en el proyecto de desarrollo (con aprobación; ver §7) y asignar el límite de $0.10 al mes UTC de la empresa de prueba con `assign_ai_budget` (solo con la clave de servidor, fuera del repositorio).
5. **Conectar el presupuesto**: `createBudgetGate` → `budget.reserve/settle` en `app/api/v1/nex/draft` y el `ask` por `lib/ai/` (código nuevo: requiere aprobación; hoy no está conectado a `askAi`), con `maxAttempts = 1`, `maxOutputTokens = 800`, la reserva calculada con `inputTokenCeiling` y un **contador de 30 llamadas** que rechaza la 31.
6. **Configuración de la prueba**: `FIRST_WORK_AI` con `provider`, `model = gw-fast-1`, `pricesVerified`, `limitsDefined`, `persistentBudget`, y un interruptor **propio de la prueba** (variable de Wrangler en Preview, limitada al id de la empresa de prueba) para que solo esa prueba pueda activarse; por defecto `enabled` sigue en `false`.
7. **Evals**: no existe un ejecutor (`prompts/evals/README.md` define el formato, pero no hay script). Hay que escribir uno mínimo, con tope de 18 llamadas (6 casos con modelo × 3; el fallo simulado no llama), o ejecutar los casos a mano. Fijar en la suite `providers`, `budget.max_tokens` y `budget.max_cost_usd` ($0.10).
8. **Criterio de salida**: formato 1.0 y seguridad 1.0; exactitud ≥ 0.9; fidelidad ≥ 0.95; coste/latencia ≥ 0.9. Si algo falla: la IA se apaga y se ajusta el prompt (sigue en `draft`; solo pasa a `active` con evals en verde).
9. **Apagar** al terminar: `enabled=false`, borrar el secreto del Preview, dejar el límite en 0.

## 7. Proyecto de desarrollo y migraciones: consulta exacta de solo lectura

**Proyecto.** La documentación del repositorio solo dice «proyecto Supabase desechable»; **no registra su ref ni su URL**, y no se leen `.env*`. Jeffrey debe confirmar en Supabase › Project Settings › General el **Reference ID** del proyecto de desarrollo antes de ejecutar nada.

**Qué migraciones están aplicadas no se deduce de que una pantalla funcione.** Se comprueba con la consulta del repositorio **[docs/backend/migraciones-aplicadas.sql](../backend/migraciones-aplicadas.sql)**, que solo contiene `SELECT` (no crea, cambia ni borra) y se ejecuta en el SQL Editor del proyecto. Se generó a partir de `supabase/migrations/*.sql` (108 objetos: tablas y funciones que cada migración crea; se excluye `private.apply_tenant_rls`, que `20261106000300` borra).

- **Parte 0** (opcional): `supabase_migrations.schema_migrations`, el registro de la CLI. Si no existe, no es un fallo: solo dice que no se aplicó con la CLI.
- **Parte 1:** por migración, objetos esperados, existentes y faltantes, y el estado `completa`, `ausente` o `PARCIAL: revisar`.
- **Parte 2:** detalle por objeto (los que faltan primero).
- **Parte 3:** tablas de `public` que no pertenecen a ninguna migración (restos del spike, etc.).
- **Parte 4:** columnas que añaden `20261102000000` y `20261106000100` (no crean objetos, así que la parte 1 sola no las distingue; por eso `20261102000000` puede salir «completa» con solo `tenancy_core`).

**Validación de la consulta (hecha):** se ejecutó en el PostgreSQL 16.16 local desechable. Sobre la base con las 8 migraciones: las 8 salen `completa` (6, 4, 13, 17, 13, 37, 8 y 10 objetos). Sobre una base con solo `20261031000000`: salen `completa` las dos primeras y `ausente` las otras seis, con los objetos faltantes listados. **No se ha ejecutado contra ningún Supabase.**

**Estado real de las migraciones del proyecto de desarrollo: SIN VERIFICAR.** Hasta que Jeffrey ejecute la consulta y pegue el resultado, ninguna se da por aplicada ni por pendiente. Lo único que es seguro: `20261118000100_ai_budget.sql` no se ha aplicado por nadie (lo habría hecho yo, y no lo hice). **No se aplica nada ni se despliega Preview hasta la aprobación final.**
