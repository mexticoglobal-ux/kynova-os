# ADR-0036: Presupuesto de IA persistente por empresa, con reservas atómicas para el consumo concurrente

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
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
1. `reserve_ai_budget(p_tenant, p_purpose, p_estimate_micros, p_idempotency_key, p_ttl_seconds)`: en **una sola sentencia** `update ai_budget_periods set reserved_micros = reserved_micros + p_estimate where tenant_id = p_tenant and period_start = <periodo actual> and reserved_micros + spent_micros + p_estimate <= limit_micros returning …`; si no actualiza ninguna fila, rechaza. El bloqueo de fila serializa las peticiones concurrentes de la misma empresa. Es idempotente por `idempotency_key`: repetir la llamada devuelve la misma reserva sin reservar dos veces.
2. `settle_ai_budget(p_reservation, p_actual_micros)`: mueve de `reserved` a `spent` el coste real (tokens y precios que informa el proveedor) y devuelve la diferencia a lo libre. Idempotente.
3. `release_ai_budget(p_reservation)`: libera la reserva si la llamada falla antes de empezar o no llega al proveedor.

**Estimación por reserva.** Se reserva el **peor caso**: `maxInputTokens × precio de entrada + maxOutputTokens × precio de salida`, con los límites de KOE y los precios vigentes de `lib/ai/providers.ts` (versión del precio guardada en la reserva). Así `spent` no puede exceder el límite aunque haya muchas llamadas en vuelo.

**Reservas huérfanas.** Si un proceso muere sin liquidar, la reserva caduca a los `ttl` segundos (mayor que el tiempo máximo del proveedor) y una función de mantenimiento (`maintain_partitions` ya existe como patrón) la marca `expired` y devuelve el saldo. Una liquidación tardía de una reserva caducada se acepta y puede dejar el periodo por encima del límite como máximo en el coste de **una** petición por reserva caducada; se registra como "deuda" visible y reduce el periodo siguiente. Este desvío acotado se documenta como aceptado.

**Falla cerrado.** Si `reserve_ai_budget` no responde, devuelve error o la empresa no tiene fila de presupuesto, **no se llama al modelo** y se usa el respaldo por reglas con `reason: "budget_unavailable"` (ya implementado en `generateDraft`). La IA nunca bloquea el producto.

**Límites por empresa.** `limit_micros` sale del plan de la empresa (Billing) y solo lo cambian `owner` o `admin` por una función con auditoría; el valor por defecto de una empresa sin plan es 0 (sin IA).

**Qué NO hace esta decisión:** no elige proveedor, modelo ni precios (siguen siendo configuración revisada, ADR-0016), no cambia KOE ni el Gateway, y no persiste prompts ni respuestas.

## Consecuencias
- **Positivas:** límite duro bajo concurrencia; consumo auditable por empresa y por propósito; reutiliza RLS, funciones y el patrón de mantenimiento; el borrador por reglas sigue disponible siempre.
- **Negativas:** dos llamadas a la base por cada llamada al modelo; una tabla caliente por empresa (contención por fila: aceptable al volumen previsto, medir); trabajo de migración y pruebas.
- **Riesgos y mitigaciones:**
  - *Reservas huérfanas que bloquean saldo:* caducidad por `ttl` y barrido; alerta si `held` supera un umbral.
  - *Estimación demasiado pesimista (reserva de más):* ajustar los máximos de tokens por propósito; la diferencia se devuelve al liquidar.
  - *Precios desactualizados:* la reserva guarda la versión del precio; la tabla de precios requiere verificación antes de encender (condición ya registrada en `FIRST_WORK_AI`).
  - *Desvío por liquidación tardía:* acotado a una petición por reserva caducada y visible.
  - *Zona horaria del periodo:* mes UTC, documentado en la interfaz.

## Impacto en el framework
- **Reglas no negociables (`AGENTS.md` §7) afectadas:** §7.1 (aislamiento por empresa: RLS en las dos tablas y funciones que comprueban pertenencia) y §7.3 (acceso a datos solo por `lib/db/`). §7.11 aplica a la migración (no se aplica a producción sin aprobación).
- **RULES afectadas:** `ai.md` 14 y 15 (límites y presupuesto por tenant; registro de coste sin contenido) pasan de "configurar" a "persistir".
- **Skills afectados:** `kyn-data` (migración, RLS, pruebas de aislamiento y de concurrencia) y `kyn-ai`.
- **Módulos afectados:** `lib/ai/` (adaptador que reserva y liquida alrededor de `askAi`), `lib/db/` (funciones de acceso), Billing (origen del límite).

## Plan de implementación
1. Migración nueva (L + ADR aprobado): tablas, RLS (miembros leen cifras de su empresa; ninguna escritura directa), funciones y barrido; reversión por migración inversa.
2. Pruebas SQL en CI (`rls-isolation`): aislamiento entre empresas, idempotencia, **concurrencia** (N sesiones paralelas reservando contra un límite pequeño: la suma nunca supera el límite) y caducidad.
3. Acceso desde `lib/db/` y un adaptador en `lib/ai/` con la forma `{ reserve(): Promise<boolean> }` que ya espera `generateDraft`, más `settle` con tokens y precio reales.
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
