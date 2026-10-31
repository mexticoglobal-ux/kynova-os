# Spike temporal de Supabase

Este código y el esquema `schema.sql` sirven únicamente para probar autenticación SSR y aislamiento RLS en un proyecto desechable con datos ficticios. No habilitan el guardado del Business Assessment ni están preparados para producción.

## Requisitos antes de ejecutar

1. Crear un proyecto Supabase exclusivo para la prueba.
2. Crear tres usuarios confirmados y ficticios: A y B con membresía separada; C sin membresía. No usar datos reales de Nova.
3. En Auth, configurar la plantilla *Magic Link* para que el correo contenga solo el código `{{ .Token }}`. El spike usa un **código OTP que se escribe en `/spike/login`, no un enlace de acceso**: admite de 6 a 10 dígitos según `OTP length` del proyecto (el valor predeterminado de Supabase es 6). No existe ruta de callback, no se pasa `emailRedirectTo` y las URLs de redirección no intervienen. No incluyas `{{ .ConfirmationURL }}` en la plantilla; un enlace en el correo no completaría ningún inicio de sesión.
4. Configurar la entrega de correo. El SMTP integrado de Supabase solo envía a direcciones autorizadas de la organización; si los buzones de prueba no están autorizados, usar SMTP propio para el proyecto desechable.
5. Ejecutar `schema.sql` una vez, en orden. Bloque 0 modifica permisos por defecto del rol `postgres`; su `REVOKE EXECUTE` global afecta a funciones futuras en todos los esquemas. Nunca copiar el Bloque 0 a producción.
6. Añadir las variables a `.dev.vars` local; no incluir valores reales en Git ni en el chat.

## Flujo real de tenancy (ADR-0006, fase 1b)

La migración `supabase/migrations/20261031000000_tenancy_core.sql` reemplaza a las tablas `tenants` y `memberships` de `schema.sql` (añade el rol y `business_profiles`). **No ejecutes los dos en el mismo proyecto**: ambos crean esas tablas. Orden para un proyecto desechable nuevo, siempre desde el editor SQL y sin `supabase db push`:

1. Bloque 0 de `schema.sql` (líneas de `alter default privileges`): solo para este proyecto desechable.
2. La migración `20261031000000_tenancy_core.sql`.
3. `supabase/seed.sql`, sustituyendo los dos correos de los usuarios A y B. Usa los mismos UUID de empresa que el spike.
4. Pruebas del aislamiento: `supabase/tests/isolation.sql` está pensado para el Postgres efímero de CI (usa un `auth` simulado y crea datos propios); en Supabase usa las verificaciones V2 a V8 de `schema.sql` adaptadas y las pruebas manuales de abajo.
5. Opcional, para seguir probando `/spike` y `/api/spike/items`: ejecuta solo las sentencias de `spike_items` de `schema.sql` (tabla, índice, permisos, RLS, políticas y filas ficticias). Dependen de `private.is_member`, que ya crea la migración.

Prueba manual del perfil (inicio de sesión por código en `/spike/login`, luego en la misma sesión del navegador):

- `GET /api/profile` con A: devuelve la empresa A, rol `owner` y el perfil. Con B: la empresa B y `profile: null` hasta crearlo. Con C: `404 no_tenant`. Sin sesión: `401`.
- `PUT /api/profile` con A o B (JSON con `Content-Type: application/json`, campos `tradeName`, `country`, `locale` y las seis respuestas): crea o actualiza **solo el perfil de su propia empresa**. El cuerpo no puede elegir el tenant ni el autor: una clave extra da `400`.
- Con una membresía `member` (no propietario): `GET` funciona y `PUT` da `403`.
- Las respuestas llevan `Cache-Control: private, no-store`.

Estado: **implementado, pendiente de Go**. Nada de esto se ha ejecutado contra un proyecto Supabase real; las pruebas automáticas cubren los contratos, la capa de datos y el endpoint con un cliente simulado, y el SQL se prueba en CI sobre un Postgres efímero.

## Variables locales

```text
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SPIKE_SECRET_CANARY=
```

La clave publicable sí puede usarse desde el servidor del spike. No se configura ni se necesita `service_role` o una clave secreta de Supabase. La variable canario debe ser un texto inventado y el verificador nunca imprime su valor. Para una comprobación puntual, `SPIKE_SECRET_CANARY` también se puede pasar como variable de entorno del proceso, sin crear `.dev.vars`.

## Flujo de prueba

- `http://localhost:3000/spike/login` (desarrollo) o `http://127.0.0.1:8787/spike/login` (`npm run preview`): solicita un OTP por correo y verifica el código recibido (de 6 a 10 dígitos; sin enlace de acceso). Una persona ya autenticada que abre esta ruta es redirigida a `/spike`.
- Un cuerpo de formulario ilegible en las rutas de solicitud y verificación recibe `400 {"error":"invalid_request"}`.
- `http://127.0.0.1:8787/spike`: muestra las filas que RLS deja ver a la sesión autenticada.
- `http://127.0.0.1:8787/api/spike/items`: responde 401 sin sesión; con A/B devuelve solo sus filas; con C devuelve una lista vacía.
- La consulta del endpoint no filtra por `tenant_id`: el aislamiento debe provenir de RLS.
- Las páginas y respuestas del spike tienen `Cache-Control: private, no-store`.
- `npm run spike:check-canary` escanea los assets del navegador y no muestra el valor de la canaria.

## Pendiente de validar: sesiones revocadas (A1)

Las páginas y los endpoints protegidos usan `supabase.auth.getClaims()`. Puede aceptar un JWT todavía vigente aunque la sesión se haya cerrado o revocado: con claves de firma asimétricas la validación es local y no consulta si la sesión sigue activa, y PostgREST también acepta ese token hasta que caduque. Este comportamiento **no se ha cambiado ni validado** en este spike. Antes de dar por resuelto B4 hay que probar, con una sesión real:

1. Una cookie editada o inválida: debe dar 401 o redirección.
2. Un access token copiado antes de cerrar sesión y reutilizado después: anotar si sigue devolviendo datos y hasta cuándo (caducidad del JWT del proyecto).
3. Decidir con evidencia si basta con esa ventana o si se necesita una comprobación de sesión en servidor para el piloto.

## Criterios pendientes de validación externa

El build local no prueba envío de correo, lectura/escritura real de cookies en Workers, renovación de sesión ni RLS. A y B del ADR-0006 solo pueden cerrarse tras completar OTP manual con A/B/C en `npm run preview` y, para el criterio de Preview desplegado, en el Worker de Preview con aprobación explícita del usuario.
