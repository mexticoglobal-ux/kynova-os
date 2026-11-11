# ADR-0015: El Backend Core se conecta a Supabase con identidad real, RLS desde la migración y escritura solo por funciones

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-10 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | datos · auth · rls · tenancy · supabase · seguridad |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
La autenticación con Supabase **ya es real** (ADR-0008): inicio de sesión por código (OTP), cookie httpOnly, renovación y primera barrera en el middleware (`getClaims`), cierre de sesión, rutas protegidas, membresías y rol por empresa, y `can`. Las migraciones ya traen tenancy y RLS por empresa (ADR-0006, ADR-0010) con una regla: **los miembros solo leen las tablas y toda escritura pasa por una función** que comprueba el derecho a escribir. Lo que no existía era la persistencia del Backend Core (ADR-0011, ADR-0014): el contrato de datos declaraba `platform_events`, `audit_log` y `storage_objects` como tablas «existentes» o «planeadas», pero **no estaban en ninguna migración** (y `audit_log` ya existía con otro propósito: la auditoría por fila de la base). Los datos reales de clientes siguen bloqueados por las puertas del ADR-0006 y la aprobación de producción de `AGENTS.md` §7.11.

## Problema
¿Cómo se conecta el Backend Core con Supabase (identidad, eventos, auditoría, archivos, salud) sin reabrir lo que ya funciona, sin que la base dependa de que el código sea correcto y sin habilitar datos reales ni aplicar nada a un proyecto sin aprobación?

## Criterios de decisión
- Reutilizar la autenticación, las membresías y las políticas que ya existen; no reemplazarlas.
- La base decide quién escribe qué (RLS y funciones), aunque el código se equivoque.
- Mismo patrón que el resto del esquema: miembros leen, las funciones escriben, nada de la llave de servicio.
- La cadena de auditoría la hace cumplir la base, no solo la memoria de un proceso.
- Reversible, probado con pruebas de aislamiento, y sin tocar datos reales.

## Opciones consideradas

### Opción A: Escribir directo en las tablas con políticas de inserción
- **Ventajas:** menos SQL.
- **Inconvenientes:** rompe la regla del esquema; no puede imponer la continuidad de la cadena de auditoría ni la idempotencia por evento.
- **Coste y esfuerzo:** bajo ahora, con deuda de seguridad.

### Opción B: Tablas de solo lectura para los miembros y funciones de escritura con el patrón existente
- **Ventajas:** consistente con `require_write`; la cadena se valida en la base con bloqueo por empresa; la idempotencia es de la base; Storage se ata a la carpeta de la empresa con políticas.
- **Inconvenientes:** una migración con funciones; el código escribe por `rpc`.
- **Coste y esfuerzo:** medio.

## Decisión
**Opción B.**

**Base de datos** (`supabase/migrations/20261110000100_backend_integration.sql`, **escrita y probada, no aplicada a ningún proyecto**):
- `platform_events` (el Event Bus), `platform_audit` (la auditoría central encadenada, distinta de la auditoría por fila `audit_log`) y `storage_objects` (el registro de archivos), con RLS activo desde su creación, solo lectura para los miembros y sin privilegios para `anon` ni para la llave de servicio. Las dos primeras son append-only.
- Funciones `append_platform_events`, `append_platform_audit`, `register_storage_object` y `retire_storage_object` (`security definer`, `search_path` vacío, `require_write(p_tenant)`). `append_platform_audit` bloquea por empresa y **exige la continuidad de la cadena** (seq + 1 y hash previo); un registro ya guardado se omite si es idéntico y se rechaza si no lo es.
- `delete_company` también borra estas filas. Un bucket privado `documents` con políticas que atan cada objeto a la carpeta de su empresa (leer: miembro; subir: quien puede escribir; sin actualizar ni borrar), solo donde existe el esquema `storage`.
- Pruebas: `supabase/tests/backend_integration.sql` (aislamiento, roles, cadena, borrado), agregada a la CI de RLS.

**Código** (`lib/backend/`):
- `identity.ts`: del resultado de Supabase Auth (claims verificados y membresía activa) a `TenantContext`, `AuthSession`, `canUser` y `canUse`, con las mismas reglas que `private.can_write` e `is_admin` (una prueba las compara con el SQL). No toca tokens ni cookies.
- `integration/persistence.ts` y `supabase-storage.ts`: adaptadores que escriben solo por las funciones, **como la persona que inició sesión** (su cliente de la petición, para que RLS aplique), sin actualizar ni borrar; `connectSupabasePlatform(core, client)` los une. El adaptador no escribe nada en producción ni con datos reales; en desarrollo y vista previa solo admite datos de demostración.
- El conector acepta el contexto de la sesión: una llamada de otra empresa se rechaza antes de tocar el módulo. La instancia retoma la cadena de auditoría desde el último registro guardado (`resume`). El Event Bus identifica un evento por empresa **y** id: una empresa ya no puede suprimir el evento de otra eligiendo su id.
- Salud: `supabase_reachable` pregunta a Supabase con una lectura filtrada a una empresa inexistente.

**Lo que no cambia ni se activa:** el inicio de sesión, el middleware y las rutas; `realData` sigue en `false` en todos los entornos (ADR-0006); ninguna ruta usa todavía `connectSupabasePlatform`; no hay pantallas ni funciones nuevas. No existe «recuperación de contraseña» porque el producto no usa contraseñas: recuperar el acceso es pedir un código nuevo, que es el inicio de sesión que ya existe.

## Consecuencias
- **Positivas:** el Backend Core puede persistir bajo RLS sin llave de servicio; la cadena de auditoría y el aislamiento se imponen en la base; el contrato de datos y el SQL concuerdan (una prueba compara columnas); se corrigió un hueco real de aislamiento en el bus.
- **Negativas:** hasta aplicar la migración y conectar una ruta, nada se guarda en Supabase; las demás tablas planeadas (Workers, Billing, etc.) siguen sin migración.
- **Riesgos y mitigaciones:** que se aplique la migración sin las pruebas de aislamiento (la CI las corre; el procedimiento exige correrlas contra la base antes y después); que alguien habilite datos reales sin las puertas del ADR-0006 (la política del entorno lo bloquea y una prueba lo comprueba); que las pruebas locales se tomen por Supabase real (se validaron en Postgres efímero, no en Supabase: ver el README §26).

## Referencias
ADR-0006, ADR-0008, ADR-0010, ADR-0011, ADR-0014, `AGENTS.md` §7.1, §7.3, §7.11, `docs/platform/README.md` §26.
