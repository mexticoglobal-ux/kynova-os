# ADR-0002: Ejecutar y desplegar KYNOVA OS en Cloudflare Workers mediante el adaptador OpenNext

| Campo | Valor |
|-------|-------|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-22 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | plataforma · dependencias |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
KYNOVA OS se construye con Next.js 15 y React 19 y está configurado para desplegarse en Cloudflare Pages con
`@cloudflare/next-on-pages`, adaptador deprecado que solo admite el runtime edge y no da acceso a las APIs de Node.
La arquitectura aprobada sitúa la plataforma en Cloudflare Workers con bindings de AI, AI Gateway, KV, R2 e Hyperdrive,
y las RULES exigen código de servidor compatible con Workers (`.claude/rules/architecture.md`, `.claude/rules/api.md`).

Estado del repositorio analizado el 2026-10-22:

| Aspecto | Estado |
|---------|--------|
| Adaptador | `@cloudflare/next-on-pages` en dependencias y script `pages:build` |
| Rutas con `runtime = "edge"` | Ninguna |
| API, middleware, variables de entorno | Ninguno |
| `next/image`, `public/` | Sin uso / inexistente |
| Rutas | Estáticas (`/`, `/dashboard`, `/robots.txt`, `/sitemap.xml`, 404) y de cliente (`/nex`, `/pricing`) |
| `next.config.js` | CommonJS, solo `reactStrictMode` |
| `wrangler.jsonc`, `open-next.config.ts` | Inexistentes |
| `.gitignore` | Creado en la fase 0 |
| Lockfile | Inexistente |
| Node.js en el entorno local | v24.22.1 y npm 11.19.1 instalados; la sesión del editor no tiene el PATH actualizado |
| `npm install` | Falla (ERESOLVE): `@cloudflare/next-on-pages` arrastra `wrangler` 4 con dependencias de pares incompatibles |
| Versión de Next.js | Rango `^15.0.0`; `@opennextjs/cloudflare` 1.20 exige `>=15.5.28 <16` o `>=16.4.1` |
| `wrangler` 4 | Exige Node.js ≥ 22; `engines` del proyecto declara ≥ 20.9 |
| `kynova-os.zip` | Copia idéntica del commit inicial (20/20 archivos) |
| WSL | Habilitado sin ninguna distribución instalada |
| Proyecto de Pages desplegado | Desconocido |
| Dominio | `kynova.ai` declarado en `config/site.ts` |

## Problema
¿Qué runtime y qué cadena de despliegue usa KYNOVA OS para cumplir la arquitectura aprobada sin depender de un adaptador deprecado?

## Criterios de decisión
- Soporte mantenido para Next.js 15 y sus versiones siguientes.
- Acceso a los bindings de Cloudflare (AI, KV, R2, Hyperdrive) y a las APIs de Node compatibles.
- Coherencia con los ADRs y RULES aprobados.
- Despliegues de preview y producción reproducibles y reversibles.
- Coste y esfuerzo de migración.

## Opciones consideradas

### Opción A: OpenNext (`@opennextjs/cloudflare`) sobre Cloudflare Workers
- **Ventajas:** adaptador mantenido y recomendado por Cloudflare para Next.js; runtime Node con `nodejs_compat`; bindings nativos; assets estáticos servidos por Workers; preview local con el runtime real.
- **Inconvenientes:** límite de tamaño del Worker; caché incremental y optimización de imágenes requieren configuración propia; soporte en Windows limitado.
- **Coste y esfuerzo:** bajo; el repositorio no usa runtime edge, API ni middleware.

### Opción B: Mantener `@cloudflare/next-on-pages`
- **Ventajas:** sin trabajo inmediato.
- **Inconvenientes:** deprecado; solo runtime edge; bloquea la evolución de Next.js y el uso de APIs de Node.
- **Coste y esfuerzo:** nulo hoy, alto cuando haya que migrar con más código.

### Opción C: Plataforma fuera de Cloudflare
- **Ventajas:** soporte nativo de todas las funciones de Next.js.
- **Inconvenientes:** abandona Workers AI, AI Gateway, KV, R2 e Hyperdrive previstos en la arquitectura; añade latencia y coste entre proveedores.
- **Coste y esfuerzo:** alto; exige rediseñar la arquitectura.

## Decisión
Opción A. KYNOVA OS se ejecuta en Cloudflare Workers mediante `@opennextjs/cloudflare`, con `wrangler.jsonc` como fuente
de verdad de la plataforma y entornos separados de preview y producción. Este ADR cubre solo runtime y despliegue; los
bindings de IA, datos y caché se añaden con sus propios ADRs.

## Consecuencias
- **Positivas:** se elimina un adaptador deprecado; se habilitan los bindings necesarios para NEX y datos; preview local fiel a producción.
- **Negativas:** nuevas dependencias de desarrollo (`@opennextjs/cloudflare`, `wrangler`); configuración de plataforma adicional.
- **Riesgos y mitigaciones:**

