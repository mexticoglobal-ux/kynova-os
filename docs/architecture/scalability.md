# Estrategia de escalabilidad (millones de registros)

> Parte de [ADR-0010](../decisions/0010-conversaciones-y-datos-de-prospectos.md). **Propuesto, sin código.** Fecha: 2026-11-06.
> Las cifras son **estimaciones de planificación**, no mediciones. Lo que dependa de límites de Supabase o Cloudflare está marcado **a verificar**: no se asume.

## 1. Qué significa "preparado para millones"

Un solo Postgres bien indexado y particionado maneja **cientos de millones de filas** en las tablas de volumen; el problema real no es el número de filas sino **tres cosas**: consultas sin índice por tenant, tablas que crecen sin retención, y conexiones desde Workers. El diseño ataca esas tres, y deja una salida (extraer tenants grandes) para cuando un solo proyecto no alcance.

## 2. Modelo de carga (hipótesis de planificación)

| Escala | Empresas | Contactos por empresa | Mensajes por contacto | Totales aproximados |
|--------|---------:|----------------------:|----------------------:|---------------------|
| **Piloto** (Nova + KYNOVA) | 2 | 5 000 | 20 | 10⁴ contactos · 2·10⁵ mensajes |
| **Año 1** | 200 | 20 000 | 30 | 4·10⁶ contactos · 1,2·10⁸ mensajes |
| **Año 3** | 2 000 | 50 000 | 40 | 10⁸ contactos · 4·10⁹ mensajes |

El año 3 **excede un solo proyecto** para mensajes: de ahí la retención, el archivo a R2 y la extracción de tenants (§9–10). El **año 1** sí cabe, con particiones.
Distribución: muy desigual (unos pocos tenants concentran la mayoría): el diseño por tenant debe tolerar un **tenant 100 veces mayor que la mediana**.

## 3. Las seis palancas

| # | Palanca | Qué se hace | Dónde |
|---|---------|-------------|-------|
| 1 | **Índices con `tenant_id` primero** | Cada consulta de producto empieza por el tenant; los índices parciales cubren los estados "abiertos" | [data-catalog.md](data-catalog.md) |
| 2 | **Particiones mensuales** en 5 tablas | Consultas recientes tocan 1–2 particiones; la retención es desprender, no borrar | [migrations.md](migrations.md) §5 |
| 3 | **Paginación por clave** | `where (tenant_id, key) > (…) order by … limit N`; **nunca** `offset` ni `count(*)` en caliente | §5 |
| 4 | **Rollups precalculados** | `metrics_daily` para el Dashboard y Analytics | §6 |
| 5 | **Trabajo asíncrono** | Colas para lo que no debe bloquear la petición (envío, normalización, rollups) | §7 |
| 6 | **Retención y archivo** | Los datos fríos salen de la base activa | §9 |

## 4. Particionado: reglas concretas

- **Tablas:** `messages`, `inbound_events`, `action_log`, `audit_log`, `payment_events`. **Ninguna otra** al inicio.
- **Clave:** el instante (`created_at`/`received_at`/`occurred_at`), por mes. La PK incluye la clave de partición.
- **IDs:** UUIDv7 (ordenable por tiempo) para `messages` y las tablas de alto volumen: la inserción es **casi secuencial** en el índice (mucho mejor localidad y menos fragmentación que UUIDv4) y el id permite extraer el instante.
  **A verificar:** la versión de Postgres del proyecto. Si `uuidv7()` no es nativa, se genera en `lib/db/` o con una función propia (decisión en M1).
- **Unicidad global imposible:** una tabla particionada no puede garantizar unicidad fuera de su clave de partición. Por eso existe `inbound_dedup` (sin partición, podada) para idempotencia de eventos entrantes y `outbox_messages.idempotency_key` para los salientes.
- **Sin FK hacia tablas particionadas** (salvo compuestas con la clave de partición): `attachments` guarda `(message_id, message_created_at)`.
- **Umbral de revisión de otras tablas:** `conversations`, `contacts`, `activities` y `contact_identities` se **evalúan para particionar por hash de `tenant_id`** si alguna supera ~10⁸ filas o si un solo tenant domina su tamaño (§8).

## 5. Patrones de consulta

| Pantalla | Patrón | Índice |
|----------|--------|--------|
| Bandeja de conversaciones | `where tenant_id = $1 and status = 'open' and (last_message_at, id) < ($2, $3) order by last_message_at desc, id desc limit 50` | `(tenant_id, status, last_message_at desc)` |
| Hilo | `where tenant_id = $1 and conversation_id = $2 and (created_at, id) > ($3, $4) order by created_at, id limit 100` | `(tenant_id, conversation_id, created_at, id)` por partición |
| Pipeline de leads | por `(tenant_id, status, priority, next_action_at)` | índice parcial de abiertos |
| Búsqueda de contactos | `pg_trgm` sobre nombre; **búsqueda de texto completo** solo si aparece la necesidad | GIN por `tenant_id` + trigram |
| "¿Ya conozco a esta persona?" | un acceso al índice único de `contact_identities` | `unique (tenant_id, kind, provider, value_normalized)` |

Reglas: sin `select *`; sin `count(*)` sobre tablas grandes (se usan rollups o estimaciones); sin `offset` profundo; toda consulta de producto lleva `tenant_id`.

## 6. Contadores y métricas

- **`metrics_daily`** (`tenant_id, day, metric_key, dimension_key, value`) llenada por **lotes** desde las tablas operativas (leads nuevos, calificados por grado, oportunidades por etapa, conversaciones, mensajes, respuestas, tiempo de primera respuesta).
- El **Dashboard** lee solo rollups y `action_log` reciente: tiempo de respuesta independiente del tamaño del tenant.
- **Evitar filas calientes:** nada de un contador único actualizado en cada mensaje; el `unread_count` se calcula por demanda o se actualiza por lotes.
- **Vistas materializadas** solo para consultas administrativas, refrescadas fuera de horario.

