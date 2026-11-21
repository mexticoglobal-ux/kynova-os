# ADR-0036: Presupuesto de IA persistente por empresa, con reservas atómicas para el consumo concurrente

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto (implementación preparada: migración `20261118000100_ai_budget.sql` y pruebas, sin aplicar a ninguna base remota) |
| **Fecha** | 2026-11-18 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | ia · datos · tenancy · coste · concurrencia · seguridad |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
KOE hace cumplir los límites de cada empresa (`budgetMicros`, tokens por petición) y el AI Gateway registra el coste real de cada llamada (ADR-0012, ADR-0016). Pero todo ese estado es `AiState`: un valor **en memoria**, puro, que el reductor recibe y devuelve. En Cloudflare Workers cada petición puede ejecutarse en un aislado distinto y el estado desaparece al terminar: **un tope calculado sobre `AiState` no es un límite acumulado por empresa**. Con varias peticiones simultáneas o repartidas en el tiempo, cada una vería el presupuesto "intacto".

Hoy ningún código llama a un modelo real (el chat libre es una simulación y el borrador de primer trabajo se escribe por reglas; `lib/first-work-draft.ts` tiene la ruta al modelo preparada y apagada). Antes de encenderla hace falta un contador que:
- sea compartido por todas las instancias y sobreviva a cada petición;
- aísle a cada empresa (`AGENTS.md` §7.1);
- no se pueda sobrepasar por peticiones concurrentes;
- falle cerrado: sin poder comprobarlo, no se llama al modelo.

El sistema de registro de la plataforma es Postgres en Supabase con RLS (ADR-0006, ADR-0015); las escrituras sensibles ya pasan por funciones `security definer` que comprueban pertenencia y rol.

## Problema
¿Dónde y cómo se lleva el consumo acumulado de IA de cada empresa para que el límite sea real, también con peticiones concurrentes?

## Criterios de decisión
- El límite se cumple bajo concurrencia, no solo "en promedio".
- Aislamiento por empresa y sin exponer contenido (solo cifras).
- Falla cerrado, y el producto sigue funcionando con el borrador por reglas.
- Reutiliza lo que ya existe (Postgres, RLS, funciones, `lib/db/`) y no añade infraestructura nueva sin necesidad.
- Coste y esfuerzo proporcionales al volumen esperado.

## Opciones consideradas

### Opción A: Seguir con `AiState` en memoria (y, a lo sumo, un tope fijo por petición)
- **Ventajas:** ya existe; ningún cambio.
- **Inconvenientes:** no acumula entre peticiones ni entre instancias; con concurrencia se sobrepasa sin límite. Un tope por petición acota cada llamada, pero **no es un límite por empresa**.
- **Coste y esfuerzo:** nulo. **Rechazada** como límite acumulado: solo vale como tope por petición.

### Opción B: Cloudflare KV
- **Ventajas:** ya está en la pila; lecturas rápidas.
- **Inconvenientes:** consistencia eventual y sin operaciones atómicas: dos peticiones leen el mismo saldo y ambas escriben. **Rechazada** para un contador con tope duro.

### Opción C: Durable Object por empresa
- **Ventajas:** ejecución serializada por empresa, contador exacto.
- **Inconvenientes:** infraestructura nueva (bindings, despliegue, observabilidad) y un segundo sistema de registro para algo que el modelo de datos ya sabe hacer; el consumo debería además llegar a Postgres para facturación e informes.
- **Coste y esfuerzo:** alto. **Descartada por ahora**; reconsiderar si el volumen exigiera latencias que Postgres no da.

### Opción D: Postgres con reservas atómicas (reservar antes, liquidar después)
- **Ventajas:** el límite lo hace cumplir una sola sentencia atómica con bloqueo de fila; RLS y funciones ya son el patrón; el consumo queda donde se factura y se informa; sin infraestructura nueva.
- **Inconvenientes:** una ida y vuelta a la base antes de cada llamada y otra al terminar; hay que diseñar con cuidado reservas huérfanas y la precisión.
- **Coste y esfuerzo:** medio: una migración con dos tablas y tres funciones, y pruebas de concurrencia.

## Decisión
**Opción D.** El presupuesto vive en la base de datos y se consume en dos tiempos.

