# Resultado del spike de Supabase

**Estado:** Go parcial — OTP y aislamiento A/B/C comprobados en el Worker de Preview; quedan la renovación de sesión (B3), validar en Preview la corrección de A1/B4 y la revisión de seguridad  
**Última revisión:** 2026-11-03 (B1 y B5 PASS en Preview; corrección de A1 en rama, sin desplegar)
**Rama revisada:** `main` en `df58188` + rama `fix/spike-revoked-session-a1`

Este informe distingue comprobaciones locales, SQL y evidencia manual del Worker de Preview. La prueba A/B/C demuestra el aislamiento observable por la API en Preview, pero no cierra por sí sola los criterios de sesión y seguridad del ADR-0006.

## Evidencia del proyecto Supabase desechable · 2026-10-31

| Comprobación | Resultado | Alcance |
|---|---|---|
| Proyecto desechable, usuarios A/B/C, Bloque 0, migración y seed ficticio | Configurados | El seed deja A y B como dueños de sus empresas de prueba y C sin membresía |
| `supabase/tests/verify_project.sql` | **13/13 PASS** | Verificación SQL de estructura, grants, RLS y datos esperados en el proyecto real |
| Nova Marketing Studio como tenant A de prueba | Configurada | Actualizado en el proyecto desechable y confirmado por SQL; se conservaron las respuestas sintéticas del cuestionario |
| Callback de enlace mágico PKCE | Implementado | `/api/spike/auth/callback` intercambia `code` en el servidor; OTP numérico sigue disponible. URLs de retorno de localhost, Preview local y Worker permitidas en Supabase |
| Envío de correo Auth a cuentas externas | **Bloqueado por SMTP** | El proveedor integrado de Supabase solo envía a miembros del equipo (2 correos/hora). SMTP propio es necesario para probar A/B/C |
| Plantilla de correo OTP | Opcional | Ya no hace falta modificarla para probar enlaces mágicos; editarla y recibir códigos sigue requiriendo SMTP propio |
| Registros de Auth en el dashboard | Sin datos disponibles | No fue posible obtener de Logs el detalle del error del envío |
| Tipos remotos | **Pendiente** | CLI oficial 2.122.0 respondió `GenTypesNetworkError: TransportError`. Se activó el botón oficial de generación del dashboard, pero no se pudo confirmar ni localizar el archivo descargado. El token de lectura, limitado a este proyecto y 24 horas, nunca se usó y fue eliminado |

La configuración local de URL y clave publicable se usó como variable temporal de proceso; `.dev.vars` no se leyó ni se modificó. El correo se revisó únicamente para buscar el mensaje de Supabase de esta prueba. No se exponen aquí códigos de acceso ni secretos.

## Evidencia local

| Comprobación | Resultado | Alcance |
|---|---|---|
| ESLint | Pasa sin avisos | Código de la rama aislada |
| TypeScript | Pasa tras callback PKCE | `npm run typecheck` |
| Vitest | Pasa (2026-11-02): 16 archivos, 142 tests | `npm run test` completo en local. Incluye el callback PKCE (cookies de sesión `HttpOnly`/`SameSite=Lax`/`Path=/`, cookie temporal del correo limpiada con su misma ruta, intercambio fallido sin cookies) y el origen de `emailRedirectTo`: origen no permitido → `403 origin_not_allowed` sin enviar correo (ADR-0008). Cliente de Supabase simulado: no prueba Auth real |
| `typecheck` y `lint` completos | Pasan (2026-11-02) | `npm run typecheck`, `npm run lint` |
| ESLint del cambio | Pasa | Rutas de Auth, test nuevo y diccionarios; la compilación global no terminó |
| `next build` | Pendiente | Wrangler no pudo escribir su registro/configuración en AppData por permisos del entorno |
| Canario señuelo | Pasa: 66 assets de navegador, sin coincidencias | Assets estáticos de `.next`; no incluye el Worker de OpenNext |
| Build de OpenNext para Cloudflare | Pendiente de ejecutar en Linux CI | El build local choca con el acceso del sandbox de Windows a un directorio padre; ADR-0007 y workflow configurados, aún no conectados a GitHub |
| OTP por correo en `localhost:3000` | Pasa | Código de ocho dígitos recibido y verificado; sesión abierta con una cuenta ficticia |
| Aislamiento RLS por el endpoint local | Pasa | A vio A-1/A-2; B vio B-1/B-2; C inició sesión sin membresía y recibió cero filas |
| Sesión en desarrollo local | Parcial | La sesión sobrevivió una recarga y el cierre redirigió a `signed_out`; renovación en Workers pendiente |