| Riesgo | Mitigación |
|--------|------------|
| Entorno local sin Node.js en el PATH o con Node.js < 22 | Fase 0 obligatoria antes de cualquier cambio |
| `npm install` bloqueado por el adaptador deprecado | Retirarlo en la fase 0, antes de generar el lockfile |
| Rango de Next.js por debajo del mínimo de OpenNext | Elevar el mínimo en la fase 0 y fijarlo con el lockfile |
| Soporte limitado de OpenNext en Windows | Construir y desplegar desde CI; en local, instalar una distribución de WSL si el build falla |
| Worker por encima del límite de tamaño del plan | Medir el tamaño en fase 1; revisar dependencias de cliente |
| `nodejs_compat` o `compatibility_date` incorrectos rompen el runtime | Fecha de compatibilidad fijada el día de la implementación y verificada en preview |
| Desconocer si existe un proyecto de Pages con dominio | Inventariar antes de la fase 4; no tocar DNS hasta tener producción verificada |
| Futuro uso de `next/image` sin optimizador | Decidir Cloudflare Images o imágenes sin optimizar en el ADR que lo introduzca |
| Caché incremental no configurada | Sin impacto hoy (sin ISR); se decide en el ADR de datos o caché |
| Secretos mal gestionados | `.dev.vars` local no versionado; Wrangler secrets por entorno (`AGENTS.md` §7.6) |

## Impacto en el framework
- **Reglas no negociables (`AGENTS.md` §7) afectadas:** ninguna; refuerza §7.6 y §7.11.
- **RULES afectadas:** ninguna; materializa la compatibilidad con Workers exigida por `architecture` y `api`.
- **Skills afectados:** `kyn-ship` (comandos de preview y despliegue).
- **Módulos afectados:** ninguno.

## Plan de implementación

### Fase 0 — Prerrequisitos (bloqueante)
1. Node.js ≥ 22 disponible en el PATH de la sesión de trabajo (reiniciar el editor tras la instalación).
2. Crear `.gitignore` con dependencias, artefactos de build (`.next`, `.open-next`, `.wrangler`), cobertura, informes de pruebas y `.dev.vars`.
3. Retirar `kynova-os.zip` del repositorio.
4. Retirar `@cloudflare/next-on-pages` y el script `pages:build`: deprecado y bloquea `npm install`.
5. Elevar el mínimo de `next` y `eslint-config-next` a `^15.5.28` y `engines.node` a `>=22`.
6. `npm install` para generar el lockfile; `npm run typecheck` y `npm run build` en verde como línea base.

### Fase 1 — Adaptador
1. Añadir `@opennextjs/cloudflare` y `wrangler` como dependencias de desarrollo.
2. Migrar `next.config.js` a `next.config.ts` e inicializar la integración de desarrollo de OpenNext.
3. Crear `open-next.config.ts` con la configuración mínima.
4. Sustituir el script `pages:build` por scripts de `preview`, `deploy` y generación de tipos de entorno.
5. Verificar: `npm run check` y build de OpenNext en verde; tamaño del Worker registrado.

### Fase 2 — Plataforma
1. Crear `wrangler.jsonc`: nombre del Worker, punto de entrada y assets de OpenNext, `compatibility_date` del día, `nodejs_compat`, observabilidad activada.
2. Definir entornos `preview` y `production` sin bindings de producto.
3. Generar los tipos de entorno de Cloudflare.
4. Crear `public/_headers` con caché inmutable para assets versionados.
5. Verificar: preview local con el runtime de Workers; todas las rutas responden igual que con `next dev`.

### Fase 3 — Preview remoto
1. Confirmar acceso a la cuenta de Cloudflare e inventariar si existe un proyecto de Pages y a qué dominio sirve.
2. Desplegar el entorno `preview` con aprobación (`AGENTS.md` §7.11).
3. Ejecutar las pruebas end-to-end contra la URL de preview (`E2E_BASE_URL`).
4. Verificar rutas, 404, `robots.txt`, `sitemap.xml` y metadatos.

### Fase 4 — Producción
1. Desplegar el entorno `production` con aprobación.
2. Asignar el dominio `kynova.ai` al Worker; si existía un proyecto de Pages, retirarle el dominio solo tras verificar producción.
3. Verificación posterior según `framework/workflows/release.md`.

### Fase 5 — Automatización y limpieza
1. Validar calidad y build del Worker en CI según ADR-0007. El workflow no despliega; cualquier despliegue de Preview o producción requiere su autorización correspondiente.
2. Actualizar `README.md` con los comandos de desarrollo, preview y despliegue.
3. Retirar el proyecto de Pages, si existía, tras un periodo de estabilidad.
4. Marcar este ADR como Aceptado e implementado en `docs/STATE.md`.

## Plan de reversión
- Fases 0–2: revertir los commits; nada está desplegado.
- Fases 3–4: el proyecto de Pages, si existe, conserva su dominio hasta verificar producción; revertir supone reasignar el dominio.
- A partir de la retirada del proyecto de Pages, revertir exige volver a desplegar con el adaptador anterior: deja de ser una reversión barata.

## Verificación
- `npm run check` y el build de OpenNext en verde.
- Preview local y remoto sirven todas las rutas actuales con el mismo contenido.
- Pruebas end-to-end en verde contra preview y producción.
- `@cloudflare/next-on-pages` no aparece en `package.json` ni en el lockfile.
- `kynova.ai` servido por el Worker de producción.

## Revisión
Al introducir el primer binding de producto (AI, KV, R2 o Hyperdrive) o al actualizar a una nueva versión mayor de Next.js.

## Referencias
- `.claude/rules/architecture.md`, `.claude/rules/api.md`
- `framework/workflows/release.md`
- `docs/decisions/0001-crear-carpeta-framework.md`
