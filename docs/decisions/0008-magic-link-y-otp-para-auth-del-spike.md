# ADR-0008 — Aceptar enlace mágico y código en el spike de Auth

- **Estado:** Aceptado
- **Fecha:** 2026-10-31
- **Contexto:** El proyecto Supabase desechable usa la plantilla de correo Magic Link predeterminada, pero el formulario del spike solo acepta un código OTP. La plantilla no se puede editar sin configurar SMTP propio. Se necesita continuar las pruebas reales sin introducir una dependencia de proveedor de correo.

## Decisión

El spike admitirá ambos métodos de entrada que Supabase puede enviar desde `signInWithOtp`: el formulario existente para códigos de 6–10 dígitos y un callback SSR para enlaces mágicos mediante PKCE. La solicitud incluirá una URL de retorno fija de la aplicación; el callback intercambiará el código PKCE con `exchangeCodeForSession`, escribirá la sesión en cookies seguras y redirigirá a `/spike`. No se permitirá un destino de retorno proporcionado por el usuario.

**Origen de confianza (dos capas independientes).** `request.url` se deriva de cabeceras, así que no se usa tal cual para construir `emailRedirectTo`:
1. **En la aplicación:** `spikeCallbackUrl` (`lib/db/supabase-spike-config.ts`) solo devuelve el callback si el origen de la petición está en `SPIKE_ALLOWED_ORIGINS`: `http://localhost:3000` (`next dev`), `http://localhost:8787` (`npm run preview`) y el Worker de Preview `https://kynova-os-preview.novamarketingstudiocr.workers.dev`. Cualquier otro origen recibe `403 origin_not_allowed` y no se envía ningún correo. La lista no incluye producción.
2. **En Supabase:** la lista de Redirect URLs, que debe contener el callback de esos mismos orígenes.

Añadir un origen exige cambiar ambas listas. Los navegadores locales usan `localhost`, nunca `127.0.0.1`: Next resuelve `request.url` a `localhost`, de modo que la cabecera `Origin` de `127.0.0.1` no coincide y el enlace del correo se abriría en otro host que la cookie del verificador PKCE.

El alta seguirá desactivada (`shouldCreateUser: false`) y se mantendrán las cuentas de prueba ya creadas. SMTP y cambios en la plantilla quedan opcionales para este spike.

## Consecuencias

- Se puede probar el flujo con la plantilla predeterminada, sin aprovisionar SMTP.
- El usuario debe abrir el enlace en el mismo navegador/perfil donde pidió el correo para conservar el verificador PKCE.
- La URL del callback debe estar en la lista permitida de Redirect URLs de Supabase **y** en `SPIKE_ALLOWED_ORIGINS` para cada origen de prueba; si falta en cualquiera, el enlace no funciona o la solicitud se rechaza.
- El OTP continúa como alternativa cuando el template entregue un código.

## Reversión

Retirar el callback y `emailRedirectTo` restaura el comportamiento previo. No hay cambio de esquema ni migración de datos.

## Verificación requerida

Pruebas automáticas (hechas): callback con code ausente, intercambio fallido, excepción y proyecto sin configurar; éxito con cookies de sesión `HttpOnly`/`SameSite=Lax`/`Path=/` y cookie temporal del correo limpiada con su misma ruta; `emailRedirectTo` fijo por origen permitido, ignorando cualquier destino enviado por el usuario; origen no permitido rechazado sin enviar correo.

Pruebas manuales (pendientes): un inicio real con una cuenta de prueba en `localhost` y en el Preview, confirmar cookie y sesión, y repetir A/B/C y A1/B4. El atributo `Secure` solo es observable en HTTPS. Esto no autoriza a declarar Go ni a desplegar producción.
