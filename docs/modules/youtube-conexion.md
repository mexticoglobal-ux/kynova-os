# Conexión real de un canal de YouTube (solo lectura)

> Estado (2026-11-24): implementada, probada y **desplegada en Preview** (Worker `kynova-os-preview`, versión `76d21a3f`, ADR-0038). Las rutas nuevas responden, pero la conexión real **todavía no funciona** porque faltan: las variables de Supabase en Preview, la llave de servicio, la migración en la base de desarrollo y la configuración de Google. Los valores los escribe la persona responsable directamente en Cloudflare, Google y Supabase: nunca por chat.

## Qué hace
- Un propietario o administrador pulsa **Conectar canal de YouTube** en `/platform/connected-apps`, autoriza en Google y vuelve a KYNOVA.
- KYNOVA consulta a YouTube el canal de esa cuenta y muestra su **nombre** y su **identificador**. Solo entonces dice «Conectado».
- Estados: desconectado · conectado · autorización vencida · error. Si el servidor no tiene credenciales, la pantalla lo dice y lista los **nombres** que faltan; no simula nada.
- **Verificar de nuevo** vuelve a preguntar a Google; **Desconectar** borra el permiso guardado y lo revoca en Google.
- Solo lectura: no sube, programa ni publica videos.

## El entorno exacto (leído de la configuración existente)
| Dato | Valor | Origen |
|------|-------|--------|
| Worker de Preview | `kynova-os-preview` (`wrangler.jsonc`, entorno `preview`) | `wrangler.jsonc` |
| **URL de Preview** | `https://kynova-os-preview.novamarketingstudiocr.workers.dev` | `docs/STATE.md` (sección Plataforma) |
| **Callback para Google (copiar tal cual)** | `https://kynova-os-preview.novamarketingstudiocr.workers.dev/api/v1/connections/youtube/callback` | URL + ruta del código |
| Supabase de desarrollo | proyecto `hrridjfbrkewpengrmmh` (kynova-spike-desechable) | `docs/STATE.md`, Sprint 67 |
| Secretos en Preview ahora | `SPIKE_SECRET_CANARY` y `KYNOVA_ENCRYPTION_KEY` (nombres leídos con `npx wrangler secret list --env preview`; nunca los valores) | Cloudflare, 2026-11-24 |
| Variables de Supabase en Preview | **ninguna** (`SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` no figuran en la versión activa) | `wrangler versions view`, 2026-11-24 |
| Versión activa de Preview | `76d21a3f-6725-49c4-84ac-65741ff7231a` (desplegada por el flujo `deploy-preview` desde `042e1b5`) | Cloudflare |

Estado real del entorno (verificado el 2026-11-24):
- **`KYNOVA_ENCRYPTION_KEY`: creada hoy** en Preview con una llave AES-256 generada en el momento y enviada directamente a Cloudflare, **sin imprimirla ni guardarla en ningún lado**. Antes no existía ninguna, así que no se reemplazó ni se rotó nada, y ninguna ruta ni pantalla cifraba datos con ella (el cifrado del Backend Core, incluido `lib/backend/integration/archive.ts`, es una biblioteca que nadie usa todavía: si algún día se conecta compartirá este nombre de llave y habrá que decidirlo con un ADR). **No existe copia de respaldo**: si algún día se pierde o se cambia, los permisos guardados dejan de abrirse y la pantalla pide autorizar de nuevo; no se pierde nada más.
- **Faltan** `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
- **Preview no tiene variables de Supabase** (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`): por eso `/api/v1/me` y las rutas de YouTube responden `503 not_configured` y el inicio de sesión no puede funcionar todavía. Es un requisito previo de esta función (no de YouTube): sin sesión no hay quien conecte un canal.
- **El código ya está en Preview**: `/login` y `/platform/connected-apps` responden 200 y las cinco rutas de YouTube existen (`503 not_configured` mientras falten las variables; nunca 404). Un POST a `start`, `verify` o `disconnect` sin configuración devuelve 503, no ejecuta nada.

## La migración y sus dependencias
`supabase/migrations/20261128000100_connector_connections.sql` usa únicamente objetos de estas migraciones, que **ya están aplicadas** en el proyecto `hrridjfbrkewpengrmmh` según el registro del Sprint 67 (las ocho migraciones verificadas por ChatGPT con su conector de Supabase; no las verifiqué yo):
- `20261031000000_tenancy_core.sql`: tablas `tenants` y `memberships`, función `private.touch_updated_at`.
- `20261106000100_backend_foundations.sql`: `private.has_role`, `private.is_admin`, `private.protect_identity`, `private.audit_row` y la tabla `audit_log`.

**No requiere ninguna migración remota previa pendiente.** Es independiente de `20261127000100_subscriptions.sql` (facturación), que **sigue sin aplicarse y no debe aplicarse para esto**. Orden: aplicar solo `20261128000100`.

Antes de aplicar, en el SQL Editor de ese proyecto, esta consulta de **solo lectura** confirma las dependencias (debe devolver `5`, `true`, `true`, `true` y `false`):
```sql
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('has_role', 'is_admin', 'protect_identity', 'touch_updated_at', 'audit_row')) as funciones_privadas,
  to_regclass('public.tenants') is not null as tiene_tenants,
  to_regclass('public.memberships') is not null as tiene_memberships,
  to_regclass('public.audit_log') is not null as tiene_audit_log,
  to_regclass('public.connector_connections') is not null as ya_aplicada;
```
Si algún valor no coincide, no se aplica: se revisa primero qué falta. Reversión: el encabezado de la migración.

