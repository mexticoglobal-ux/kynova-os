# Catálogo de datos — tablas, relaciones, índices y auditoría

> Parte de [ADR-0010](../decisions/0010-conversaciones-y-datos-de-prospectos.md). **Propuesto, sin código ni migraciones.** Fecha: 2026-11-06.
> Diagramas en [er-model.md](er-model.md). Aislamiento en [multitenancy.md](multitenancy.md). Orden de creación en [migrations.md](migrations.md).

## 1. Convenciones que valen para todas las tablas

| Tema | Regla |
|------|-------|
| Nombres | Inglés, `snake_case`, plural. Columnas de fecha `*_at` (`timestamptz`); de día `*_on` (`date`) |
| Claves | `id uuid`. Tablas de alto volumen usan **UUIDv7** (ordenado por tiempo); el resto, `gen_random_uuid()`. Ver §4 de [scalability.md](scalability.md) |
| Tenant | `tenant_id uuid not null` en toda tabla de negocio, **primera columna de casi todos los índices**. `workspace_id uuid null` reservado (sin FK hasta que exista `workspaces`) |
| Referencias | FK **compuestas** `(tenant_id, x_id)` hacia `unique (tenant_id, id)` del padre. Sin esto no se acepta una FK en una tabla de negocio |
| Valores cerrados | `text` + `CHECK` (como en las migraciones existentes), no tipos `enum` de Postgres: cambiar un valor no bloquea la tabla. Lo configurable por empresa va en tablas (`pipeline_stages`) |
| Dinero | `*_minor bigint` (unidades menores) + `currency char(3)`. Nunca flotantes |
| Flexibles | `jsonb` solo para datos que **no se filtran** (cargas crudas, resultados de evaluación, borradores). Validados con `lib/contracts/` en el borde. Límite de tamaño por `CHECK (pg_column_size(...) < N)` |
| Estados | Columna `status` con `CHECK`; las transiciones válidas las impone una función única por entidad, no el cliente |
| Borrado | **No hay borrado lógico genérico.** Los leads y clientes no se eliminan (regla de Sales). Los datos personales se **anonimizan** (§8). Los datos de volumen salen por **retención de particiones** |
| Marcas de tiempo | `created_at`, `updated_at` (con `private.touch_updated_at()`), salvo tablas append-only (solo `created_at`/`occurred_at`) |
| Autoría | `created_by`/`updated_by` solo donde hay usuario; para NEX y sistemas se usa `actor_type` + `actor_id` (ver §7) |

### Clases de acceso (qué políticas RLS lleva cada tabla)

| Clase | Lectura | Escritura | Ejemplos |
|-------|---------|-----------|----------|
| **RW-M** | Miembros del tenant | Miembros (insert/update); sin delete | contacts, leads, opportunities, activities |
| **RW-O** | Miembros | Solo propietarios | pack_versions, integration_accounts, work_agreements, authorizations, pipelines |
| **AO** (append-only) | Miembros | Solo `INSERT` (por función); `UPDATE`/`DELETE` revocados y bloqueados por trigger | audit_log, action_log, assessment_runs, handoffs, consent_records, payment_events |
| **SYS** | Miembros (o nadie) | Solo funciones de ingesta/procesos del sistema, nunca usuarios | inbound_events, inbound_dedup, outbox_messages, payments |
| **OWN** | Solo la propia fila | La propia fila | user_profiles |

### Clases de volumen (por tabla, en toda la plataforma)

| Clase | Filas esperadas | Tratamiento |
|-------|-----------------|-------------|
| **S** | < 10⁵ | Sin particiones; índices normales |
| **M** | 10⁵ – 10⁷ | Índices parciales y cubrientes; paginación por clave |
| **L** | 10⁷ – 10⁸ | Candidata a partición; vigilada con umbrales ([scalability.md](scalability.md)) |
| **XL** | > 10⁸ | **Partición mensual desde el primer día**, retención por desprendimiento de partición |

## 2. Plataforma

### `tenants` — existente · S · RW-O (solo servidor)
Unidad de aislamiento. Ya en `20261031000000_tenancy_core.sql`.
**Cambios propuestos:** `slug text unique` (ruta pública del chat, minúsculas y guiones), `region text` (reservado; hoy sin decidir). Índices: PK; `unique (slug)`.

