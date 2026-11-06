# Estrategia de migraciones

> Parte de [ADR-0010](../decisions/0010-conversaciones-y-datos-de-prospectos.md). **Propuesto, sin código.** Fecha: 2026-11-06.
> Respeta `.claude/rules/data.md`, `kyn-data` y `AGENTS.md` §7.11 (ninguna migración a un entorno real sin aprobación).

## 1. Estado de partida

| Hecho | Consecuencia |
|-------|--------------|
| Dos migraciones aplicadas solo al proyecto **desechable** de desarrollo (`20261031000000_tenancy_core`, `20261102000000_upgrade_disposable_tenancy`) | Las tablas nuevas **extienden** `tenants`, `memberships` y `business_profiles`; `spike_items` sigue siendo del spike y no se toca |
| Sin Docker local (D19) | Las migraciones se aplican a un proyecto remoto de desarrollo; **la verificación completa corre en CI** (Linux) |
| `lib/db/database.types.ts` no generado (D31) | **Bloqueante**: antes de la primera tabla nueva se habilita la generación de tipos y una comprobación de deriva en CI |
| Hook `verify.mjs` roto (D4) | Se verifica con los binarios directamente; se corrige antes de este trabajo |
| Producción sin desplegar (D23) | Todo el plan aplica a **desarrollo y Preview**; producción exige aprobación explícita y un ADR de entorno |

## 2. Reglas de toda migración

1. **Un cambio lógico por migración:** esquema, restricciones, índices, permisos y RLS **juntos** (`.claude/rules/data.md`). Una tabla sin RLS nunca existe ni por un commit.
2. **Nombre:** `AAAAMMDDHHMMSS_<verbo>_<objeto>.sql`, como las actuales. Orden estricto; nunca se edita una migración ya aplicada: se agrega otra.
3. **Cada migración documenta su reversión** en el encabezado (como las existentes). En desarrollo, la reversión puede destruir datos; en producción **la reversión es hacia adelante** (una migración correctiva), no un "down".
4. **Expansión y contracción** para cambios destructivos: primero se **añade** (columna nueva, nullable), se **llena** por lotes, la aplicación pasa a usarla, y **en otra versión** se elimina lo viejo. Nunca se renombra ni se elimina en el mismo despliegue que lo reemplaza.
5. **Sin bloqueos largos:** cada migración fija `lock_timeout` y `statement_timeout`. Para tablas grandes:
   - índices con `create index concurrently` (migración propia, fuera de transacción);
   - restricciones con `not valid` y luego `validate constraint` por separado;
   - columnas nuevas **nullable y sin valor por defecto volátil**; el relleno se hace por lotes fuera de la migración.
6. **Orden app ↔ base:** la base se migra **antes** de desplegar el código que la usa (compatible hacia atrás), y el código se retira **antes** de contraer. La versión anterior del código debe funcionar contra el esquema nuevo.
7. **Sin datos reales en seeds.** `seed.sql` solo con datos ficticios (dos tenants A y B, usuarios de prueba) y marcados como tales.
8. **Aplicación:** `supabase db push` **solo** con aprobación explícita y a un entorno nombrado; el SQL Editor solo para el proyecto desechable. Se registra qué se aplicó, dónde y cuándo.

## 3. Verificación en CI (lo que falta hoy)

| Paso | Qué hace |
|------|----------|
| 1. Base efímera | Un contenedor de Postgres/Supabase en el runner Linux de GitHub Actions (el CI de ADR-0007 ya existe) |
| 2. Aplicar desde cero | Todas las migraciones en orden sobre una base vacía: demuestra que **el historial reproduce el esquema** |
| 3. Aplicar sobre el estado anterior | Restaurar el esquema de la rama base y aplicar solo las nuevas: demuestra que **se puede migrar** |
| 4. Pruebas SQL | `supabase/tests/*.sql` (pgTAP o equivalente): catálogo (todas las tablas tienen `tenant_id`, RLS y políticas), **matriz de aislamiento generada**, inmutabilidad append-only, referencias cruzadas, funciones de ingesta |
| 5. Tipos generados | Regenerar `lib/db/database.types.ts` y fallar si hay diferencias sin confirmar |
| 6. Linter de migraciones | Reglas: sin `drop`/`rename` sin marca de contracción; sin `create index` sin `concurrently` en tablas de la lista "grandes"; sin `grant` a `anon`; sin tabla sin RLS |
| 7. Reversión de práctica | En la base efímera se ejecuta el plan de reversión de la última migración para confirmar que existe y funciona |

## 4. Grupos de migración (orden propuesto)

Cada grupo es una **tarea L** (flujo W3) con su brief, `/security-review` y aprobación. **Ninguno se ejecuta hasta aprobar el ADR-0010** y cumplir las puertas de ADR-0006.

