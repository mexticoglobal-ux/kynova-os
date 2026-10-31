# STATE — KYNOVA OS

> Memoria viva del proyecto. Debe caber en una pantalla y reflejar el código real.
> Última actualización: 2026-10-31 · Framework: KAF v1 · Producto: 0.1.0

## 1. Estado actual del proyecto

| Área | Estado |
|------|--------|
| Producto | Demo navegable: landing, pricing, dashboard, NEX simulado, 8 módulos con datos de demostración y 4 páginas "Próximamente"; 8 idiomas (ADR-0004). NEX incluye el Business Assessment v0: autodiagnóstico de 6 preguntas con recomendación de módulos por reglas, solo en memoria y sin guardar nada |
| Framework KAF | v1 cerrado; hooks sin probar en sesión, MCP pendiente y CI preparado para primera ejecución |
| Datos | Núcleo de tenancy **implementado, pendiente de Go** (ADR-0006, fase 1b): migración con RLS y permisos mínimos, `lib/db/tenancy.ts` y `/api/profile` tras el inicio de sesión por código OTP. Sin proyecto Supabase configurado, no aplicado a ningún entorno y sin datos reales; los módulos siguen con datos simulados en `lib/modules/` (ADR-0005) |
| IA | NEX simulado por intención en `lib/nex.ts`; sin proveedor conectado |
| Plataforma | Worker `kynova-os-preview` en `https://kynova-os-preview.novamarketingstudiocr.workers.dev`, versión activa `fadec4a0` (ADR-0002, fases 0–3); producción sin desplegar |
| Repositorio | PR #1 abierto hacia `main`; rama `ci/linux-validation-on-main`; integración de Cloudflare retirada de este repositorio |
| Verificación | GitHub Actions: build de Worker, typecheck, lint, tests y canario; job nuevo "RLS isolation" (Postgres efímero) para la migración de tenancy. El check antiguo de Cloudflare solo persiste en commits anteriores |
| Rendimiento | PageSpeed Insights (2026-10-24), Rendimiento móvil/escritorio: `/` 96/100 · `/dashboard` 100/100 · `/nex` 99/100 · `/sales` 100/100 · `/pricing` 100/100; Accesibilidad, Buenas prácticas y SEO 100; sin datos de uso real |
| Entorno local | Node.js v24.22.1 y npm 11.19.1; Chromium de Playwright instalado; el editor necesita reiniciarse para ver Node en el PATH |

## 2. Arquitectura implementada

| Componente | Estado |
|------------|--------|
| `AGENTS.md`, `CLAUDE.md`, `.claude/` (settings, rules, skills, commands, hooks) | ✅ (hooks sin probar en sesión) |
| `docs/` (STATE, DOMAIN, ADRs 0000–0007, módulos) · `framework/` · `prompts/` | ✅ |
| Base de calidad: ESLint, Prettier, Vitest, Playwright | ✅ |
| Plataforma: `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc`, `public/_headers` | ✅ |
| `lib/i18n/` (8 diccionarios tipados, carga bajo demanda) | ✅ (ADR-0004) |
| `lib/contracts/` (módulo, dashboard) · `lib/modules/` (datos simulados y registro) | ✅ (ADR-0005) |
| SEO: metadatos por ruta, canonical, Open Graph, Twitter, `robots`, `sitemap`, schema.org, favicon, manifest | ✅ |
| `lib/db/` (cliente de usuario, spike y `tenancy.ts`) · `lib/contracts/tenancy.ts` · `middleware.ts` · `supabase/` (migración, seed ficticio, pruebas SQL) | ⚠ Implementado, pendiente de Go (ADR-0006); sin tipos generados (D31) |
| `lib/ai/`, `.mcp.json` | ❌ |
| `.github/workflows/worker-build.yml` · `.github/workflows/rls-isolation.yml` | ✅ Ejecutándose en GitHub Actions |

## 3. Rutas

| Área | Rutas | Estado |
|------|-------|--------|
| Pública | `/`, `/pricing` | Completas |
| Pública "Próximamente" | `/docs`, `/academy`, `/marketplace`, `/contact` | Placeholder con botón Volver |
| App | `/dashboard`, `/nex` | Completas con datos simulados |
| Módulos | `/sales`, `/marketing`, `/clients`, `/properties`, `/automation`, `/finance`, `/analytics`, `/settings` | Vista común con datos simulados |
| API (requiere sesión) | `GET`/`PUT /api/profile` (empresa y perfil del usuario) · spike: `/spike/login`, `/spike`, `/api/spike/*` | Implementadas, pendientes de Go; sin pantalla de perfil (fase 2) |
| Sistema | `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/icon.svg`, `/apple-icon`, `/opengraph-image` | ✅ |