**Modelo (a precisar en la migración, bajo la skill `kyn-data`):**
- `ai_budget_periods (tenant_id, period_start, limit_micros, reserved_micros, spent_micros)`: una fila por empresa y periodo (mes UTC). Cifras en micros de dólar (`bigint`), nunca contenido. Invariante: `reserved_micros + spent_micros <= limit_micros`.
- `ai_reservations (id, tenant_id, period_start, purpose_id, amount_micros, idempotency_key, status, expires_at)` con `unique (tenant_id, idempotency_key)`. Estados: `held`, `settled`, `released`, `expired`.

**Funciones (`security definer`, `search_path` vacío, comprueban pertenencia y el permiso `write` con el mismo mecanismo de `require_write`):**
1. `reserve_ai_budget(p_tenant, p_purpose, p_estimate_micros, p_idempotency_key, p_ttl_seconds)`: en **una sola sentencia** `update ai_budget_periods set reserved_micros = reserved_micros + p_estimate where tenant_id = p_tenant and period_start = <mes UTC actual> and reserved_micros + unreconciled_micros + spent_micros + p_estimate <= limit_micros returning …`; si no actualiza ninguna fila, rechaza (`budget_exceeded`). El bloqueo de fila serializa las peticiones concurrentes de la misma empresa. Es idempotente por `idempotency_key` (índice único `(tenant_id, idempotency_key)` y `on conflict do nothing`): repetir la petición devuelve la misma reserva sin reservar dos veces, y reutilizar la clave para otra petición es un error. **Sin asignación explícita para el mes, el presupuesto es 0** (`no_budget`): no se inventa ningún plan, precio ni importe.
2. `settle_ai_budget(p_reservation, p_attempts)`: recibe **todos los intentos** del proveedor (hasta 20: `attempt_no`, `role` primary/retry/fallback, proveedor, modelo, tokens, `cost_micros`, `billable`). El coste liquidado es la suma de lo **almacenado** de los intentos facturables, así que repetir la liquidación o un número de intento no cuenta dos veces. Mueve de `reserved` a `spent`; lo no gastado vuelve a quedar libre; si el coste supera lo reservado se registra como `overage` y cuenta como gasto. Idempotente.
3. `release_ai_budget(p_reservation)`: solo para una reserva **vigente** cuya llamada no llegó al proveedor (se rechaza si hay intentos registrados y siempre si la reserva venció).
4. `write_off_ai_reservation(p_reservation, p_note)`: solo `owner`/`admin`, con un motivo escrito de 10 a 500 caracteres y registro en el log de acciones; es la única forma de que una reserva vencida deje de contar sin liquidación (por ejemplo, el proveedor confirmó que no hubo cobro).
5. `assign_ai_budget(p_tenant, p_period, p_limit_micros)` y `expire_ai_reservations()`: solo con la clave de servidor (`service_role`). **La empresa nunca fija su propio límite** (lo asigna la plataforma) y un límite no puede bajar de lo ya comprometido.

**Estimación por reserva.** Se reserva el **peor caso de toda la cadena**: cada modelo de la cadena del Gateway, tantas veces como el Gateway puede intentarlo según la prioridad, con la entrada y la respuesta máximas (`worstCaseMicros` en `lib/ai/budget.ts`). Así los reintentos y los respaldos ya están cubiertos. Los precios son los de `lib/ai/providers.ts`, que siguen siendo **valores de referencia a verificar** antes de encender nada.

**Intentos facturables.** Cada intento del proveedor se registra (`ai_usage_attempts`, solo agregar). Qué cuenta como facturado es una política explícita y conservadora (`BILLING_POLICY`): un éxito cuenta por sus tokens reales; un intento que pudo procesarse (tiempo agotado, fallo de red o de servidor) cuenta por su peor caso; un rechazo previo al procesamiento (límite de tasa, clave inválida, petición inválida) no cuenta; un resultado desconocido cuenta por su peor caso. Esa tabla debe contrastarse con facturas reales antes de conectar un proveedor.