### `memberships` — existente · S · lectura propia
`(user_id, tenant_id)` PK, `role` (`owner`/`member`; **roles finos requieren ADR**). Índice por `tenant_id`. Se añade `status text` (`active`/`invited`/`removed`) solo cuando exista invitación.

### `business_profiles` — existente · S · RW-O
Un perfil por tenant (ADR-0006). Sin cambios.

### `user_profiles` — nueva · S · OWN
`user_id` PK → `auth.users`, `display_name`, `locale`, `created_at`, `updated_at`. Para mostrar responsables sin exponer `auth.users`. Un miembro ve los nombres de los compañeros de su tenant mediante una **vista `security_invoker`** `tenant_members` (membresía ⋈ perfil).

## 3. CRM

### `organizations` — nueva · M · RW-M
| Columna | Notas |
|---------|-------|
| `id`, `tenant_id`, `workspace_id` | |
| `name text` | 1–200 caracteres |
| `domain text null` | sitio web normalizado (minúsculas, sin protocolo) |
| `sector text null`, `size_band text null`, `country char(2) null` | valores cerrados (mismos de `business_profiles`) |
| `attributes jsonb` | campos propios de la empresa cliente; ≤ 16 KB |
| `created_at`, `updated_at` | |

Restricciones: `unique (tenant_id, id)`. Índices: `(tenant_id, lower(name))`; `(tenant_id, domain) where domain is not null`; trigram `name` (`pg_trgm`) para búsqueda.

### `contacts` — nueva · L · RW-M
**Identidad única de una persona** frente a un tenant, desde que es un visitante anónimo hasta que es cliente.
| Columna | Notas |
|---------|-------|
| `id` (UUIDv7), `tenant_id`, `workspace_id` | |
| `organization_id` | FK compuesta nullable |
| `display_name text` | "Visitante" mientras no dé nombre; ≤ 120 |
| `first_name`, `last_name` | nullable |
| `lifecycle_stage text` | `prospect` · `lead` · `customer` · `former`. **Derivada y mantenida por funciones de transición** ([commercial-lifecycle.md](commercial-lifecycle.md)); no se edita a mano |
| `locale`, `country`, `time_zone` | nullable |
| `owner_user_id uuid null` | responsable actual |
| `source_provider text`, `source_integration_account_id` | por dónde llegó primero |
| `attributes jsonb` | ≤ 16 KB |
| `merged_into_id uuid null` | fusión de duplicados: el contacto "perdedor" apunta al ganador |
| `anonymized_at timestamptz null` | marca de borrado por solicitud (§8) |
| `last_activity_at` | para ordenar sin contar |
| `created_at`, `updated_at` | |

Restricciones: `unique (tenant_id, id)`; `check (merged_into_id is null or merged_into_id <> id)`.
Índices: `(tenant_id, lifecycle_stage, last_activity_at desc)`; `(tenant_id, owner_user_id) where owner_user_id is not null`; `(tenant_id, lower(display_name))` + trigram para búsqueda; `(tenant_id, created_at desc)`.
PII: sí (`display_name`, `first_name`, `last_name`, `attributes`). Auditoría: trigger de fila **con campos redactados** (§7).

### `contact_identities` — nueva · L · RW-M
Cada forma de reconocer al contacto: correo, teléfono, cuenta de canal, cliente de pasarela.
| Columna | Notas |
|---------|-------|
| `id`, `tenant_id`, `contact_id` | FK compuesta |
| `kind text` | `email` · `phone` · `whatsapp` · `facebook_psid` · `instagram_igsid` · `web_visitor` · `payment_customer` |
| `provider text null` | cuenta o pasarela concreta (p. ej. `stripe`) cuando el identificador solo vale ahí |
| `value_normalized text` | correo en minúsculas; teléfono en E.164; ids de canal tal cual |
| `verified_at`, `is_primary` | |
| `created_at` | |

Restricciones: **`unique (tenant_id, kind, coalesce(provider,''), value_normalized)`**: es el mecanismo de deduplicación entre canales. Índice por `(tenant_id, contact_id)`.
PII: sí. Es la tabla que se consulta para "¿ya conozco a esta persona?" en cada mensaje entrante: debe resolverse con un solo acceso por índice único.