Pendientes de producto: datos reales en todos los módulos; AI Studio sin ruta; Marketplace, Academy y Docs como placeholders.

## 4. Deuda técnica

| # | Deuda | Impacto |
|---|-------|---------|
| D1 | Node.js fuera del PATH de la sesión del editor hasta reiniciarlo | Los hooks no encuentran `node` |
| D4 | Scripts de `.claude/hooks/` sin probar en una sesión con Node en el PATH | Guardas automáticas no verificadas |
| D5 | Sin tests end-to-end escritos (Playwright instalado) | Regresiones de UI sin red de seguridad automatizada |
| D6 | Producción sin desplegar | ADR-0002, fases 4–5 |
| D7 | Autenticación OTP y núcleo de tenancy implementados pero **sin validar**: no hay proyecto Supabase, A1/B4 (JWT vigente tras revocar la sesión) y los criterios A/B del ADR-0006 siguen pendientes; los módulos no leen datos reales | Bloquea datos reales; ningún Go declarado |
| D8 | NEX simulado en cliente; el aviso "Respuesta simulada" se muestra en toda respuesta de NEX (`role === "nex"`), también en conversaciones guardadas | Al conectar un proveedor vía `lib/ai/` y API, marcar cada mensaje como simulado o real y mostrar el aviso solo en los simulados |
| D14 | Tabla de RULES en `CLAUDE.md` §5 no lista `security.md` ni `architecture.md` | Documentación incompleta; la carga por ruta funciona |
| D15 | Código sin formato Prettier | `npm run format:check` y `npm run check` fallan hasta formatear |
| D16 | Definiciones de negocio de `docs/modules/`, planes y comparativa sin validar | Riesgo de construir sobre supuestos |
| D17 | `npm audit`: 19 vulnerabilidades (2 críticas en herramientas de desarrollo); la mayoría exige versión mayor | Riesgo de seguridad |
| D18 | Scripts de instalación de `esbuild`, `unrs-resolver` y `workerd` sin aprobar (`allowScripts`) | Sin impacto observado |
| D19 | OpenNext con compatibilidad parcial en Windows; WSL sin distribución | Builds locales lentos o inestables |
| D20 | `cloudflare-env.d.ts` importa tipos de `.open-next/worker` | `typecheck` en checkout limpio requiere `build:worker` antes |
| D21 | Next.js envía `s-maxage=31536000` en el HTML estático | Revisar antes de asignar dominio (fase 4) |
| D23 | `kynova.ai` fuera de la cuenta de Cloudflare (DNS en GoDaddy); titularidad sin confirmar | Bloquea la fase 4; canonical, sitemap y Open Graph apuntan a ese dominio |
| D24 | i18n en cliente: solo el español es indexable; un idioma guardado distinto muestra español hasta hidratar | Limitación aceptada en ADR-0004 |
| D25 | Testimonios ilustrativos y comparativa con competidores en la landing pública | Requiere revisión legal y de marketing antes de producción |
| D27 | NEX: el scroll automático depende solo de `messages.length` y `busy`; al abrir otra conversación del historial no se desplaza a su último mensaje (preexistente, `/code-review` de `ed96ca0`) | La conversación abierta puede mostrarse a mitad |
| D28 | NEX: `send()` no envuelve `await askNex` en `try/finally` (preexistente, `/code-review` de `ed96ca0`) | Si `askNex` falla, `busy` queda activo y el chat se bloquea; relevante al conectar un proveedor (D8) |
| D29 | El check histórico "Workers Builds: kynova-os" falla en el head `d858741` del PR #1 porque el Worker `kynova-os` no existe; `wrangler.jsonc` conserva `kynova-os-local` como nombre raíz y entornos `kynova-os-preview`/`kynova-os` | Se quitó únicamente `kynova-os` del acceso de la app de Cloudflare Workers and Pages; `casa-glam`, `santa-catalina` y `nova-marketing` siguen conectados. El check rojo ya registrado no cambia, pero la app no debe crear checks ni desplegar este repositorio en commits futuros. GitHub Actions pasa; no se creó Worker ni se desplegó producción |
| D30 | Los módulos del spike conservan su nombre (`lib/db/supabase-spike*.ts`, `lib/contracts/supabase-spike.ts`, rutas `/api/spike/auth/*`) y el nuevo `/api/profile` los reutiliza | Renombrar a nombres de producto cuando haya Go; mientras tanto el código de producto depende de módulos "spike" |
| D31 | `lib/db/database.types.ts` no existe: no hay proyecto Supabase ni CLI/Docker local (D19) para generarlo (`AGENTS.md` §7.3); las filas se validan con parsers de `lib/contracts/tenancy.ts` | Generar los tipos y tiparlos en `lib/db/tenancy.ts` en cuanto exista el proyecto desechable |
| D32 | Hallazgos de `/code-review` aceptados por alcance. **Tenancy:** no hay alta de empresas ni membresías (`authenticated` solo lee y `service_role` no tiene privilegios): hoy es manual desde el editor SQL; país e idioma se validan por forma, no con listas cerradas; el límite de cuerpo se basa solo en `Content-Length`; los workflows corren dos veces por commit (`push` y `pull_request`). **Assessment v0 / NEX:** el foco de teclado se pierde tras responder, la barra de progreso usa estilo inline y no marca el paso actual, `aria-live` anidado y doble clic que puede contestar dos preguntas | Onboarding e invitaciones son parte de la fase 2; los de NEX/Assessment, mejoras de accesibilidad y robustez a abordar con su propia tarea |