**Reservas vencidas: no liberan gasto.** Si un proceso muere sin liquidar, la llamada pudo haberse hecho y cobrado. Por eso una reserva vencida **no devuelve su importe**: la función de mantenimiento la pasa a `expired_unreconciled` y su importe sigue contando contra el límite (`unreconciled_micros`). Sale de ahí solo por (a) **conciliación**: `settle_ai_budget` con los intentos que informó el proveedor (se exige al menos uno como evidencia), o (b) **cancelación** por `owner`/`admin` con motivo escrito (`write_off_ai_reservation`). Un `release` nunca la cierra. El coste es que una reserva olvidada ocupa presupuesto hasta que alguien la concilia: se acepta a cambio de no gastar sin contar.

**Falla cerrado.** Si `reserve_ai_budget` no responde, devuelve error o la empresa no tiene fila de presupuesto, **no se llama al modelo** y se usa el respaldo por reglas con `reason: "budget_unavailable"` (ya implementado en `generateDraft`). La IA nunca bloquea el producto.

**Límites por empresa.** `limit_micros` lo asigna la plataforma con la clave de servidor para un mes UTC concreto (`assign_ai_budget`); no existe aquí ningún plan, precio ni importe comercial y **de dónde sale el valor es una decisión pendiente** (por ejemplo, el plan de Billing). Sin asignación explícita, el presupuesto del mes es 0.

**Qué NO hace esta decisión:** no elige proveedor, modelo ni precios (siguen siendo configuración revisada, ADR-0016), no cambia KOE ni el Gateway, y no persiste prompts ni respuestas.

## Consecuencias
- **Positivas:** límite duro bajo concurrencia; consumo auditable por empresa y por propósito; reutiliza RLS, funciones y el patrón de mantenimiento; el borrador por reglas sigue disponible siempre.
- **Negativas:** dos llamadas a la base por cada llamada al modelo; una tabla caliente por empresa (contención por fila: aceptable al volumen previsto, medir); trabajo de migración y pruebas.
- **Riesgos y mitigaciones:**
  - *Reservas vencidas que ocupan saldo:* se concilian con los intentos del proveedor o se cancelan con motivo; alerta si `unreconciled_micros` supera un umbral y panel de reservas vencidas para `owner`/`admin`.
  - *Estimación demasiado pesimista (reserva de más):* ajustar los máximos de tokens por propósito; la diferencia se devuelve al liquidar.
  - *Precios desactualizados:* la reserva guarda la versión del precio; la tabla de precios requiere verificación antes de encender (condición ya registrada en `FIRST_WORK_AI`).
  - *Estimación demasiado baja:* si un intento costó más de lo reservado, el `overage` queda registrado y cuenta como gasto (puede dejar el mes sobre el límite por ese margen); mitigación: estimar por el peor caso de la cadena.
  - *Zona horaria del periodo:* mes UTC, documentado en la interfaz.

## Impacto en el framework
- **Reglas no negociables (`AGENTS.md` §7) afectadas:** §7.1 (aislamiento por empresa: RLS en las dos tablas y funciones que comprueban pertenencia) y §7.3 (acceso a datos solo por `lib/db/`). §7.11 aplica a la migración (no se aplica a producción sin aprobación).
- **RULES afectadas:** `ai.md` 14 y 15 (límites y presupuesto por tenant; registro de coste sin contenido) pasan de "configurar" a "persistir".
- **Skills afectados:** `kyn-data` (migración, RLS, pruebas de aislamiento y de concurrencia) y `kyn-ai`.
- **Módulos afectados:** `lib/ai/` (adaptador que reserva y liquida alrededor de `askAi`), `lib/db/` (funciones de acceso), Billing (origen del límite).

