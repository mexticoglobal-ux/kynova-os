# ADR-0038: Conexión real de un canal de YouTube (solo lectura): OAuth, credenciales cifradas en el servidor y estado verificado

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto (implementado solo en local; migración sin aplicar a ninguna base remota; sin credenciales de Google configuradas) |
| **Fecha** | 2026-11-28 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | integraciones · oauth · secretos · multiempresa · seguridad |
| **Sustituye a** | — (concreta, para YouTube, los puntos 4 a 6 del ADR-0024) |
| **Sustituido por** | — |

## Contexto
El ADR-0024 dejó los doce conectores como arquitectura simulada: un reductor puro y una pantalla que «conecta» con respuestas de ejemplo. Falta la primera conexión **real**: autorizar un canal de YouTube y comprobar su identidad dentro de KYNOVA. Esta entrega **no** sube, programa ni publica videos. Un «Conectado» que viniera de una respuesta simulada sería engañoso, así que la pantalla simulada deja de mostrar YouTube.

Requisitos verificados en la documentación oficial de Google (2026-11): OAuth 2.0 para aplicaciones web de servidor (código de autorización con secreto de cliente; `access_type=offline` para un refresh token; `state` contra falsificación); `channels.list` con `mine=true` acepta el permiso `youtube.readonly` y cuesta 1 unidad de cuota; un proyecto con la pantalla de consentimiento «Externo» en estado «Pruebas» recibe refresh tokens que **caducan a los 7 días**; un refresh token deja de funcionar si se revoca, si pasan seis meses sin usarlo o si se supera el límite de 100 por cuenta y cliente (`invalid_grant`); la revocación usa `https://oauth2.googleapis.com/revoke`.

## Decisión
1. **Permiso mínimo:** solo `https://www.googleapis.com/auth/youtube.readonly`. Si Google concede cualquier otro permiso (o no concede ese), la conexión se **rechaza, se revoca y no se guarda nada**. Ningún código de esta entrega puede subir, programar, publicar ni generar contenido.
2. **Inicio:** `POST /api/v1/connections/youtube/start` (solo propietario o administrador de la empresa; la base lo comprueba de nuevo). El servidor genera un `state` de 32 bytes aleatorios, guarda **solo su SHA-256** ligado a la **empresa**, al **usuario**, a la dirección de retorno y a una vigencia de 10 minutos, y devuelve la dirección de autorización de Google (sin secretos). Máximo 10 autorizaciones pendientes por empresa.
3. **Retorno:** `GET /api/v1/connections/youtube/callback`. Lo atiende la sesión del propio usuario: antes de gastar el código se verifica (sin consumirlo) que el `state` existe, vigente, no usado, del mismo usuario, y que la dirección de retorno es la misma. El `state` se consume **una sola vez aun cuando la conexión falle después**. El resultado vuelve a la pantalla como una palabra corta; nunca viaja un código ni un token.
4. **Identidad verificada:** el servidor intercambia el código, **consulta `channels.list?mine=true` con la cuenta que autorizó** y solo entonces graba la conexión con el **id y el nombre que devolvió Google**. Sin canal (cuenta sin canal de YouTube) o con un fallo de consulta no se conecta nada y se revoca lo obtenido.
5. **Credenciales:** el refresh token se **cifra en el servidor** (AES-GCM del Backend Core, ligado a la empresa) antes de llegar a la base; la base solo guarda el sobre cifrado, **ningún rol de sesión ni la llave de servicio puede leer las tablas** y el estado se lee con una función que no lo incluye. El secreto del cliente y la llave de cifrado se leen **solo por el Secrets Manager**; nada se escribe en logs, en respuestas ni en el repositorio.
6. **Estados:** desconectado, conectado, **autorización vencida** (Google ya no la honra: se **borra** el permiso guardado), **error** (fallo posible temporal: se conserva el permiso) y, aparte, «faltan credenciales de Google» (no es un estado de la conexión: el botón no se activa y la pantalla lista los **nombres** que faltan y los pasos exactos). `POST …/verify` vuelve a consultar a Google; un canal distinto para el mismo permiso es un error, nunca un cambio silencioso de identidad.
7. **Desconexión:** `POST …/disconnect` **borra el permiso cifrado en la misma sentencia** que marca la desconexión (deja de poder usarse pase lo que pase después) y luego intenta revocarlo en Google; si Google no responde, se dice que la revocación no se pudo confirmar. La fila queda como historial.
8. **Empresas y permisos:** una conexión viva por empresa y conector, y un canal pertenece a **una** empresa a la vez (índices únicos parciales). Solo propietario y administrador la ven y la administran; miembros y lectores no. La **escritura de una identidad o de una credencial es solo del servidor** (`service_role`): un usuario autenticado no puede declarar un canal como conectado.
9. **Datos:** migración nueva `20261128000100_connector_connections.sql` (`oauth_states`, `connector_connections`, seis funciones de servidor y una de lectura), RLS con denegación explícita, auditoría que **redacta** el token. Local y **sin aplicar** a ningún proyecto remoto.
10. **Arquitectura:** el código de servidor de la conexión vive en `lib/integrations/youtube/` y usa el cifrado y el Secrets Manager del Backend Core (excepción explícita en las tres guardas que impiden a otros módulos importarlo). La pantalla de demostración de Apps conectadas ya no incluye YouTube.