### `leads` — nueva · M · RW-M
Un **episodio de interés comercial** de un contacto. Un contacto puede tener varios a lo largo del tiempo, **uno abierto a la vez**.
| Columna | Notas |
|---------|-------|
| `id`, `tenant_id`, `workspace_id`, `contact_id` | |
| `status text` | `new` · `working` · `qualified` · `disqualified` · `converted` · `spam` |
| `source_provider text`, `integration_account_id`, `conversation_id` | origen |
| `grade text null` | `hot` · `warm` · `cold` · `human` (el traspaso a una persona) |
| `points smallint null`, `qualification jsonb null` | entradas (presupuesto, plazo, rol) y razones; las reglas son del tenant |
| `pack_version_id` | versión de reglas usada |
| `assessment_run_id` | evaluación que lo originó |
| `priority text` | `high` · `medium` · `low`, derivada de `grade` |
| `owner_user_id`, `next_action_text`, `next_action_at` | próxima acción (denormalizada desde `tasks`) |
| `disqualified_reason text null` | obligatorio si `status = disqualified` |
| `converted_opportunity_id uuid null` | |
| `created_at`, `updated_at`, `closed_at` | |

Restricciones: `unique (tenant_id, id)`; **índice único parcial `(tenant_id, contact_id) where status in ('new','working','qualified')`** (un lead abierto por contacto); `check (status <> 'disqualified' or disqualified_reason is not null)`.
Índices: `(tenant_id, status, priority, next_action_at)` (bandeja); `(tenant_id, owner_user_id, status)`; `(tenant_id, created_at desc)`.
Auditoría: trigger de fila (todos los cambios de `status`, `grade`, `owner_user_id`).

### `opportunities` — nueva · M · RW-M
Una posible **venta concreta** con importe y etapa.
| Columna | Notas |
|---------|-------|
| `id`, `tenant_id`, `workspace_id` | |
| `lead_id null`, `contact_id`, `organization_id null`, `customer_id null` | `customer_id` se llena si es una venta a un cliente existente |
| `pipeline_id`, `stage_id` | FK compuestas |
| `title text` | |
| `amount_minor bigint null`, `currency char(3)`, `probability_pct smallint` | |
| `expected_close_on date null` | |
| `status text` | `open` · `won` · `lost` (derivado de `stage.kind`) |
| `owner_user_id uuid` | **obligatorio mientras esté abierta** |
| `next_action_text`, `next_action_at` | **obligatorios mientras esté abierta** |
| `lost_reason text null` | obligatorio si `status = lost` |
| `won_at`, `closed_at`, `created_at`, `updated_at` | |

Restricciones: reglas de Sales como `CHECK`: `status <> 'open' or (owner_user_id is not null and next_action_at is not null)`; `status <> 'lost' or lost_reason is not null`.
Índices: `(tenant_id, pipeline_id, stage_id, expected_close_on)` (tablero); `(tenant_id, owner_user_id) where status = 'open'`; `(tenant_id, contact_id)`; `(tenant_id, lead_id) where lead_id is not null`.

### `customers` — nueva · M · RW-M
La **relación comercial** vigente o pasada con una persona u organización.
| Columna | Notas |
|---------|-------|
| `id`, `tenant_id`, `workspace_id` | |
| `contact_id null`, `organization_id null` | `check (contact_id is not null or organization_id is not null)` |
| `status` | `active` · `inactive` |
| `since date`, `first_opportunity_id` | |
| `created_at`, `updated_at` | |

Restricciones: único parcial por `(tenant_id, coalesce(organization_id, contact_id))` mientras `status = 'active'`.

### `pipelines` y `pipeline_stages` — nuevas · S · RW-O
`pipelines(id, tenant_id, name, is_default)`; `pipeline_stages(id, tenant_id, pipeline_id, key, name, position, kind, default_probability_pct)` con `kind` ∈ `open`/`won`/`lost`. `unique (pipeline_id, key)` y `unique (pipeline_id, position)` diferible. Cada tenant arranca con un pipeline por defecto (Descubrimiento → Reunión → Propuesta → Negociación → Ganada / Perdida), editable.