## Evidencia del Worker de Preview · 2026-11-03

Worker probado: `kynova-os-preview` en `https://kynova-os-preview.novamarketingstudiocr.workers.dev`. El usuario confirmó que los códigos OTP llegaron y completó cada inicio de sesión; no se copiaron códigos ni credenciales al informe.

| Comprobación manual | Resultado | Evidencia y límite |
|---|---|---|
| Auth OTP en Preview | **Pasa** para las cuentas ficticias A, B y C | Capturas de las sesiones autenticadas; el usuario solicitó y verificó los códigos |
| Aislamiento A/B | **Pasa** en la interfaz del Worker | A mostró únicamente A-1/A-2 y el tenant A; B mostró únicamente B-1/B-2 y el tenant B |
| Usuario C sin membresía | **Pasa** en la interfaz del Worker | C inició sesión y la aplicación mostró “Esta cuenta no tiene membresía ni filas visibles” |
| API para C, sin membresía | **PASS** | `GET /api/spike/items` devolvió `{"items":[]}` y `GET /api/profile` devolvió `404 {"error":"no_tenant"}` |
| API sin sesión | **PASS, revisión adicional del 2026-11-03** | `GET /api/spike/items` y `GET /api/profile` devolvieron `401 {"error":"unauthorized"}` con `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache` y `Expires: 0`; se reportó también `PUT` sin sesión y desde otro origen como `403 invalid_origin`. No prueba las respuestas autenticadas con datos |
| Cookie temporal al cerrar sesión | Observada | La cookie de limpieza `kynova_spike_email_v2` mostró `Path=/; Max-Age=0; Secure; HttpOnly; SameSite=lax`. No es una cookie de sesión; los atributos de las cookies `sb-*` están en B1 |
| Cookie inválida o manipulada | **401 reportado** | Se indicó `401` y cabeceras `no-store`; no equivale a probar un JWT vigente revocado |
| Build del Worker en CI | **Pasa** en Linux, commit `40c32c7` | `npm run build:worker` y `wrangler deploy --dry-run --env preview` completaron; el deploy remoto quedó omitido. Wrangler reportó **7,006.79 KiB total / 1,553.66 KiB gzip**. No se desplegó en este job |
| Prueba de permisos adversariales por API | **Pendiente** | Las capturas prueban lectura aislada; no prueban aquí intentos directos de escritura entre tenants |

En Preview, C conservó la sesión después de recargar `/spike`. Cloudflare Observability mostró **18 éxitos y 0 errores** durante la última hora revisada (3-nov-2026), con solicitudes a `/spike`, `/api/profile` y `/api/spike/items`. Esto cubre A3 para esa ventana, no constituye garantía de ausencia de errores futuros.

En la revisión adicional del 2026-11-03 se reportó la respuesta 401 sin sesión con `private, no-store`, `Pragma` y `Expires`; las respuestas autenticadas con datos aún no tienen cabeceras verificadas.

Las capturas acreditan el resultado visual de cada cuenta, no la renovación del token ni la conducta de un JWT vigente tras revocar la sesión.

### Versión desplegada en Preview frente a `main` · 2026-11-03

El Preview se desplegó desde `7da4188` (workflow `deploy-preview`, `[deploy-preview]`). Entre `7da4188` y `main` (`f0d3e7d`) el único archivo que no es documentación ni workflow es `scripts/check-spike-canary.mjs`, una herramienta de CI que no forma parte del Worker. **El código de aplicación del Preview coincide con `main`; no hizo falta un nuevo despliegue.** Los commits locales de la pantalla de perfil y el estudio de creadores (`74ed9d5`) no están en `main` y, por tanto, tampoco en el Preview. Limitación: la coincidencia se deduce del historial de git; no se pudo listar versiones del Worker (sin `CLOUDFLARE_API_TOKEN`).

### Comprobaciones con sesión real: pendientes

Requieren iniciar sesión con las cuentas ficticias, y el código OTP llega al correo del usuario, por lo que no se ejecutaron desde esta sesión. Quedan cubiertas por `scripts/spike-session-checks.mjs`, que se ejecuta en la máquina del usuario y no se ha ejecutado contra sesiones reales. Reglas del script (verificadas con `scripts/spike-session-checks.test.ts`, 21 pruebas con un servidor simulado):