| Grupo | Contenido | Puerta de salida |
|-------|-----------|------------------|
| **M0. Prerrequisitos** | Tipos generados (D31); CI con base efímera; arreglo del hook (D4); decisiones de región, retención y modelo de claves | CI verde con las dos migraciones existentes |
| **M1. Fundamentos** | Extensiones (`pg_trgm`); función de ids UUIDv7 (o decisión de generarlos en `lib/db/`); `private.audit_row()`; funciones auxiliares; `user_profiles`; `tenants.slug`; clase de privilegios | Pruebas de catálogo y de la matriz en verde |
| **M2. Núcleo CRM** | `organizations`, `contacts`, `contact_identities`, `pipelines`, `pipeline_stages`, `leads`, `opportunities`, `opportunity_stage_history`, `customers`, `activities`, `tasks`, `tags`, `contact_tags`; funciones de transición; `audit_row` en las tablas listadas | Matriz de aislamiento; invariantes del embudo (`CHECK` e índices parciales) probados |
| **M3. Conversaciones** | `integration_accounts`, `conversations`, `messages` (**particionada**), `attachments`, `inbound_events` (**particionada**), `inbound_dedup`, `outbox_messages`; funciones `ingest_*`; **mantenimiento de particiones** | Ingesta idempotente probada (reenvío del mismo evento no duplica); partición creada y desprendida en CI |
| **M4. Evaluación y paquetes** | `pack_versions`, `assessment_runs`, `handoffs` | Un paquete aprobado es inmutable; una evaluación guardada es reproducible |
| **M5. Gobierno** | `approval_requests`, `work_agreements`, `authorizations` (desactivados), `action_log` y `audit_log` (**particionadas**), `consent_records`, `data_requests`; funciones de exportación y anonimización | Append-only a prueba; exportación y borrado verificados (**puerta de ADR-0006**) |
| **M6. Analítica** | `metrics_daily` y el proceso por lotes que la llena | Dashboard leyendo rollups con datos sintéticos de volumen |
| **M7. Pagos (más adelante)** | `payments`, `payment_events` (**particionada**), cuentas de pago en `integration_accounts` | ADR propio de pagos; fuera de este alcance hasta entonces |

Dependencias: M1 → M2 → M3 → M4 → M5; M6 depende de M2 y M3; M7 de M2 y M5. M4 puede ir en paralelo a M3.

## 5. Particiones: cómo se mantienen

- **Tablas particionadas:** `messages`, `inbound_events`, `action_log`, `audit_log`, `payment_events`. Rango **mensual** por la columna de tiempo.
- **Creación anticipada:** un trabajo programado (`pg_cron` o un proceso de Cloudflare) crea las particiones de los **próximos 3 meses** y **alerta** si faltan menos de 2. Una inserción sin partición **falla**: por eso hay una partición por defecto de seguridad y una alerta si recibe filas.
- **Retención:** se **desprende** (`detach`) la partición vencida y se archiva o elimina; nunca se usa `DELETE` masivo. Se hace con una función de mantenimiento **auditada** que respeta la retención del tenant y las suspensiones por solicitud legal.
- **Herramienta:** función propia mínima **o** `pg_partman` (extensión disponible en Supabase, a verificar). Se decide en M3; se prefiere la función propia si el alcance es solo "crear y desprender por mes", para no sumar una dependencia.
- **Particionar una tabla ya llena es doloroso;** por eso estas cinco se crean **particionadas desde el primer día**, aunque estén casi vacías.

## 6. Cambios de esquema sobre tablas con millones de filas

| Cambio | Técnica |
|--------|---------|
| Columna nueva | `add column` nullable → relleno por lotes → `not null` con `check ... not valid` + `validate` |
| Índice nuevo | `create index concurrently` (migración propia, sin transacción) |
| Restricción nueva | `not valid` + `validate constraint` |
| Cambiar un tipo o renombrar | Columna nueva + doble escritura + conmutación + contracción en otra versión |
| Cambiar valores permitidos de un `CHECK` | Añadir el `CHECK` nuevo `not valid`, validar, y quitar el viejo (por eso se prefiere `text` + `CHECK` a `enum`) |
| Relleno de datos | Procesos por lotes con pausa y reanudación, fuera de la migración, con `action_log` |
| Tabla particionada | La operación se aplica a la **tabla madre**; los índices nuevos se crean por partición y se asocian |

## 7. Entornos y promoción

| Entorno | Datos | Cómo se migra |
|---------|-------|---------------|
| **Efímero (CI)** | Sintéticos | Automático en cada PR |
| **Desarrollo** (proyecto desechable) | Ficticios | Bajo aprobación, `db push` o SQL Editor, registrado |
| **Preview** | Ficticios | Igual; **nunca** recibe datos reales (ADR-0006) |
| **Producción** (pendiente, D23) | Reales, solo tras las puertas de ADR-0006 | Aprobación explícita (§7.11), copia de seguridad verificada antes, ventana acordada, plan de reversión hacia adelante |

## 8. Riesgos de migración

| Riesgo | Mitigación |
|--------|------------|
| Una migración bloquea tablas grandes | `lock_timeout`, índices concurrentes, relleno por lotes, linter |
| Una tabla nace sin RLS | Prueba de catálogo en CI + migración atómica (esquema, permisos y RLS juntos) |
| Deriva entre esquema y tipos | Regeneración y comparación en CI |
| Cambios aplicados a mano que no están en el repositorio | Regla: todo cambio es una migración; se compara el esquema real contra el generado por las migraciones |
| Partición ausente al cambiar de mes | Creación anticipada, alerta y partición por defecto |
| Datos reales en entornos no aprobados | Seeds ficticios; ADR-0006; el entorno de datos reales se decide aparte |