Resuelto: **D26** (rendimiento) con `LazyMotion` estricto, entradas y partículas en CSS y LCP sin depender de JS; confirmado por PageSpeed Insights el 2026-10-24 (ver §1).

Hallazgos aceptados de `/code-review` (`ed96ca0`), no son deuda:
- Etiqueta de datos de demostración repetida en `DashboardView`, `ModuleView` y `NexChat`: aceptada para no refactorizar otros componentes; extraer un componente común es una mejora opcional.
- Aviso en cada respuesta de NEX además del aviso del pie: requisito explícito.
- Atributo `data-simulated-notice`: punto de anclaje para verificaciones y futuros tests E2E (D5).

## 5. Trabajo en curso

**ADR-0002 — OpenNext + Cloudflare Workers**
- **Hecho:** fases 0–3; preview desplegado y verificado; proyecto de Pages `kynova-os` eliminado.
- **Pendiente:** fase 4 (dominio y producción); el dominio aún no se ha comprado y no hace falta para desarrollar ni probar la preview.
- **Hecho en fase 5:** README de Workers y CI de GitHub Actions; la integración automática de Cloudflare se retiró solo de este repositorio.
- **Bloqueos para producción:** D21 (caché HTML), D23 (dominio/DNS) y D25 (revisión de marketing y legal).

**ADR-0006 — Datos y tenancy (Supabase + RLS + Auth)** — aceptado, condicionado al Go del spike
- **Hecho:** fase 1b escrita y probada sin credenciales: migración `supabase/migrations/20261031000000_tenancy_core.sql`, pruebas SQL de aislamiento en CI, contratos, `lib/db/tenancy.ts` y `/api/profile` (pruebas unitarias).
- **Pendiente (único paso externo):** aprovisionar el proyecto Supabase desechable (usuarios A/B/C, plantilla OTP, Bloque 0, migración y seed) y poner `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en `.dev.vars`; después generar los tipos (D31) y ejecutar las pruebas manuales del spike, incluidas A1/B4.
- **Siguiente:** Go o No-Go con evidencia (`docs/supabase-spike/RESULTADO.md`); con Go, fase 2 (pantalla de perfil, guardar el Assessment, exportación y borrado).

## 6. Próximos pasos

1. Confirmar `kynova.ai` (D23), decidir la caché del HTML (D21) y ejecutar la fase 4 de ADR-0002 con aprobación.
2. Revisar contenido de landing y pricing con negocio y legal (D16, D25).
3. Escribir tests end-to-end de las rutas y del cambio de idioma (D5); formatear con Prettier (D15).
4. Revisar y fusionar el PR #1 después de la revisión final; Actions está en verde, el fallo de Cloudflare es histórico y no bloquea el código.
5. Aprovisionar el proyecto Supabase desechable y cerrar el spike con Go o No-Go (ADR-0006, D7, D31); después, fase 2: pantalla de perfil y guardar el Assessment.
6. Corregir los seguimientos de NEX (D27, D28) y conectarlo a Workers AI vía `lib/ai/` y AI Gateway, mostrando el aviso solo en respuestas simuladas (D8).
7. Sustituir los datos simulados de los módulos por datos reales, empezando por Clients y Sales.