### `opportunity_stage_history` — nueva · M · AO
`(id, tenant_id, opportunity_id, from_stage_id, to_stage_id, changed_by_actor_type, changed_by_actor_id, changed_at)`. Alimenta "tiempo en etapa" y tasas de conversión. Índice `(tenant_id, opportunity_id, changed_at)`.

### `activities` — nueva · L · RW-M
Historial comercial **de un contacto**: llamadas, reuniones, correos, notas, resúmenes de conversación, eventos del sistema.
| Columna | Notas |
|---------|-------|
| `id` (UUIDv7), `tenant_id`, `contact_id` | siempre hay contacto |
| `lead_id`, `opportunity_id`, `customer_id` | referencias **opcionales con FK real** (sin tipo polimórfico sin integridad) |
| `kind` | `call` · `meeting` · `email` · `note` · `conversation_summary` · `system` |
| `subject text`, `body text null` | |
| `occurred_at`, `actor_type`, `actor_id`, `metadata jsonb` | |

Índice principal: `(tenant_id, contact_id, occurred_at desc)` (línea de tiempo); `(tenant_id, opportunity_id, occurred_at desc) where opportunity_id is not null`.

### `tasks` — nueva · M · RW-M
Seguimientos: `(id, tenant_id, contact_id?, lead_id?, opportunity_id?, assignee_user_id, title, due_at, status, completed_at, created_*)`. Fuente de verdad de "próxima acción"; `leads.next_action_*` y `opportunities.next_action_*` son copias mantenidas por **una sola función** al crear, completar o cancelar tareas. Índice `(tenant_id, assignee_user_id, due_at) where status = 'open'`.

### `tags` y `contact_tags` — nuevas · S / M · RW-M
`tags(id, tenant_id, name unique por tenant, color)`; `contact_tags(tenant_id, contact_id, tag_id)` con PK compuesta.

## 4. Conversaciones y canales

### `integration_accounts` — nueva · S · RW-O
Una **conexión del tenant con un canal o una pasarela** (un número de WhatsApp, una página de Facebook, el chat web, una cuenta de Stripe…).
| Columna | Notas |
|---------|-------|
| `id`, `tenant_id`, `workspace_id` | |
| `category` | `conversation` · `payment` |
| `provider` | `web_chat` · `whatsapp` · `facebook` · `instagram` · `email` · `form` · `stripe` · `paypal` · `makapay` · `makawallet` · `sinpe` |
| `display_name`, `external_account_id` | identificador del lado del proveedor |
| `status` | `pending` · `active` · `paused` · `error` · `revoked` |
| `secret_ref text null` | **puntero** al secreto (Cloudflare o Vault); jamás el secreto |
| `inbound_key_hash text null` | hash de la clave de la URL de entrada; para resolver el tenant sin exponerlo |
| `config jsonb` | solo no secreto (horario, idioma) |
| `capabilities jsonb` | límites del canal (ventana de respuesta, plantillas) |
| `last_event_at`, `created_by`, `created_at`, `updated_at` | |

Restricciones: `unique (tenant_id, id)`; `unique (provider, external_account_id)` (una cuenta de proveedor pertenece a un solo tenant); `unique (inbound_key_hash)`.
Auditoría: trigger de fila (con `secret_ref` redactado).

### `conversations` — nueva · L · RW-M (+ escrituras de sistema)
Un hilo con un contacto por una cuenta de canal.
| Columna | Notas |
|---------|-------|
| `id` (UUIDv7), `tenant_id`, `workspace_id` | |
| `integration_account_id`, `contact_id` | FK compuestas |
| `status` | `open` · `waiting` · `handed_off` · `closed` · `quarantined` (spam en cuarentena, nunca se borra solo) |
| `mode` | `guided` (MVP) · `human` · `free` (v2, requiere ADR-0009) |
| `external_thread_id text null` | id del hilo en el proveedor |
| `assigned_user_id`, `lead_id` | |
| `started_at`, `last_message_at`, `last_inbound_at`, `window_expires_at null`, `closed_at` | |

