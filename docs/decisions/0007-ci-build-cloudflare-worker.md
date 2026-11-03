# ADR-0007: Validar el build del Worker de Cloudflare en GitHub Actions

| Campo | Valor |
|-------|-------|
| **Estado** | Aceptado para el spike |
| **Fecha** | 2026-10-29 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | CI · plataforma · seguridad |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto

OpenNext no garantiza compatibilidad completa con Windows. En este entorno, esbuild no puede leer un directorio padre del checkout, así que el build del Worker se detiene antes de validar la aplicación. El proyecto requiere Node.js 22 o posterior y `npm ci` puede reconstruir las dependencias desde el lockfile.

El spike de Supabase aún debe validar el build y el runtime de Workers. La prueba local de OTP y aislamiento A/B/C ya pasó, pero no sustituye esa comprobación.

## Decisión

Ejecutar en GitHub Actions sobre Ubuntu el typecheck, lint, formato, pruebas existentes y build de OpenNext para el entorno `preview`. Después, ejecutar `wrangler deploy --dry-run --outdir .wrangler/spike-worker-dry-run --env preview`: compila el Worker localmente, informa el tamaño de carga y deja el bundle generado para inspeccionarlo, sin desplegarlo. El escaneo de la canaria cubre tanto los assets del navegador como ese bundle. El flujo se activa en pushes, pull requests y manualmente.

El workflow usa solo valores ficticios de CI. El dry run de Wrangler no usa credenciales reales de Supabase ni Cloudflare, no sube artefactos ni despliega Workers; el tamaño se informa en el log de Actions. El escaneo comprueba que la canaria no llega a assets del navegador ni al bundle generado del Worker. La validación del runtime local con `npm run preview` y cualquier Preview remoto se mantienen como pasos separados.

## Consecuencias

- El build se ejecuta en Linux, el entorno recomendado por OpenNext cuando Windows presenta problemas.
- GitHub muestra una señal repetible de calidad en cada cambio.
- El CI no comprueba cookies reales ni consultas a Supabase; esos criterios siguen requiriendo las pruebas manuales del spike.
- Para ejecutar el workflow, el código debe estar en un repositorio GitHub conectado.

## Verificación

El workflow se considera validado cuando GitHub Actions termina en verde con todos los pasos configurados, incluidos el build de OpenNext, la compilación seca de Wrangler para `preview` y el escaneo de la canaria en los assets del navegador y el bundle del Worker. Esto no autoriza ni realiza despliegues.