## Pasos de activación (en este orden; ninguno está hecho)
### 1. Google Cloud Console (lo hace la persona dueña de la cuenta de Google)
1. Crear un proyecto y activar **YouTube Data API v3** («APIs y servicios → Biblioteca»).
2. «Pantalla de consentimiento de OAuth»: tipo **Externo**, estado **Pruebas**; añadir como **usuario de prueba** tu cuenta de Google (la que tiene el canal) y agregar **solo** el permiso `https://www.googleapis.com/auth/youtube.readonly`.
3. «Credenciales → Crear credenciales → ID de cliente de OAuth» → **Aplicación web**. En «URI de redireccionamiento autorizados» pegar exactamente: `https://kynova-os-preview.novamarketingstudiocr.workers.dev/api/v1/connections/youtube/callback` (y, solo si vas a probar en tu máquina, `http://localhost:3000/api/v1/connections/youtube/callback`).
4. Copiar el **ID de cliente** (termina en `.apps.googleusercontent.com`) y el **secreto de cliente**. No los pegues en el chat ni en ningún archivo del repositorio.

### 2. Variables y secretos de Preview que faltan (los escribes tú; cada comando pide el valor sin mostrarlo)
```
npx wrangler secret put SUPABASE_URL --env preview
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY --env preview
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env preview
npx wrangler secret put GOOGLE_CLIENT_ID --env preview
npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview
```
- `SUPABASE_URL`: `https://hrridjfbrkewpengrmmh.supabase.co` (la dirección del proyecto de desarrollo; no es secreta). `SUPABASE_PUBLISHABLE_KEY`: la llave **publicable** de ese proyecto (Supabase → Project Settings → API; es pública por diseño, la protege el RLS).
- `SUPABASE_SERVICE_ROLE_KEY`: la llave `service_role` del mismo proyecto. **Salta el RLS: solo en el servidor** y solo por este comando.
- `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`: los del paso 1.
- `KYNOVA_ENCRYPTION_KEY` **ya está** (no la repitas: reemplazarla invalidaría los permisos guardados).
- Comprobar sin ver valores: `npx wrangler secret list --env preview` debe mostrar los cinco nombres nuevos más `KYNOVA_ENCRYPTION_KEY` y `SPIKE_SECRET_CANARY`.
- En Supabase (Authentication → URL Configuration), la URL de Preview debe figurar como **Site URL** o en «Redirect URLs», y el correo de inicio de sesión debe poder enviarse: con el SMTP por defecto de Supabase solo reciben correo los miembros del equipo del proyecto.

### 3. Base de datos (migración remota: requiere tu aprobación explícita)
Ejecutar la consulta de dependencias de arriba y, si coincide, aplicar `supabase/migrations/20261128000100_connector_connections.sql` en el SQL Editor del proyecto `hrridjfbrkewpengrmmh`. Después, verificar de forma de solo lectura que existen `public.oauth_states` y `public.connector_connections` con RLS activado y que `authenticated` y `anon` **no** pueden ejecutar `begin_connector_oauth`, `complete_connector_oauth`, `get_connector_secret`, `mark_connector_state` ni `disconnect_connector`.

### 4. Código en Preview — hecho
Desplegado el 2026-11-24 por el flujo `deploy-preview` (Linux; el Worker no se puede compilar en Windows: módulo nativo `sharp`). Para volver a desplegar, el mismo disparador: un commit con `[deploy-preview]` en el mensaje empujado a `ci/linux-validation-on-main`. Los secretos nuevos se aplican por sí solos al guardarlos; no hace falta redesplegar.

### 5. Comprobación final (con tu cuenta, ~5 minutos)
1. Abrir `https://kynova-os-preview.novamarketingstudiocr.workers.dev`, iniciar sesión como **propietario o administrador** de una empresa y entrar a **Plataforma → Apps conectadas** (`/platform/connected-apps`).
2. Arriba debe aparecer «YouTube — conexión real del canal» como **Desconectado** y **sin** el aviso de credenciales faltantes (si lista nombres, falta ese secreto).
3. Pulsar **Conectar canal de YouTube** → Google → elegir **tu cuenta de prueba y el canal** → aceptar el permiso de solo lectura.
4. Al volver, debe verse **Conectado** con el **nombre real y el identificador (empieza por `UC…`) de tu canal**. Contrástalos con YouTube Studio → Configuración → Canal → Configuración avanzada (ID del canal). Si no coinciden, no sigas y avisa.
5. Pulsar **Verificar de nuevo**: debe decir que la autorización sigue vigente y el canal coincide, y la «última verificación» debe actualizarse.
6. Pulsar **Desconectar → Sí, desconectar**: debe pasar a **Desconectado** y decir si Google confirmó la revocación. Comprobar en `https://myaccount.google.com/permissions` que KYNOVA ya no figura (o desapareció).
7. (Opcional) volver a **Conectar** y comprobar que funciona de nuevo.
8. Opcional, ya con la función probada: como miembro o lector de la empresa, la tarjeta no debe mostrar botones.

Lo que debe fallar de forma segura: sin sesión, la ruta responde 401; sin los secretos, el botón queda desactivado; en modo «Pruebas», a los **7 días** la pantalla mostrará «Autorización vencida».

## Límites conocidos
- Una conexión de YouTube por empresa; un canal no puede estar en dos empresas a la vez.
- Una cuenta de Google sin canal de YouTube no se puede conectar («no tiene un canal»).
- Salir del modo «Pruebas» exige la verificación de Google del permiso sensible; es un trámite externo y no forma parte de esta entrega.
- No hay verificación periódica: es a petición.