Restricciones: `unique (tenant_id, integration_account_id, external_thread_id) where external_thread_id is not null`.
Índices: `(tenant_id, status, last_message_at desc)` (bandeja); `(tenant_id, contact_id, last_message_at desc)`; `(tenant_id, assigned_user_id, status)`.

### `messages` — nueva · **XL · particionada por mes** · SYS (+ envío de personas por función)
| Columna | Notas |
|---------|-------|
| `id` (UUIDv7), **`created_at`** | **PK `(id, created_at)`**: la clave de partición va en la PK |
| `tenant_id`, `conversation_id` | **sin FK declarada hacia `conversations`** si el costo de partición lo exige; la integridad la garantiza la función de inserción y una prueba periódica (decisión de implementación, ver ADR) |
| `direction` | `in` · `out` · `system` |
| `sender_kind` | `contact` · `user` · `nex` · `system` |
| `sender_user_id null` | |
| `content_type` | `text` · `choice` · `template` · `media` · `event` |
| `body text null` | ≤ 8 KB |
| `payload jsonb null` | opción elegida, tarjeta, parámetros de plantilla; ≤ 16 KB |
| `provider_message_id text null` | |
| `delivery_status` | `queued` · `sent` · `delivered` · `read` · `failed` |
| `error_code`, `approval_request_id`, `authorization_id` | trazabilidad de por qué se envió |

Índices (por partición): `(tenant_id, conversation_id, created_at, id)` (leer un hilo en orden); `(tenant_id, provider_message_id) where provider_message_id is not null` (correlación de estados de entrega).
Retención propuesta: **24 meses**, ajustable por tenant, **pendiente de decisión legal**; se aplica **desprendiendo particiones**, no con `DELETE`.
PII: sí (`body`). Sin auditoría de fila (volumen): su rastro es `action_log` y `inbound_events`.

### `attachments` — nueva · L · SYS
`(id, tenant_id, message_id, message_created_at, storage_key, mime_type, bytes, sha256, scan_status, created_at)`. Los archivos viven en **R2** con prefijo `tenants/{tenant_id}/…`; la base solo guarda la clave. `scan_status` ∈ `pending`/`clean`/`blocked`: un adjunto no se muestra ni se reenvía hasta `clean`. Referencia a `messages` por **par `(message_id, message_created_at)`**, sin FK.

### `inbound_events` — nueva · **XL · particionada por mes** · SYS
Carga **cruda** de cada webhook o formulario recibido, antes de interpretarla.
`(id, received_at, tenant_id null, integration_account_id, provider, external_event_id, signature_valid, payload jsonb, status, attempts, error, processed_at)`. `status` ∈ `received`/`processed`/`ignored`/`failed`.
Para qué sirve: **reprocesar** sin pedirle nada al proveedor, **depurar** y **probar** un cambio de normalizador contra tráfico real. Retención corta: **30–90 días** (propuesta). Contiene PII: acceso solo de servidor.

### `inbound_dedup` — nueva · M · SYS
`(integration_account_id, external_event_id)` PK, `received_at`. **Existe porque una tabla particionada no puede imponer unicidad global**: antes de procesar un evento se intenta insertar aquí; si ya existe, se descarta. Se **poda** lo anterior a la ventana de reintentos del proveedor (propuesta: 14 días). Sin PII.

### `outbox_messages` — nueva · L · SYS
**Outbox transaccional**: lo que hay que enviar al exterior (mensaje, plantilla, enlace de pago).
`(id, tenant_id, integration_account_id, conversation_id, payload jsonb, idempotency_key, status, attempts, next_attempt_at, approval_request_id, authorization_id, created_at, sent_at, error)`.
Restricciones: **`unique (tenant_id, idempotency_key)`**. Un registro solo pasa a `pending` si su acción está **amparada** (aprobación del propietario o autorización vigente); si no, la función de inserción falla. Índice parcial `(next_attempt_at) where status in ('pending','sending')` para el procesador. Se poda tras N días de `sent`.

## 5. Evaluación, paquetes y traspasos