- Cookies, tokens y cuerpos de respuesta viven solo en memoria y se enmascaran antes de imprimir; solo se muestran estado HTTP, nombres y atributos de cookies, recuentos, códigos SQLSTATE y PASS / FAIL / NOT RUN. No escribe archivos.
- La ejecución normal solo envía `GET`. No hay `PATCH`/`POST`/`DELETE` contra perfiles ni membresías de A o B; el script se niega a escribir si el tenant de prueba coincide con A o B.
- Las escrituras (`--fixtures`) usan un tenant creado exclusivamente para la prueba (perfil que empieza por `FIXTURE`): intentos de `PUT`/`PATCH` sobre su perfil existente, que se restaura y se verifica en `finally`; si no se puede restaurar y verificar, el resultado es **FAIL**. No hay `INSERT` ni `DELETE`: las pruebas de insertar un perfil o autopromover una membresía quedan **NOT RUN** hasta tener una limpieza segura (los usuarios no tienen `DELETE` y no se usan claves de servicio). Un cero de filas afectadas solo cuenta si la fila existe, A no la ve y sigue intacta.
- Atributos de cookies, renovación (B3) y revocación (B4) son **NOT RUN** si no se observó un `Set-Cookie` `sb-*`, una renovación real o una sesión válida antes de cerrar sesión; un `GET` 200/404 con `no-store` no basta.

B1 (cookies) y B5 (caché autenticada) ya constan como PASS por observación en el Preview. Hasta que el script se ejecute con sesiones reales y se registre el resultado, B3, la validación de A1/B4 y las pruebas adversariales de escritura siguen abiertas. Nota: `PUT /api/profile` no acepta el tenant en la petición (se deriva de la membresía), así que el cruce entre tenants solo es alcanzable atacando directamente las tablas con el JWT propio.

## Criterios del ADR-0006: estado externo

| Área del ADR-0006 | Estado | Evidencia requerida |
|---|---|---|
| A1. Build y tamaño del Worker | **PASS** | En Linux CI, Wrangler reportó **7,006.79 KiB total / 1,553.66 KiB gzip** para `preview`. La documentación de Cloudflare (consultada el 2026-11-03) fija **64 MiB sin comprimir** en los planes Free y Paid y no tiene límite comprimido: 7,006.79 KiB sin comprimir equivalen a ≈**6.84 MiB**, por debajo del límite de 64 MiB (≈10.7 %) |
| A2. Consulta autenticada en Workers | **PASS en Worker de Preview** | Las sesiones A/B/C mostraron solo sus filas o cero filas para C. `npm run preview` local sigue pendiente para comparar |
| A3. Runtime sin errores | **PASS en la ventana revisada** | Cloudflare Observability mostró 18 éxitos y 0 errores en la última hora (3-nov-2026); revisar de nuevo durante pruebas futuras |
| A4. Secreto ausente del bundle | **PASS en los artefactos escaneados por CI** | El escáner no halló el canario en 137 archivos entre assets del navegador y el bundle del Worker; el valor no se imprime |
| B1. OTP y cookies seguras | **PASS** | OTP en Preview PASS. Las cuatro cookies `sb-*` de la sesión mostraron `HttpOnly`, `Secure`, `SameSite=Lax` y `Path=/` (observación del usuario en DevTools del Worker de Preview, 2026-11-03; no se copiaron valores) |
| B2. Persistencia de sesión SSR | **PASS para C** | La sesión de C siguió autenticada tras recargar `/spike` en el Worker; no prueba renovación del token (B3) |
| B3. Renovación de sesión | Pendiente | Renovación observada en el runtime de Workers |
| B4. Sesión inválida/cerrada | Parcial — **corrección en código, sin validar en vivo** | Sin sesión, ambos GET devolvieron 401 y una cookie inválida dio 401. Revisión de código (2026-11-03): con claves asimétricas `getClaims()` verifica solo firma y `exp`, de modo que el JWT de una sesión cerrada seguía autorizando hasta caducar. La rama `fix/spike-revoked-session-a1` autoriza con `getUser()`, que consulta a Auth. Falta probar en el Preview, tras desplegar la corrección, con `revoke` |
| B5. Sin caché compartida | **PASS** | `GET /api/profile` autenticado devolvió 200 con `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache` y `Expires: 0` (observación del usuario en el Preview, 2026-11-03). Las respuestas sin sesión llevan las mismas cabeceras |
| B6. Igualdad local/Preview | Parcial | El Worker de Preview pasó OTP y aislamiento A/B/C; falta ejecutar el mismo flujo en `npm run preview` y comparar |
| RLS y permisos mínimos | **SQL real: PASS (13/13)**; lectura A/B/C en Preview: **PASS** | `verify_project.sql` pasó en el proyecto desechable y A/B/C observaron aislamiento por la API en Preview. Faltan pruebas adversariales de escritura/permisos por API en Workers/Preview |

