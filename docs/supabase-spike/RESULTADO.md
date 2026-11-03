# Resultado del spike de Supabase

**Estado:** Go parcial — OTP y aislamiento A/B/C comprobados en el Worker de Preview; quedan controles de sesión, cookies, caché y revisión de seguridad  
**Última revisión:** 2026-11-03
**Rama:** `spike-supabase`

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
| Build y despliegue del Worker | **Pasa** en GitHub Actions, head `7da4188681dbe1de39506aeb5a94d77f57dafee9` del PR #1 | El job `deploy` completó correctamente. El workflow está limitado a `kynova-os-preview`; no es un despliegue de producción |
| Prueba de permisos adversariales por API | **Pendiente** | Las capturas prueban lectura aislada; no prueban aquí intentos directos de escritura entre tenants |

En Preview, C conservó la sesión después de recargar `/spike`. Cloudflare Observability mostró **18 éxitos y 0 errores** durante la última hora revisada (3-nov-2026), con solicitudes a `/spike`, `/api/profile` y `/api/spike/items`. Esto cubre A3 para esa ventana, no constituye garantía de ausencia de errores futuros.

Las capturas acreditan el resultado visual de cada cuenta, no la renovación de sesión, atributos de cookies, cabeceras HTTP ni comportamiento tras revocar una sesión.

## Criterios del ADR-0006: estado externo

| Área del ADR-0006 | Estado | Evidencia requerida |
|---|---|---|
| A1. Build y tamaño del Worker | Build **PASS** en Linux CI/Preview; tamaño pendiente | El workflow construye y despliega el Worker; falta registrar tamaño comprimido y contrastarlo con el límite del plan |
| A2. Consulta autenticada en Workers | **PASS en Worker de Preview** | Las sesiones A/B/C mostraron solo sus filas o cero filas para C. `npm run preview` local sigue pendiente para comparar |
| A3. Runtime sin errores | **PASS en la ventana revisada** | Cloudflare Observability mostró 18 éxitos y 0 errores en la última hora (3-nov-2026); revisar de nuevo durante pruebas futuras |
| A4. Secreto ausente del bundle | Parcial | El canario no apareció en los assets estáticos de Next; falta repetir el escaneo sobre los assets del Worker |
| B1. OTP y cookies seguras | OTP en Preview **PASS**, cookies parcial | Falta inspeccionar `HttpOnly`, `Secure` y `SameSite` en el Worker |
| B2. Persistencia de sesión SSR | **PASS para C** | La sesión de C siguió autenticada tras recargar `/spike` en el Worker; no prueba renovación del token (B3) |
| B3. Renovación de sesión | Pendiente | Renovación observada en el runtime de Workers |
| B4. Sesión inválida/cerrada | Pendiente — sin resolver | Falta probar API sin sesión, cookie manipulada y reutilizar un JWT anterior al cierre. Un JWT vigente podría aceptarse hasta caducar; no validado |
| B5. Sin caché compartida | Parcial | Código configura `private, no-store`; falta inspeccionar las cabeceras de respuestas reales en Preview |
| B6. Igualdad local/Preview | Parcial | El Worker de Preview pasó OTP y aislamiento A/B/C; falta ejecutar el mismo flujo en `npm run preview` y comparar |
| RLS y permisos mínimos | **SQL real: PASS (13/13)**; lectura A/B/C en Preview: **PASS** | `verify_project.sql` pasó en el proyecto desechable y A/B/C observaron aislamiento por la API en Preview. Faltan pruebas adversariales de escritura/permisos por API en Workers/Preview |

## Revisión de seguridad del código

| Hallazgo | Estado |
|---|---|
| A1. `getClaims()` puede aceptar un JWT vigente de una sesión revocada | **Pendiente de validar** (comportamiento sin cambios; ver B4 y el README) |
| A4. El `catch` de la página de login capturaba `redirect("/spike")` | Corregido en código; cubierto por prueba local |
| A5. `request.formData()` sin manejo de errores en solicitud y verificación OTP | Corregido en código (400 uniforme); cubierto por prueba local |
| A6. La cookie del correo se borraba con otra ruta | Corregido en código (opciones compartidas) y prueba local |

**Configuración de Auth observada en el dashboard, 2026-11-02 (solo lectura):** límites de Supabase Auth en 30 solicitudes/5 min para inicio de sesión y verificación OTP/enlace, 150 renovaciones/5 min; SMTP personalizado desactivado. CAPTCHA y bloqueo de contraseñas filtradas están desactivados. Estos límites protegen los endpoints de Auth de Supabase; no añaden rate limiting a la aplicación ni sustituyen las cabeceras de seguridad.

Las correcciones no sustituyen las pruebas con Supabase y Workers de la tabla anterior. Siguen pendientes rate limiting a nivel de aplicación, cabeceras de seguridad, confirmar la protección CSRF en Workers y revisar la ubicación de las consultas.

## Decisión provisional

**Go parcial.** El build y el despliegue de Preview, OTP y lectura aislada A/B/C están comprobados. No se declara Go completo: faltan tamaño del Worker, revisión de logs, escaneo del bundle, cookies seguras, persistencia/renovación, B4, cabeceras de caché, comparación con `npm run preview` y pruebas adversariales de permisos. También siguen pendientes la revisión de seguridad y los controles de aplicación anotados abajo.

## Para cerrar el informe

1. Inspeccionar cookies, recarga/persistencia de sesión, renovación, respuesta sin sesión, cookie manipulada y reutilización del JWT tras cerrar sesión en el Worker de Preview; revisar sus logs.
2. Confirmar `Cache-Control` en respuestas con datos y escanear el bundle del Worker para comprobar que no contiene el canario; anotar el tamaño comprimido del Worker.
3. Repetir en `npm run preview` el mismo flujo OTP y A/B/C para cerrar la comparación con el Worker desplegado.
4. Ejecutar pruebas directas de permisos y aislamiento para las mutaciones de la API; completar la revisión de seguridad, incluida protección CSRF y controles de abuso.
5. Recuperar los tipos remotos (`lib/db/database.types.ts`, deuda D31) y tipar después `lib/db/tenancy.ts`.
6. Reemplazar este estado parcial por Go, No-Go o Go con alternativa solo cuando los criterios pendientes tengan evidencia.