### `pack_versions` — nueva · S · RW-O
El **paquete del cliente** (catálogo de servicios, preguntas frecuentes aprobadas, reglas de calificación, horarios, reglas de escalado, mensajes) como **datos versionados** (ADR-0006): nada propio de un tenant vive en el código.
`(id, tenant_id, kind, version, status, content jsonb, content_sha256, approved_by, approved_at, created_by, created_at)`; `status` ∈ `draft`/`approved`/`retired`.
Restricciones: `unique (tenant_id, kind, version)`; **un solo `approved` vigente** por `(tenant_id, kind)` (índice único parcial). Un paquete aprobado **no se edita**: se crea otra versión. El contenido se valida contra `lib/contracts/`.

### `assessment_runs` — nueva · M · AO
Instantánea **inmutable** de un Business Audit (ADR-0006 lo anticipó).
`(id, tenant_id, contact_id, lead_id null, conversation_id null, engine_version, pack_version_id, answers jsonb, score, band, infrastructure, result jsonb, basis, created_at)`. `basis` = `selfReported`. `result` guarda brechas, fortalezas y servicios recomendados **tal como se calcularon**, para auditar y comparar aunque cambien las reglas después.
Índice `(tenant_id, contact_id, created_at desc)`.

### `handoffs` — nueva · M · AO
Lo que se entregó al equipo: `(id, tenant_id, lead_id, conversation_id, route, snapshot jsonb, created_at)`. El `snapshot` es el `Handoff` del MVP tal cual, congelado.

## 6. Gobierno

### `approval_requests` — nueva · M · RW-O para decidir; creación por NEX o sistema
Lo que NEX **preparó y espera aprobación** (la solicitud de reunión del demo).
`(id, tenant_id, kind, lead_id?, opportunity_id?, conversation_id?, draft jsonb, status, requested_by_actor_type, requested_by_actor_id, decided_by, decided_at, decision_note, expires_at, created_at)`.
`status` ∈ `pending`/`approved`/`rejected`/`expired`/`executed`. Solo propietarios cambian `pending` → `approved`/`rejected`. Al aprobarse se crea el `outbox_messages` o la acción correspondiente **en la misma transacción**.

### `work_agreements` y `authorizations` — nuevas · S · RW-O (sujetas a ADR-0009)
`work_agreements(id, tenant_id, name, status, version, created_by, created_at)`; `authorizations(id, tenant_id, work_agreement_id, action_kind, scope jsonb, status, granted_by, granted_at, revoked_at)`. Son las autorizaciones **permanentes y acotadas** del Nivel 2. **No entran en vigor mientras ADR-0009 esté Propuesto**; se crean vacías y desactivadas. El **nivel de cada acción lo decide el código**, no el modelo, y ante la duda es 3.

### `action_log` — nueva · **XL · particionada por mes** · AO
Qué hizo NEX o un sistema, **por qué** y **bajo qué autorización** (ADR-0009).
`(id, occurred_at, tenant_id, actor_type, actor_id, action_kind, level, summary, reason, authorization_id, approval_request_id, contact_id, lead_id, opportunity_id, conversation_id, outcome, request_id)`.
`actor_type` ∈ `user`/`nex`/`system`/`integration`; `level` ∈ 1/2/3; `outcome` ∈ `ok`/`failed`/`blocked`. Fuente del **resumen de cambio de turno**. Retención propuesta: **7 años** (pendiente legal).

### `audit_log` — nueva · **XL · particionada por mes** · AO
Cambios de **datos** en tablas sensibles (§7).

### `consent_records` — nueva · M · AO
Qué aceptó cada persona y cuándo: `(id, tenant_id, contact_id, purpose, notice_version, status, integration_account_id, conversation_id, recorded_at, evidence jsonb)`. `purpose` ∈ `data_processing`/`marketing_email`/`whatsapp_optin`/…; `status` ∈ `granted`/`withdrawn`. Es la prueba de que el aviso de datos se mostró (decisiones C12 y C13 de la Constitución, pendientes de análisis legal).

### `data_requests` — nueva · S · RW-O
Solicitudes de **exportación** o **borrado**: `(id, tenant_id, contact_id null, kind, status, requested_by, requested_at, completed_at, evidence)`. Es el mecanismo que exige ADR-0006 antes de datos reales.

## 6b. Pagos (reservado) y analítica