## Revisión de seguridad del código

| Hallazgo | Estado |
|---|---|
| A1. `getClaims()` puede aceptar un JWT vigente de una sesión revocada | **Confirmado en el código** (`@supabase/auth-js` 2.118.0: con clave asimétrica verifica firma y `exp` en local y no consulta a Auth; solo con algoritmo simétrico cae a `getUser()`). **Corregido en la rama `fix/spike-revoked-session-a1`** con `lib/db/supabase-spike-auth.ts` (`getUser()` en `/api/profile`, `/api/spike/items`, `/spike` y el login); el middleware sigue usando `getClaims()` solo para refrescar cookies. Pruebas de regresión con un JWT que verifica en local y una sesión revocada; con el comportamiento anterior fallan 11 pruebas. Pendiente: validarlo en el Preview tras desplegar. Coste: una consulta a Auth por solicitud protegida. **Límite residual:** el token copiado sigue siendo válido para PostgREST hasta que caduque; ver el README |
| Revisión de seguridad del cambio de A1 (2026-11-03, manual: el skill `/security-review` no arrancó por `origin/HEAD` ausente) | Sin hallazgos altos ni medios. Hallazgo bajo corregido: una caída de Auth se leía como sesión cerrada (401); ahora `getVerifiedSpikeUser` lanza y las rutas responden 503 (cubierto por pruebas). Sin fuga de errores, sin secretos, el tenant sigue saliendo de la membresía. Límite residual de PostgREST documentado en el README |
| A4. El `catch` de la página de login capturaba `redirect("/spike")` | Corregido en código; cubierto por prueba local |
| A5. `request.formData()` sin manejo de errores en solicitud y verificación OTP | Corregido en código (400 uniforme); cubierto por prueba local |
| A6. La cookie del correo se borraba con otra ruta | Corregido en código (opciones compartidas) y prueba local |
| A8. Cabeceras de seguridad | Pendiente — Preview reportó ausentes HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy` y `X-Frame-Options`; evaluar e implementar antes de un piloto con datos reales |

**Configuración de Auth observada en el dashboard, 2026-11-02 (solo lectura):** límites de Supabase Auth en 30 solicitudes/5 min para inicio de sesión y verificación OTP/enlace, 150 renovaciones/5 min; SMTP personalizado desactivado. CAPTCHA y bloqueo de contraseñas filtradas están desactivados. Estos límites protegen los endpoints de Auth de Supabase; no añaden rate limiting a la aplicación ni sustituyen las cabeceras de seguridad.

Las correcciones no sustituyen las pruebas con Supabase y Workers de la tabla anterior. Siguen pendientes rate limiting a nivel de aplicación, cabeceras de seguridad, confirmar la protección CSRF en Workers y revisar la ubicación de las consultas.

## Decisión provisional

**Go parcial.** Build y despliegue de Preview, OTP, lectura aislada A/B/C, cookies `sb-*` seguras (B1), `no-store` en respuestas autenticadas (B5) y respuestas 401 sin sesión están comprobados. El tamaño del Worker pasa (6.84 MiB sin comprimir frente a 64 MiB) y no hay canario en 137 archivos escaneados. No se declara Go completo: falta la renovación (B3), validar en el Preview la corrección de la revocación (A1/B4), comparación con `npm run preview`, pruebas adversariales de escritura y revisión de seguridad (incluidas cabeceras y controles de abuso).

## Para cerrar el informe

1. Ejecutar `scripts/spike-session-checks.mjs` con las cuentas ficticias (incluido `revoke A` y `--fixtures` con un tenant de prueba dedicado) y registrar sus resultados; comprobar la renovación de sesión (B3) y la reutilización del JWT tras cerrar sesión (A1/B4) en el Worker de Preview; revisar sus logs.
2. Tras fusionar y desplegar la corrección de A1 en el Preview, repetir `revoke` con una cuenta ficticia: debe dar 401. Cookies (B1), caché autenticada (B5), tamaño y canario ya están cerrados.
3. Repetir en `npm run preview` el mismo flujo OTP y A/B/C para cerrar la comparación con el Worker desplegado.
4. Ejecutar pruebas directas de permisos y aislamiento para las mutaciones de la API; completar la revisión de seguridad, incluida protección CSRF y controles de abuso.
5. Recuperar los tipos remotos (`lib/db/database.types.ts`, deuda D31) y tipar después `lib/db/tenancy.ts`.
6. Reemplazar este estado parcial por Go, No-Go o Go con alternativa solo cuando los criterios pendientes tengan evidencia.