## Opciones
- **Guardar el token en el navegador o en una cookie:** descartada (expone la credencial).
- **PKCE sin secreto:** descartada para un cliente confidencial; la documentación de Google para aplicaciones web de servidor describe el flujo con secreto de cliente y `state`.
- **Dejar que el usuario autenticado escriba la conexión por RPC:** descartada (podría declarar cualquier canal).
- **Guardar también el access token:** descartada; dura una hora y se obtiene de nuevo del refresh token.

## Consecuencias
- Para conectar de verdad hacen falta, fuera del repositorio: el proyecto y el cliente OAuth en Google Cloud, los cuatro secretos en Wrangler y **aplicar la migración al proyecto de Supabase** (pendiente de aprobación; ver `docs/modules/youtube-conexion.md`).
- En modo «Pruebas» el permiso renovable **caduca a los 7 días**: la pantalla mostrará «Autorización vencida» y habrá que autorizar de nuevo. Salir de «Pruebas» exige publicar la app y la **verificación de Google** de un permiso sensible (`youtube.readonly`): es un trámite externo.
- El `redirect_uri` debe coincidir **exactamente** con uno registrado por entorno.
- No hay renovación programada ni consulta periódica: la verificación es a petición.
- Pendiente (otras entregas): subir, programar y publicar videos (otro permiso, auditoría de la API y Nivel 3 con aprobación); varios canales por empresa; conectar los demás conectores.

## Plan de reversión
Antes de aplicar a una base remota: eliminar las seis funciones, `private.member_is_admin` y las dos tablas (ver el encabezado de la migración) y quitar las rutas. Después de conectar canales reales, desconectarlos primero (revoca y borra los permisos).

## Verificación
Pruebas SQL en PostgreSQL local (`supabase/tests/connectors.sql`): denegación por defecto, estado ligado a empresa y usuario y de un solo uso (también si falla), vigencia, rol comprobado de nuevo, un canal por empresa, permiso solo cifrado, borrado al vencer y al desconectar, auditoría sin token, borrado de empresa. Pruebas de TypeScript con Google simulado **solo en las pruebas**: dirección de autorización, intercambio, identidad, permisos extra, vencimiento, error temporal, desconexión y ausencia de secretos en código y logs. Conexión real con Google: **no verificada** (faltan credenciales).

## Referencias
ADR-0024, ADR-0036 (el mismo patrón de frontera de confianza), `docs/modules/youtube-conexion.md`.