### `payments` y `payment_events` — nuevas · L / XL · SYS / AO — **fase posterior, no entran en el primer grupo de migraciones**
`payments(id, tenant_id, integration_account_id, provider_payment_id, kind, status, amount_minor, currency, fee_minor, customer_id?, opportunity_id?, contact_id?, invoice_id?, parent_payment_id?, occurred_at, created_at, updated_at)`. `kind` ∈ `charge`/`refund`; `status` ∈ `pending`/`succeeded`/`failed`/`refunded`/`disputed`. `unique (integration_account_id, provider_payment_id)`; `invoice_id` queda **reservado** (lo definirá el módulo Finance). **Nunca se guardan números de tarjeta ni datos de pago**: solo identificadores y estados del proveedor.
`payment_events(id, occurred_at, tenant_id, payment_id, event_type, payload jsonb)` es **append-only y particionada**: cada cambio de estado llega como un evento y el procesador, de forma **idempotente**, actualiza `payments`. Detalle en [integrations.md](integrations.md).

### `metrics_daily` — nueva · M · SYS
Agregados precalculados para el Dashboard y Analytics: `(tenant_id, day, metric_key, dimension_key, value bigint)`, PK `(tenant_id, day, metric_key, dimension_key)`. Los llena un proceso por lotes a partir de `leads`, `opportunities`, `conversations` y `action_log`. Evita contar filas en caliente ([scalability.md](scalability.md) §6).

## 7. Auditoría: dos capas, cada una con su propósito

| Capa | Pregunta que responde | Tabla | Cómo se escribe |
|------|----------------------|-------|-----------------|
| **Acción** | ¿Qué hizo NEX o un sistema, por qué y con qué permiso? | `action_log` | La **función de negocio** que ejecuta la acción inserta el registro **en la misma transacción**. Una acción sin registro no se ejecuta |
| **Dato** | ¿Quién cambió este campo, cuándo y de qué a qué? | `audit_log` | **Trigger genérico** `private.audit_row()` en las tablas listadas abajo |

Tablas con trigger de fila: `contacts` (con PII redactada), `organizations`, `leads`, `opportunities`, `customers`, `memberships`, `pack_versions`, `integration_accounts` (con `secret_ref` redactado), `payments`, `authorizations`, `work_agreements`, `pipelines`, `pipeline_stages`.
**No** llevan trigger: `messages`, `inbound_events`, `activities` (su volumen lo impediría; ya son registros por sí mismos).

`audit_log`: `(id, occurred_at, tenant_id, actor_type, actor_id, table_name, row_id, operation, changed jsonb, request_id, authorization_id)`. `changed` guarda `{columna: [antes, después]}` **solo de las columnas permitidas**; las columnas con datos personales se sustituyen por `"[redactado]"` o por un hash. El `actor` sale de una variable de sesión que fija `lib/db/` en cada transacción (`set_config('kynova.actor', …)`).
**Inmutabilidad:** sin `UPDATE`/`DELETE` para ningún rol de la API; trigger que lanza excepción ante ambos; las particiones se desprenden solo con una función de mantenimiento auditada.

## 8. Datos personales: exportación y borrado

| Dato | Exportación | Borrado a petición |
|------|-------------|--------------------|
| `contacts`, `contact_identities` | Sí | **Anonimización**: nombres y `attributes` a nulo; identificadores sustituidos por un hash no reversible; `anonymized_at` puesto. La fila **sigue** (para no romper leads, oportunidades ni agregados) |
| `messages` (`body`, `payload`) | Sí | `body` y `payload` a nulo; la fila queda con fechas y estado |
| `activities.body` | Sí | A nulo |
| `leads`, `opportunities`, `customers` | Sí | Se conservan (relación comercial); sin PII propia |
| `assessment_runs`, `handoffs` | Sí | Se purgan los campos personales del `snapshot` |
| `audit_log`, `action_log` | No (son del tenant) | Ya no contienen PII; se conservan |
| Copias de seguridad | — | **Pendiente de decisión** (ADR-0006: la retención de las copias condiciona el borrado efectivo) |

El flujo lo ejecuta una función única que recibe una `data_requests` y deja su `evidence`. **Plazos y alcance legal: pendientes** (análisis legal aparte, antes de datos reales).

