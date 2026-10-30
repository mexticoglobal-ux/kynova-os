# Resultado del spike de Supabase

**Estado:** Go parcial local — OTP y aislamiento RLS comprobados; Worker/Preview pendiente  
**Última revisión:** 2026-10-29  
**Rama:** `spike-supabase`

Este informe distingue las comprobaciones locales de las pruebas de integración. Los resultados locales no demuestran compatibilidad con Workers, entrega de correo ni aislamiento real por RLS.

## Evidencia local

| Comprobación | Resultado | Alcance |
|---|---|---|
| ESLint | Pasa sin avisos | Código de la rama aislada |
| TypeScript | Pasa | Código de la rama aislada |
| Vitest | 68/68 antes de las correcciones A4/A5/A6; subconjunto del spike 19/19 antes de los cambios recientes de OTP/cookie. El intento actual no pudo cargar la configuración por el bloqueo de esbuild en Windows | Suite actual pendiente; el fallo ocurrió antes de iniciar pruebas |
| `next build` | Pasa | Build estándar de Next.js; no es el bundle de Workers |
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
| RLS y permisos mínimos | Parcial local | El endpoint aisló A/B y devolvió cero filas a C. Falta repetir V1–V8 y permisos mínimos en Workers/Preview |

## Revisión de seguridad del código

| Hallazgo | Estado |
|---|---|
| A1. `getClaims()` puede aceptar un JWT vigente de una sesión revocada | **Pendiente de validar** (comportamiento sin cambios; ver B4 y el README) |
| A4. El `catch` de la página de login capturaba `redirect("/spike")` | Corregido en código; cubierto por prueba local |
| A5. `request.formData()` sin manejo de errores en solicitud y verificación OTP | Corregido en código (400 uniforme); cubierto por prueba local |
| A6. La cookie del correo se borraba con otra ruta | Corregido en código (opciones compartidas) y prueba local |

Las correcciones no sustituyen las pruebas con Supabase y Workers de la tabla anterior. Siguen fuera de alcance de esta revisión: límites de intentos (rate limiting), cabeceras de seguridad y la ubicación de las consultas.

## Decisión provisional

**Go parcial local.** El OTP real y el aislamiento RLS funcionaron en desarrollo local. No se recomienda aprobar ADR-0006 ni declarar Go completo: faltan build, runtime, renovación, cookies y caché en Workers/Preview. El bloqueo del build observado es del entorno Windows y no demuestra incompatibilidad del producto.

## Para cerrar el informe

1. Proyecto desechable, OTP por correo, SQL ficticio y tres cuentas A/B/C ya preparados y probados localmente.
2. Proyecto y OTP real ya configurados localmente; repetir el flujo con `npm run preview` y confirmar atributos de cookies.
3. Las cuentas A/B/C y las filas ficticias ya están configuradas; completar V1–V8 de permisos en Preview.
4. Las variables locales ya están configuradas; no copiar sus valores a Git ni al chat.
5. Ejecutar el flujo con A, B y C en `npm run preview`; confirmar filas visibles, cookies y encabezados de caché.
6. Conectar el repositorio con GitHub y ejecutar ADR-0007; después completar el runtime de Cloudflare en Preview. Cualquier despliegue remoto requiere autorización expresa y repetir las mismas pruebas en el Worker de Preview.
7. Reemplazar este estado parcial por Go, No-Go o Go con alternativa, citando la evidencia y los riesgos abiertos.