## Plan de implementación
1. **Hecho (sin aplicar):** migración `supabase/migrations/20261118000100_ai_budget.sql`: tablas, RLS (solo `owner`/`admin` leen las cifras de su empresa; ninguna escritura directa), funciones y mantenimiento; reversión documentada en la propia migración. **Falta aprobarla y aplicarla** primero en un proyecto de desarrollo.
2. **Hecho (se ejecuta en la CI, no se ha ejecutado aquí por falta de Postgres local):** `supabase/tests/ai_budget.sql` (RLS y privilegios, presupuesto 0 sin asignación, idempotencia, límite, liquidación de reintentos y respaldos, vencimiento que no libera, cancelación, aislamiento, borrado de empresa) y `supabase/tests/ai_budget_concurrency.sh` (40 sesiones paralelas contra un límite de 10 reservas: exactamente 10 concedidas; una misma clave en 20 sesiones: una reserva; la misma liquidación en 10 sesiones: cada intento una vez). Ambos están en el flujo `rls-isolation`.
3. **Hecho:** acceso desde `lib/db/ai-budget.ts` (`createAiBudgetStore`), contrato en `lib/contracts/ai-budget.ts` y adaptador en `lib/ai/budget.ts` (`createBudgetGate`, con la forma `{ reserve(): Promise<boolean> }` que ya espera `generateDraft`; `worstCaseMicros`; `rowsFromAttempts`). Falta conectarlo a `askAi`, que sigue sin llamarse.
4. Cargar límites por plan; panel de consumo (solo cifras) para `owner`/`admin`.
5. Solo entonces, y como decisión aparte: elegir proveedor y modelo, verificar precios vigentes, definir límites, ejecutar los evals de `prompts/evals/nex/first-work-draft.yaml` y poner `FIRST_WORK_AI.enabled` en `true`.

## Plan de reversión
Mientras no se encienda ningún modelo, la migración y las funciones pueden retirarse sin efecto en el producto (el borrador por reglas no depende de ellas). Una vez encendido, revertir significa apagar `FIRST_WORK_AI.enabled` (vuelve a reglas) y después retirar las tablas; el consumo histórico se exporta antes. El punto de no retorno es cuando la facturación use esas cifras.

## Verificación
- La prueba de concurrencia en CI demuestra que `reserved + spent` nunca supera `limit` con reservas simultáneas.
- Con la base inaccesible o sin fila de presupuesto, `generateDraft` responde con `source: "rules"` y `reason: "budget_unavailable"` y no llama a ningún proveedor.
- Una empresa no puede leer ni modificar el consumo de otra (pruebas de aislamiento).
- Ninguna fila contiene contenido de prompts ni de respuestas.

## Revisión
Antes de encender el primer modelo, y al medir contención de la fila caliente o al superar el volumen que Postgres atienda con holgura (entonces valorar la opción C).

## Referencias
- ADR-0006 (datos y tenancy), ADR-0012 (AI Gateway), ADR-0015 (Backend Core en Supabase), ADR-0016 (proveedores reales detrás del Gateway).
- `lib/ai/`, `lib/first-work-draft.ts` (`FIRST_WORK_AI`, `missingForModel`), `lib/contracts/platform/koe-ai-center.ts` (`AiState`).
- `.claude/rules/ai.md` 14 y 15; `prompts/nex/first-work-draft.md` y su suite de evals.

## Enmienda (2026-11-21): tope de llamadas por periodo

Para la primera prueba de IA (30 llamadas facturables en total) la base cuenta también las **llamadas**, con el mismo mecanismo atómico que el dinero:

- `ai_budget_periods.max_calls` (opcional, nulo = sin tope) y `calls_used`. `reserve_ai_budget` suma 1 a `calls_used` en el mismo `UPDATE` que comprueba el límite de dinero y exige `calls_used < max_calls`; si falla por el tope responde `call_limit_reached` (se informa primero) sin dejar fila.
- `assign_ai_call_cap(p_tenant, p_period, p_max_calls)`: solo `service_role`; exige que el presupuesto del periodo ya esté asignado y que el tope no quede por debajo de las llamadas usadas; `null` lo quita. La empresa nunca fija su propio tope.
- Una reserva repetida con la misma clave **no** gasta otra llamada. `release_ai_budget` devuelve su hueco (la llamada nunca llegó al proveedor). **El vencimiento y la cancelación con motivo no lo devuelven** (esa llamada pudo facturarse). `settle_ai_budget` suma las llamadas facturables **adicionales** (reintentos y respaldos) a la reserva, una sola vez.
- **Supuesto:** una reserva es una llamada, es decir, **un intento por petición**; los intentos extra solo se descubren al liquidar.
- Cota de entrada: `lib/ai/input-bound.ts` es una cota **conservadora, no un máximo garantizado por el proveedor**; lo único que el proveedor impone es la salida (`max_completion_tokens`).
- Sigue **sin aplicarse** en ningún Supabase: la migración `20261118000100` se modificó antes de aplicarse (no hay nada que migrar de una versión anterior).
