# Conexión real de un canal de YouTube (solo lectura)

> Estado: implementada en local (ADR-0038). **Todavía no conecta con Google**: faltan las credenciales y aplicar la migración al proyecto de Supabase. Nada de lo siguiente se pide por chat: los valores los escribe la persona responsable directamente en Google Cloud y en Wrangler.

## Qué hace
- Un propietario o administrador pulsa **Conectar canal de YouTube** en `/platform/connected-apps`, autoriza en Google y vuelve a KYNOVA.
- KYNOVA consulta a YouTube el canal de esa cuenta y muestra su **nombre** y su **identificador**. Solo entonces dice «Conectado».
- Estados: desconectado · conectado · autorización vencida · error. Si el servidor no tiene credenciales, la pantalla lo dice y lista los **nombres** que faltan; no simula nada.
- **Verificar de nuevo** vuelve a preguntar a Google; **Desconectar** borra el permiso guardado y lo revoca en Google.
- Solo lectura: no sube, programa ni publica videos.

## Qué falta para la conexión real (en este orden)
### 1. Google Cloud Console (una vez; lo hace la persona dueña de la cuenta de Google)
1. Crear un proyecto y, en «APIs y servicios → Biblioteca», activar **YouTube Data API v3**.
2. «Pantalla de consentimiento de OAuth»: tipo **Externo**, estado **Pruebas**. Añadir como **usuarios de prueba** las cuentas de Google que conectarán un canal (máximo 100). Agregar **solo** el permiso `https://www.googleapis.com/auth/youtube.readonly`.
3. «Credenciales → Crear credenciales → ID de cliente de OAuth»: tipo **Aplicación web**. En «URI de redireccionamiento autorizados» añadir, **uno por entorno y exactamente así**:
   - `https://<URL-del-entorno-preview>/api/v1/connections/youtube/callback`
   - `https://<URL-de-produccion>/api/v1/connections/youtube/callback` (cuando exista)
   - para desarrollo local: `http://localhost:3000/api/v1/connections/youtube/callback`
4. Copiar el **ID de cliente** (termina en `.apps.googleusercontent.com`) y el **secreto de cliente**. No los pegues en el chat, en un archivo del repositorio ni en una incidencia.

### 2. Secretos de Wrangler (el entorno de pruebas es `preview`)
Cada comando pide el valor de forma interactiva; no queda en el historial ni en el repositorio:
```
npx wrangler secret put GOOGLE_CLIENT_ID --env preview
npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview
npx wrangler secret put KYNOVA_ENCRYPTION_KEY --env preview
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env preview
```
- `KYNOVA_ENCRYPTION_KEY` es una llave AES-256 de 32 bytes en base64. Se genera en tu máquina, sin guardarla en ningún archivo del repositorio: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (copia la salida directamente al comando anterior). **Guárdala en tu gestor de contraseñas**: si se pierde, los permisos guardados dejan de poder abrirse y hay que autorizar de nuevo.
- `SUPABASE_SERVICE_ROLE_KEY` ya se configuró para la prueba del presupuesto de IA; si existe en `preview`, no hace falta repetirla.
- Para desarrollo local, los mismos nombres van en `.env.local` (no versionado).

### 3. Base de datos (requiere aprobación explícita: es una migración remota)
Aplicar `supabase/migrations/20261128000100_connector_connections.sql` al proyecto de Supabase del entorno (SQL Editor). Depende de las migraciones anteriores (`private.protect_identity`, `private.touch_updated_at`, `private.audit_row`, `private.is_admin`). **No se ha aplicado a ningún proyecto remoto.** Reversión: ver el encabezado de la migración.

### 4. Probar
1. Entrar a `/platform/connected-apps` como propietario o administrador de una empresa.
2. «Conectar canal de YouTube» → elegir la cuenta (de las de prueba) y el canal → aceptar el permiso de solo lectura.
3. Debe volver a KYNOVA mostrando «Conectado» con el nombre y el identificador del canal.
4. «Verificar de nuevo» y «Desconectar» para comprobar el resto del ciclo. En modo «Pruebas», a los **7 días** la autorización vence y la pantalla debe mostrar «Autorización vencida».

## Límites conocidos
- Una conexión de YouTube por empresa; un canal no puede estar en dos empresas a la vez.
- Una cuenta de Google sin canal de YouTube no se puede conectar («no tiene un canal»).
- Salir del modo «Pruebas» exige la verificación de Google del permiso sensible; es un trámite externo y no forma parte de esta entrega.
- No hay verificación periódica: es a petición.
