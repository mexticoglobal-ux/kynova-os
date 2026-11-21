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
| Prioridad | `normal` (2 intentos por defecto, `GATEWAY_LIMIT_DEFAULTS`); nunca `critical` (3 intentos) |
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

## 3. Coste máximo por petición (incluidos reintentos)

Límites propuestos (a fijar en la configuración de la prueba; hoy `limitsDefined = false`):

- Entrada máxima: **2 000 tokens** (el prompt mide 3 898 caracteres ≈ 1 100 tokens, más las tres entradas delimitadas). Estimación por longitud (≈ 3,5 caracteres por token en español), **no medida con un tokenizador**.
- Salida máxima: **800 tokens** (el contrato admite 700 + 1 200 caracteres ≈ 600 tokens, más el formato).

Cálculo con `gpt-4o-mini` (micros de dólar):

| Concepto | Cuenta | Resultado |
|---|---|---|
| Entrada por intento | 2 000 × 150 000 / 1 000 000 | 300 µ$ |
| Salida por intento | 800 × 600 000 / 1 000 000 | 480 µ$ |
| **Peor caso por intento** | | **780 µ$ ($0.00078)** |
| **Peor caso por petición** (2 intentos, 1 modelo) | 2 × 780 | **1 560 µ$ ($0.00156)** |
| Típico (≈ 1 300 entrada + 400 salida, 1 intento) | 195 + 240 | ≈ 435 µ$ |

Esa cifra (1 560 µ$) es lo que se reservaría en el presupuesto antes de cada llamada (`worstCaseMicros`).

## 4. Presupuesto total y máximo de peticiones

| | |
|---|---|
| Peticiones máximas de la prueba | **30** (suite de evals: 7 casos × 3 repeticiones = 21; más 9 de revisión manual) |
| Peor caso total | 30 × 1 560 = 46 800 µ$ ≈ **$0.047** |
| **Presupuesto propuesto (límite del mes UTC)** | **$0.10 (100 000 µ$)**, asignado con `assign_ai_budget` |
| Coste esperado | ≈ $0.013 (30 × 435 µ$) |

El límite de $0.10 lo hace cumplir la base (reserva atómica; sin asignación el presupuesto es 0). Es un límite de **la prueba**, no un plan ni un precio comercial. El tope real de gasto de la cuenta lo fija el saldo/límite de gasto que se configure en el proveedor (decisión de Jeffrey; el mínimo de recarga del proveedor no se verificó).

## 5. Datos de la prueba

Solo datos ficticios: empresa «Empresa Ficticia A» y las dos frases de captación (qué ofrece / a quién se dirige) de `prompts/evals/fixtures/first-work-draft.yaml`. **Sin prospectos, sin datos de clientes, sin datos de otra empresa** (el caso `mezcla-tenants-01` usa un marcador ficticio para comprobar que no se filtra).

## 6. Pasos pendientes (en este orden; ninguno está hecho)

1. **Decidir y aprobar** esta propuesta (modelo, límites, $0.10, 30 peticiones).
2. **Cuenta de proveedor** (Jeffrey): proyecto de OpenAI con límite de gasto propio; crear la clave **fuera del repositorio**.
3. **Secreto**: `OPENAI_API_KEY` solo como secreto de Wrangler del entorno de Preview (nunca en el repo, `.dev.vars` versionado ni logs).
4. **Migración**: aplicar `20261118000100_ai_budget.sql` en el proyecto de desarrollo (con aprobación; ver §7) y asignar el límite de $0.10 al mes UTC de la empresa de prueba con `assign_ai_budget` (solo con la clave de servidor, fuera del repositorio).
5. **Conectar el presupuesto**: `createBudgetGate` → `budget.reserve/settle` en `app/api/v1/nex/draft` y el `ask` por `lib/ai/` (código nuevo: requiere aprobación; hoy no está conectado a `askAi`).
6. **Configuración de la prueba**: `FIRST_WORK_AI` con `provider`, `model = gw-fast-1`, `pricesVerified`, `limitsDefined`, `persistentBudget`, y un interruptor **propio de la prueba** (variable de Wrangler en Preview, limitada al id de la empresa de prueba) para que solo esa prueba pueda activarse; por defecto `enabled` sigue en `false`.
7. **Evals**: no existe un ejecutor (`prompts/evals/README.md` define el formato, pero no hay script). Hay que escribir uno mínimo, con tope de 21 peticiones, o ejecutar los casos a mano. Fijar en la suite `providers`, `budget.max_tokens` y `budget.max_cost_usd` ($0.10).
8. **Criterio de salida**: formato 1.0 y seguridad 1.0; exactitud ≥ 0.9; fidelidad ≥ 0.95; coste/latencia ≥ 0.9. Si algo falla: la IA se apaga y se ajusta el prompt (sigue en `draft`; solo pasa a `active` con evals en verde).
9. **Apagar** al terminar: `enabled=false`, borrar el secreto del Preview, dejar el límite en 0.

## 7. Proyecto de desarrollo y migraciones que faltan (sin aplicar)

**Proyecto.** La documentación del repositorio solo dice «proyecto Supabase desechable» (Sprints 64–66); **no registra su ref ni su URL**, y no leo `.env*`. Para identificarlo con exactitud, Jeffrey debe confirmar en Supabase › Project Settings › General el **Reference ID** del proyecto desechable que usa el Preview/local y que es el mismo que el de `NEXT_PUBLIC_SUPABASE_URL` (`https://<ref>.supabase.co`). Hasta entonces: **no aplicar nada**.

**Estado de las migraciones (por evidencia, no por lectura de la base):**

| Migración | Evidencia | Estado en el proyecto desechable |
|---|---|---|
| `20261031000000_tenancy_core` | tablas `tenants`, `memberships`, `business_profiles` existen (diagnóstico de Jeffrey) | aplicada |
| `20261102000000_upgrade_disposable_tenancy` | la sesión real y los roles funcionan | probable |
| `20261106000100` … `000400` (Backend Core) | `list_activity` y `dashboard_digest` respondieron en los Sprints 65–66 | aplicadas (probable) |
| `20261110000100_backend_integration` | sin evidencia de uso en el proyecto | **sin verificar** |
| `20261118000100_ai_budget` | creada en el Sprint 67 | **no aplicada** |

**Comprobación de solo lectura** (SQL Editor del proyecto; no modifica nada):

```sql
select version from supabase_migrations.schema_migrations order by version;  -- si existe: las aplicadas con la CLI
select to_regclass('public.ai_budget_periods')            as presupuesto,      -- 20261118000100
       to_regclass('public.platform_events')              as integracion,      -- 20261110000100 (también platform_audit, storage_objects)
       to_regprocedure('public.dashboard_digest(uuid)')   as backend_core;     -- 20261106000400
```

(Las migraciones se pegaron a mano en ocasiones, así que `schema_migrations` puede estar incompleta; los `to_regclass` son la prueba real.) Faltaría aplicar, **en orden y solo con aprobación**: `20261110000100_backend_integration.sql` si la comprobación la da por ausente, y después `20261118000100_ai_budget.sql`. Ambas probadas en PostgreSQL 16.16 local y en la CI (con `auth` de stand-ins, no en Supabase real).
