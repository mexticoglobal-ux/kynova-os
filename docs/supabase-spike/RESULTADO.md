# Resultado del spike de Supabase

**Estado:** Go parcial local — OTP y aislamiento RLS comprobados; Worker/Preview pendiente  
**Última revisión:** 2026-10-31
**Rama:** `spike-supabase`

Este informe distingue las comprobaciones locales de las pruebas de integración. Los resultados locales no demuestran compatibilidad con Workers, entrega de correo ni aislamiento real por RLS.

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

## Criterios externos pendientes

| Área del ADR-0006 | Estado | Evidencia requerida |
|---|---|---|
| A1. Build y tamaño del Worker | Pendiente | Ejecutar el workflow Linux de ADR-0007; luego medir tamaño comprimido |
| A2. Consulta autenticada en Workers | Pendiente | Endpoint ejecutado en `npm run preview` y en el Worker de Preview |
| A3. Runtime sin errores | Pendiente | Logs de ejecución del Worker durante las pruebas |
| A4. Secreto ausente del bundle | Parcial | El canario no apareció en los assets estáticos de Next; repetir sobre los assets del Worker |
| B1. OTP y cookies seguras | Parcial | OTP real y sesión local pasan; falta inspeccionar `HttpOnly`, `Secure` y `SameSite` en el Worker |
| B2. Persistencia de sesión SSR | Parcial | Recarga autenticada pasa en desarrollo local; falta repetir en `preview`/Worker |
| B3. Renovación de sesión | Pendiente | Renovación observada en el runtime de Workers |
| B4. Sesión inválida/cerrada | Parcial — sin resolver | Cierre local redirige a `signed_out`; falta probar API sin sesión, cookie manipulada y reutilizar un JWT anterior al cierre. Un JWT vigente podría aceptarse hasta caducar; no validado |
| B5. Sin caché compartida | Parcial | Código y build local configuran `private, no-store`; confirmar encabezados en `preview` y Worker |
| B6. Igualdad local/Preview | Pendiente | Repetir el mismo flujo en `npm run preview` y en el Worker de Preview |
| RLS y permisos mínimos | **SQL real: PASS (13/13)**; API: parcial local | `verify_project.sql` pasó en el proyecto desechable. El endpoint local aisló A/B y devolvió cero filas a C. Falta repetir el flujo de Auth y V1–V8 en Workers/Preview |

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

**Go parcial local.** El OTP real y el aislamiento RLS funcionaron en desarrollo local. No se recomienda aprobar ADR-0006 ni declarar Go completo: faltan build, runtime, renovación, cookies y caché en Workers/Preview. El bloqueo del build observado es del entorno Windows y no demuestra incompatibilidad del producto.

## Para cerrar el informe

1. Configurar SMTP propio en Authentication › SMTP Settings para que Supabase envíe enlaces a las cuentas A/B/C.
2. Recuperar desde el generador oficial del dashboard `lib/db/database.types.ts` o resolver el error de transporte de la CLI; tipar después `lib/db/tenancy.ts`.
3. Completar Auth A/B/C, cookies y B4; después repetir RLS y cabeceras en Preview/Workers.
4. Mantener `.dev.vars` fuera de Git y del chat; documentar si las variables locales temporales se sustituyen por configuración local persistente.
5. Reemplazar este estado parcial por Go, No-Go o Go con alternativa, citando la evidencia y los riesgos abiertos.
