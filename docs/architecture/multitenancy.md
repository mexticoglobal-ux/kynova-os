# Arquitectura multiempresa (`tenant_id` desde el inicio)

> Parte de [ADR-0010](../decisions/0010-conversaciones-y-datos-de-prospectos.md). **Propuesto, sin código.** Fecha: 2026-11-06.
> Extiende ADR-0006 (aislamiento por tenant con RLS), `AGENTS.md` §7.1 y `docs/DOMAIN.md` §4–5. No modifica ninguna regla vigente.

## 1. Principio

**Una empresa nunca puede leer, escribir ni referenciar datos de otra, y la base de datos lo impide aunque el código se equivoque.** El código se esfuerza en no equivocarse; la base garantiza que equivocarse no filtra datos.

## 2. Modelo elegido: esquema compartido con `tenant_id`, RLS y claves compuestas

| Opción | Aislamiento | Costo operativo | Escala a miles de empresas | Veredicto |
|--------|-------------|-----------------|----------------------------|-----------|
| **A. Un esquema compartido, `tenant_id` en cada fila, RLS** | Lógico, impuesto por la base | Bajo: una migración sirve a todos | Sí (miles de tenants; muchos millones de filas por tabla con índices por `tenant_id` y particiones) | **Elegida** |
| B. Un esquema por empresa | Lógico, más fuerte | Alto: cada migración se aplica N veces; el catálogo de Postgres crece con N × tablas | Se degrada en cientos de tenants | Descartada |
| C. Una base (proyecto) por empresa | Físico | Muy alto: N proyectos, N despliegues, N copias de seguridad | No para una plataforma de autoservicio | Descartada como modelo base |

**Salida de emergencia (no se construye ahora, pero el diseño la permite):** `tenant_id` es la **clave de fragmentación**. Todos los ids son UUID globales, así que un tenant muy grande o con requisitos contractuales de residencia puede **extraerse a su propio proyecto** (opción C solo para él) sin renumerar nada. Ver [scalability.md](scalability.md) §10.

## 3. Reglas de `tenant_id`

1. **Toda tabla de negocio** tiene `tenant_id uuid not null`. Una prueba de catálogo en CI **falla** si aparece una tabla en `public` sin `tenant_id`, sin RLS activado o sin al menos una política (salvo una lista explícita de excepciones: `user_profiles`, `tenants`).
2. **`tenant_id` es inmutable.** Está fuera de los `GRANT UPDATE` por columna (como en `business_profiles`) y un trigger lo protege en tablas particionadas.
3. **`tenant_id` encabeza los índices** (`(tenant_id, …)`): sirve a la vez para el rendimiento y para que el planificador pueda descartar particiones y rangos.
4. **El cliente nunca envía `tenant_id`** como fuente de verdad: `lib/db/` lo resuelve de la membresía de la sesión; las políticas de inserción **verifican** que el `tenant_id` de la fila pertenezca al usuario.
5. **`workspace_id`** existe **nulo y sin FK** en las tablas comerciales. El aislamiento de seguridad sigue siendo por tenant; el workspace solo agrupa. Reservarlo ahora evita reescribir tablas de decenas de millones de filas después.

## 4. Claves foráneas compuestas: el cierre de la fuga más común

Una FK simple `lead.contact_id → contacts.id` **no impide** que el lead de la empresa A apunte a un contacto de la empresa B: RLS filtra lecturas, pero una referencia cruzada creada por un error de código o una función con privilegios dejaría un dato "colgando" del tenant equivocado.

**Regla:** el padre declara `unique (tenant_id, id)` y el hijo referencia el **par**:

```
contacts:  primary key (id), unique (tenant_id, id)
leads:     foreign key (tenant_id, contact_id) references contacts (tenant_id, id)
```

Así es **imposible a nivel de esquema** relacionar filas de tenants distintos. Costo: un índice único extra por padre y FKs de dos columnas. Se acepta porque es una garantía que ninguna política puede dar por sí sola.
Excepción documentada: las tablas particionadas (`messages`, `attachments`) no pueden usar FK compuesta hacia el padre sin incluir la clave de partición; ahí la integridad la impone la **función de inserción** (que valida que `conversation_id` pertenezca al `tenant_id`) y una **prueba programada de huérfanos**.

## 5. Políticas RLS: cuatro formas, ninguna más

Todas parten de **denegar por defecto**, usan `to authenticated` y la función auxiliar ya existente `private.is_member`/`private.is_owner` envuelta en `(select …)` para que Postgres la evalúe **una vez por consulta** y no por fila (patrón ya usado en `20261031000000_tenancy_core.sql`).

| Forma | Política (en palabras) | Tablas |
|-------|------------------------|--------|
| **Lectura de miembros** | `select`: `is_member(tenant_id)` | casi todas |
| **Escritura de miembros** | `insert`/`update`: `is_member(tenant_id)` y, en `insert`, `created_by = auth.uid()` donde exista autoría | contacts, leads, opportunities, activities, tasks… |
| **Escritura de propietarios** | `insert`/`update`: `is_owner(tenant_id)` | pack_versions, integration_accounts, pipelines, authorizations… |
| **Solo anexar** | `select`: miembros; **sin** políticas de `update`/`delete`; privilegios revocados | audit_log, action_log, assessment_runs… |

Los **roles finos** (administrador, comercial, lector, "solo ve lo asignado a él") **requieren su propio ADR**. El modelo ya los admite: `memberships.role` es `text` con `CHECK` y las políticas llaman a una función; ampliar el conjunto no cambia el esquema. **Decisión pendiente (D3):** en la v1, todo miembro ve todo el CRM del tenant.

