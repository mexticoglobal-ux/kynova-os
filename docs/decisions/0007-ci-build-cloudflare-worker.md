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

Ejecutar en GitHub Actions sobre Ubuntu el typecheck, lint, formato, pruebas existentes, build de OpenNext para el entorno `preview` y escaneo de la canaria de prueba. El flujo se activa en pushes, pull requests y manualmente.

El workflow usa solo valores ficticios de CI para compilar y comprobar que la canaria no llega a assets del navegador. No usa credenciales reales de Supabase ni de Cloudflare, no sube artefactos y no despliega Workers. La validación del runtime local con `npm run preview` y cualquier Preview remoto se mantienen como pasos separados.

## Consecuencias

- El build se ejecuta en Linux, el entorno recomendado por OpenNext cuando Windows presenta problemas.
- GitHub muestra una señal repetible de calidad en cada cambio.
- El CI no comprueba cookies reales ni consultas a Supabase; esos criterios siguen requiriendo las pruebas manuales del spike.
- Para ejecutar el workflow, el código debe estar en un repositorio GitHub conectado.

## Verificación

El workflow se considera validado cuando GitHub Actions termina en verde con todos los pasos configurados, incluido el build de OpenNext y el escaneo de la canaria. Esto no autoriza ni realiza despliegues.