## 7. Trabajo asíncrono y orden

| Necesidad | Mecanismo (**no se construye ahora**) |
|-----------|---------------------------------------|
| Recibir un webhook rápido | El Worker valida firma, guarda `inbound_events` + `inbound_dedup` y **responde de inmediato**; el procesamiento va a una cola |
| Procesar/normalizar eventos | **Cloudflare Queues** con reintentos y cola de mensajes fallidos |
| Enviar mensajes salientes | `outbox_messages` (outbox transaccional) → un procesador por tenant con **límite de tasa** por canal |
| Orden dentro de una conversación | Procesar **por `conversation_id`** de forma serializada (un Durable Object por conversación **solo si** el orden resulta ser un problema real) |
| Rollups, retención, creación de particiones | Trabajos programados (Cron Triggers de Workers o `pg_cron`) |

Los límites de tamaño, de concurrencia y de precio de Queues y Durable Objects son **a verificar** al implementar. Ninguna pieza se agrega hasta que haya una necesidad medida.

## 8. Aislamiento de carga entre empresas ("vecino ruidoso")

| Control | Detalle |
|---------|---------|
| **Cuotas por plan** | Mensajes por mes, contactos y almacenamiento por tenant; superar la cuota **degrada de forma controlada** (se encola y se avisa), no se tumba |
| **Límite de tasa** | Por tenant y por canal en la ingesta pública y en el envío (también por IP en el chat web) |
| **Tiempos máximos** | `statement_timeout` por rol; consultas administrativas aparte |
| **Detección** | `pg_stat_statements` y un tablero de "tenants por uso" para encontrar a quien domina |
| **Medidas** | Índices específicos, partición por hash de ese tenant, mover sus trabajos a otra cola; en el extremo, extraerlo (§10) |

## 9. Retención y archivo

| Dato | Retención propuesta (**pendiente de decisión legal y de producto**) | Qué pasa después |
|------|-----------------------|------------------|
| `inbound_events` (cargas crudas) | 30–90 días | Se desprende la partición |
| `inbound_dedup` | 14 días | Poda por lotes |
| `outbox_messages` enviados | 30 días | Poda por lotes |
| `messages` | 24 meses (configurable) | **Archivo a R2** en formato columnar comprimido por tenant y mes, luego se desprende; restaurable bajo petición |
| `action_log`, `audit_log` | 7 años | Archivo a R2; consulta bajo petición |
| `contacts`, `leads`, `opportunities`, `customers` | Mientras dure la relación | Anonimización por solicitud ([data-catalog.md](data-catalog.md) §8) |

Esto también reduce el costo: el almacenamiento de base de datos es más caro que R2.

## 10. Crecer más allá de un proyecto

1. **Escalar hacia arriba:** instancia mayor; más memoria para el conjunto activo de índices.
2. **Réplicas de lectura** (a verificar disponibilidad y precio en el plan): analítica, exportaciones y el Dashboard pesado. Escrituras siempre al primario.
3. **Pool de conexiones:** los Workers **no mantienen conexiones persistentes**; PostgREST sobre HTTP evita el problema en lecturas y escrituras simples. Para consultas complejas o procesos largos se evalúa **Hyperdrive** o el pooler (Supavisor): **requiere su propio ADR** (ADR-0006).
4. **Extraer un tenant** (por tamaño o por residencia contractual): como `tenant_id` es la clave y los ids son UUID globales, su conjunto de filas se copia a **otro proyecto** y se enruta por una tabla de directorio `tenant → proyecto`. **No hay que renumerar nada.** Requiere que **todo acceso a datos pase por `lib/db/`** (ya es regla) para poder resolver el proyecto por tenant.
5. **Fragmentación horizontal real** (Citus u otro): fuera de este alcance; el diseño no la impide.

## 11. Puerta de rendimiento antes de producción

Antes de cualquier dato real, una **prueba de carga sintética** con: **10 millones de contactos, 4 millones de leads, 200 millones de mensajes** repartidos en 200 tenants con una distribución desigual (un tenant 100 veces mayor), y consultas concurrentes de las pantallas de §5 **con RLS activo**.
Presupuestos propuestos (a confirmar): bandeja y hilo p95 < 150 ms; búsqueda de identidad p95 < 20 ms; ingesta (hasta responder el webhook) p95 < 300 ms; un mes de partición de mensajes se crea y desprende sin bloquear lecturas.
Si no se cumplen, se actúa **antes** de producción: índices, particiones adicionales o la alternativa de reclamaciones en el JWT para RLS.

## 12. Observabilidad

`request_id` y `tenant_id` en toda traza; métricas de latencia por consulta (`pg_stat_statements`), tamaño de tablas y particiones, profundidad de colas, tasa de errores por canal y proveedor, tiempo de primera respuesta. Alertas: partición futura ausente, cola creciendo, tenant que supera el 20 % de una tabla, p95 por encima del presupuesto. Sin cuerpos de mensajes ni PII en los registros.

## 13. Umbrales de acción

| Señal | Acción |
|-------|--------|
| `messages` > 50 millones de filas en una partición mensual | Revisar índices; considerar subparticiones por hash de tenant |
| Una tabla no particionada > 10⁸ filas | Plan de partición por hash de `tenant_id` |
| Un tenant > 20 % de una tabla de volumen | Medidas de §8 |
| Replicación o lecturas pesadas afectan escrituras | Réplica de lectura (§10.2) |
| Un proyecto > ~70 % del almacenamiento del plan | Archivo a R2 adelantado o extracción de tenants |