### Rendimiento de RLS

La función por fila es la causa típica de consultas lentas bajo RLS. Reglas: función `stable` + `security definer` con `search_path` fijo, evaluada vía `(select …)`, con el índice `memberships (user_id, tenant_id)`. **Puerta de rendimiento antes de producción:** una prueba sintética con 10 millones de contactos y 200 millones de mensajes ([scalability.md](scalability.md) §11). Si RLS por membresía no cumple el presupuesto, la alternativa (con ADR) es llevar la lista de tenants del usuario **como reclamación del JWT**; se descarta de inicio porque retrasa la revocación hasta que el token caduque (limitación ya documentada en `RESULTADO.md`).

## 6. Quién escribe qué: tres tipos de actor, tres rutas

| Actor | Ruta | Credencial | Aislamiento |
|-------|------|------------|-------------|
| **Usuario autenticado** | `lib/db/` → PostgREST con el **JWT del usuario** | Sesión | RLS en cada consulta |
| **Tráfico público** (chat web, webhooks de canales, formularios): sin usuario | `lib/db/ingest` → **solo funciones `ingest_*`** | Clave de servidor, **sin privilegios sobre tablas**: solo `EXECUTE` en esas funciones | La función **resuelve el tenant** desde `integration_accounts` por la clave de entrada (hash) y **fija `tenant_id` ella misma**; el llamador no puede elegirlo |
| **Procesos internos** (outbox, rollups, retención de particiones, NEX en segundo plano) | `lib/db/system` → funciones `system_*` | Clave de servidor limitada | Cada función recibe el `tenant_id` y lo verifica; registra en `action_log` |

**Por qué esto cumple ADR-0006:** la clave de servidor **no consulta tablas en nombre de nadie** (hoy `service_role` no tiene ningún privilegio por diseño y así se queda); solo ejecuta un número pequeño de funciones revisadas una a una, con `search_path` fijo y `EXECUTE` revocado a `PUBLIC` y `anon`.
**A verificar en un spike** (no se asume): que el cliente de servidor pueda restringirse a un rol con solo `EXECUTE` sobre esas funciones. Alternativas si no: un rol propio con JWT firmado por el Worker, o conexión directa por Hyperdrive (que requiere su propio ADR).

## 7. Contexto de tenant en el resto del sistema

- **NEX** hereda el tenant y los permisos del usuario (o de la autorización) que lo invoca; ninguna herramienta de NEX acepta un `tenant_id` como parámetro libre. Las herramientas reciben un **contexto** ya resuelto.
- **Cada petición** lleva `request_id` y `tenant_id` en logs y trazas; ningún log incluye cuerpos de mensajes ni PII.
- **Cachés** (Workers KV, caché de Cloudflare): toda clave incluye el `tenant_id`; las respuestas con datos de usuario son `Cache-Control: private, no-store` (D21).
- **Almacenamiento de archivos (R2):** prefijo `tenants/{tenant_id}/…`; las URLs son firmadas y de corta vida.
- **Colas:** todo mensaje de cola incluye `tenant_id` y se vuelve a validar al consumirlo.

## 8. Ciclo de vida de un tenant

| Evento | Qué ocurre |
|--------|-----------|
| **Alta** | Función de servidor crea `tenants`, el primer `memberships` (propietario), `pipelines` por defecto, `integration_accounts` del chat web y un `pack_versions` en borrador. Todo en una transacción |
| **Suspensión** | `tenants.status = 'suspended'`: `is_member`/`is_owner` devuelven falso (ya implementado), la ingesta rechaza eventos y el outbox se detiene. Los datos se conservan |
| **Exportación** | Función que genera un paquete por tenant (contactos, conversaciones, leads, oportunidades, clientes, evaluaciones) hacia R2 con URL firmada |
| **Baja y borrado** | Tras el plazo de gracia (pendiente de decisión), una función elimina o anonimiza los datos del tenant, **desprende** sus datos de volumen y registra la evidencia. La retención de las copias de seguridad condiciona el borrado efectivo (ADR-0006) |
| **Extracción a su propio proyecto** | Procedimiento de excepción para tenants muy grandes o con residencia contractual ([scalability.md](scalability.md) §10) |

## 9. Pruebas obligatorias (CI, antes de cualquier dato real)

1. **Prueba de catálogo:** toda tabla en `public` tiene `tenant_id`, RLS activado, ≥ 1 política y ningún privilegio para `anon`.
2. **Matriz de aislamiento generada**: para **cada tabla**, con dos tenants de prueba, el usuario de A no lee, no inserta, no actualiza ni borra filas de B, y no puede insertar con el `tenant_id` de B. Se genera a partir del catálogo para que una tabla nueva **no pueda olvidarse**.
3. **Referencias cruzadas:** intentar crear una fila de A apuntando a una fila de B falla por la FK compuesta.
4. **Funciones de ingesta:** una clave de entrada de A nunca escribe en B; una clave desconocida o revocada se rechaza sin filtrar si existe.
5. **Vistas y funciones expuestas:** `security_invoker` en vistas; ninguna función devuelve datos de otro tenant.
6. **Inmutabilidad:** `tenant_id` no se puede cambiar; las tablas append-only rechazan `update` y `delete` incluso del propietario.
7. **Carga:** la puerta de rendimiento de RLS (§5).