## 9. Qué cambia respecto del demo del MVP

| Demo (en memoria) | Persistencia |
|-------------------|--------------|
| `Handoff` | `conversations` + `contacts` + `contact_identities` + `assessment_runs` + `leads` + `handoffs` |
| `Lead` del Pipeline con `stage` (`new`, `needsFollowUp`, `meetingRequested`, `won`) | **Se divide**: el estado del interés es `leads.status`; la reunión es una `approval_requests` y luego una `activities` (`meeting`); `won` pertenece a una **oportunidad** |
| `approval` (solicitud de reunión) | `approval_requests` (+ `outbox_messages` al aprobarse) |
| `digest()` del Dashboard | Lecturas sobre `leads`, `approval_requests` y `action_log`; a escala, sobre `metrics_daily` ([scalability.md](scalability.md)) |
| `NOVA_DRAFT_PACK` | `pack_versions` aprobado por la empresa |
| `CHANNEL_STATUS` | `integration_accounts` |

## 10. Tabla de resumen

| Tabla | Dominio | Clase de acceso | Volumen | Partición | PII | Fila auditada |
|-------|---------|-----------------|---------|-----------|-----|---------------|
| tenants | Plataforma | RW-O (servidor) | S | — | No | Sí (por `memberships`) |
| memberships | Plataforma | lectura propia | S | — | No | Sí |
| business_profiles | Plataforma | RW-O | S | — | No | — |
| user_profiles | Plataforma | OWN | S | — | Sí | — |
| organizations | CRM | RW-M | M | — | Sí | Sí |
| contacts | CRM | RW-M | L | — | **Sí** | Sí (redactada) |
| contact_identities | CRM | RW-M | L | — | **Sí** | — |
| leads | CRM | RW-M | M | — | Indirecta | Sí |
| opportunities | CRM | RW-M | M | — | No | Sí |
| customers | CRM | RW-M | M | — | Indirecta | Sí |
| pipelines, pipeline_stages | CRM | RW-O | S | — | No | Sí |
| opportunity_stage_history | CRM | AO | M | — | No | — |
| activities | CRM | RW-M | L | — | **Sí** | — |
| tasks | CRM | RW-M | M | — | No | — |
| tags, contact_tags | CRM | RW-M | S / M | — | No | — |
| integration_accounts | Canales | RW-O | S | — | No | Sí (redactada) |
| conversations | Canales | RW-M + sistema | L | Evaluar a 10⁸ | Indirecta | — |
| messages | Canales | SYS | **XL** | **Mensual** | **Sí** | — |
| attachments | Canales | SYS | L | — | Sí | — |
| inbound_events | Canales | SYS | **XL** | **Mensual** | **Sí** | — |
| inbound_dedup | Canales | SYS | M (podada) | — | No | — |
| outbox_messages | Canales | SYS | L (podada) | — | Sí | — |
| pack_versions | Evaluación | RW-O | S | — | No | Sí |
| assessment_runs | Evaluación | AO | M | — | Indirecta | — |
| handoffs | Evaluación | AO | M | — | **Sí** | — |
| approval_requests | Gobierno | RW-O (decide) | M | — | Indirecta | — |
| work_agreements, authorizations | Gobierno | RW-O | S | — | No | Sí |
| action_log | Gobierno | AO | **XL** | **Mensual** | No | (es auditoría) |
| audit_log | Gobierno | AO | **XL** | **Mensual** | No (redactada) | (es auditoría) |
| consent_records | Gobierno | AO | M | — | Indirecta | — |
| data_requests | Gobierno | RW-O | S | — | Indirecta | — |
| payments | Pagos (reservado) | SYS | L | Evaluar | Indirecta | Sí |
| payment_events | Pagos (reservado) | AO | XL | **Mensual** | No | — |
| metrics_daily | Analítica | SYS | M | — | No | — |

**Total propuesto:** 37 tablas (3 existentes y 34 nuevas; 2 de ellas, `payments` y `payment_events`, reservadas para una fase posterior). Ninguna se crea hasta aprobar el ADR; el orden y los grupos de migración están en [migrations.md](migrations.md).
