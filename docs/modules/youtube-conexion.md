# Conexión real de un canal de YouTube (solo lectura)

> Estado: implementada y probada en local, publicada en `feat/beta-dashboard-v1` (CI en verde, ADR-0038). **Todavía no conecta con Google**: falta configurar Google y los secretos, aplicar una migración al Supabase de desarrollo y desplegar el código a Preview. Nada de esto se pide por chat: los valores los escribe la persona responsable directamente en Google Cloud y en Wrangler.

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
| Secretos que ya existen en Preview | **solo** `SPIKE_SECRET_CANARY` (se listaron los nombres con `npx wrangler secret list --env preview`; nunca los valores) | Cloudflare, 2026-11-28 |

Consecuencias de ese último dato:
- **No existe `KYNOVA_ENCRYPTION_KEY` en Preview**, así que no hay nada que reutilizar y ningún otro dato cifrado que pueda romperse: esta función es el único consumidor de esa llave hoy (el cifrado del Backend Core, incluido `lib/backend/integration/archive.ts`, existe como biblioteca que ninguna pantalla ni ruta usa todavía: si algún día se conecta, compartirá este mismo nombre de llave y habrá que decidirlo con un ADR). Se crea una **nueva, una sola vez, y no se rota después** (si cambia, los permisos guardados dejan de abrirse y hay que autorizar de nuevo; la pantalla lo detecta y pide autorizar otra vez).
- **No existe `SUPABASE_SERVICE_ROLE_KEY` en Preview**: hace falta para que el servidor registre la conexión (la llave no puede leer ni escribir tablas; solo ejecutar las funciones de la migración).
- Las variables no secretas de Supabase (URL y llave publicable) no aparecen en `wrangler secret list` y **no las verifiqué**: si el inicio de sesión de Preview funciona, ya las tiene; si no, la pantalla de conexiones tampoco cargará y hay que resolverlo antes (es un tema del Preview, no de esta función).
- **El código nuevo todavía no está en Preview**: `…/api/v1/connections/youtube` responde 404 allí. Hay que desplegar antes de probar (ver el paso 5).

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

### 2. Secretos de Wrangler en Preview (valores escritos por ti, directamente)
Cada comando pide el valor de forma interactiva; no queda en el historial ni en el repositorio:
```
npx wrangler secret put GOOGLE_CLIENT_ID --env preview
npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview
npx wrangler secret put KYNOVA_ENCRYPTION_KEY --env preview
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env preview
```
- `KYNOVA_ENCRYPTION_KEY`: genera una llave nueva en tu máquina y cópiala directamente al comando (no la guardes en un archivo del repositorio): `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Guárdala en tu gestor de contraseñas.** Como no existe ninguna en Preview, no se está reemplazando nada.
- `SUPABASE_SERVICE_ROLE_KEY`: la «service_role» del proyecto `hrridjfbrkewpengrmmh` (Supabase → Project Settings → API). Es la que salta el RLS: solo en el servidor.
- Comprobar sin ver valores: `npx wrangler secret list --env preview` debe mostrar los cuatro nombres además de `SPIKE_SECRET_CANARY`.

### 3. Base de datos (migración remota: requiere tu aprobación explícita)
Ejecutar la consulta de dependencias de arriba y, si coincide, aplicar `supabase/migrations/20261128000100_connector_connections.sql` en el SQL Editor del proyecto `hrridjfbrkewpengrmmh`. Después, verificar de forma de solo lectura que existen `public.oauth_states` y `public.connector_connections` con RLS activado y que `authenticated` y `anon` **no** pueden ejecutar `begin_connector_oauth`, `complete_connector_oauth`, `get_connector_secret`, `mark_connector_state` ni `disconnect_connector`.

### 4. Código en Preview (despliegue: requiere tu aprobación explícita)
Los secretos de Wrangler quedan disponibles en el siguiente despliegue. El código de esta rama (`ab5be85` en adelante) debe desplegarse a `kynova-os-preview` con el flujo existente (`deploy-preview.yml`: se dispara en `ci/linux-validation-on-main` o a mano con la confirmación `PREVIEW`). Hasta entonces, Preview no tiene las rutas de YouTube.

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
