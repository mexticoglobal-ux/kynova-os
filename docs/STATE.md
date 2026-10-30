# STATE — KYNOVA OS

> Memoria viva del proyecto. Debe caber en una pantalla y reflejar el código real.
> Última actualización: 2026-10-24 · Framework: KAF v1 · Producto: 0.1.0

## 1. Estado actual del proyecto

| Área | Estado |
|------|--------|
| Producto | Demo navegable: landing, pricing, dashboard, NEX simulado, 8 módulos con datos de demostración y 4 páginas "Próximamente"; 8 idiomas (ADR-0004). NEX incluye el Business Assessment v0: autodiagnóstico de 6 preguntas con recomendación de módulos por reglas, solo en memoria y sin guardar nada |
| Framework KAF | v1 cerrado; hooks sin probar en sesión, MCP pendiente y CI preparado para primera ejecución |
| Datos | Sin base de datos, autenticación ni tenancy; datos simulados en `lib/modules/` (ADR-0005) |
| IA | NEX simulado por intención en `lib/nex.ts`; sin proveedor conectado |
| Plataforma | Worker `kynova-os-preview` en `https://kynova-os-preview.novamarketingstudiocr.workers.dev`, versión activa `fadec4a0` (ADR-0002, fases 0–3); producción sin desplegar |
| Repositorio | Rama local `sprint-4`: `55b93b4` (KAF v1 + Sprint 4) y `ed96ca0` (código del Preview `fadec4a0`); sin push |
| Verificación | `typecheck` ✅ · `lint` ✅ (0 avisos) · `test` ✅ (36) · `build` ✅ (23 rutas estáticas) · workflow de CI configurado localmente; ejecución en GitHub pendiente |
| Rendimiento | PageSpeed Insights (2026-10-24), Rendimiento móvil/escritorio: `/` 96/100 · `/dashboard` 100/100 · `/nex` 99/100 · `/sales` 100/100 · `/pricing` 100/100; Accesibilidad, Buenas prácticas y SEO 100; sin datos de uso real |
| Entorno local | Node.js v24.22.1 y npm 11.19.1; Chromium de Playwright instalado; el editor necesita reiniciarse para ver Node en el PATH |

## 2. Arquitectura implementada

| Componente | Estado |
|------------|--------|
| `AGENTS.md`, `CLAUDE.md`, `.claude/` (settings, rules, skills, commands, hooks) | ✅ (hooks sin probar en sesión) |
| `docs/` (STATE, DOMAIN, ADRs 0000–0005, módulos) · `framework/` · `prompts/` | ✅ |
| Base de calidad: ESLint, Prettier, Vitest, Playwright | ✅ |
| Plataforma: `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc`, `public/_headers` | ✅ |
| `lib/i18n/` (8 diccionarios tipados, carga bajo demanda) | ✅ (ADR-0004) |
| `lib/contracts/` (módulo, dashboard) · `lib/modules/` (datos simulados y registro) | ✅ (ADR-0005) |
| SEO: metadatos por ruta, canonical, Open Graph, Twitter, `robots`, `sitemap`, schema.org, favicon, manifest | ✅ |
| `lib/db/`, `lib/ai/`, `supabase/`, `.mcp.json` | ❌ |
| `.github/workflows/worker-build.yml` | ⚠ CI preparado; pendiente de conectar el checkout con GitHub y ejecutarlo |

## 3. Rutas

| Área | Rutas | Estado |
|------|-------|--------|
| Pública | `/`, `/pricing` | Completas |
| Pública "Próximamente" | `/docs`, `/academy`, `/marketplace`, `/contact` | Placeholder con botón Volver |
| App | `/dashboard`, `/nex` | Completas con datos simulados |
| Módulos | `/sales`, `/marketing`, `/clients`, `/properties`, `/automation`, `/finance`, `/analytics`, `/settings` | Vista común con datos simulados |
| Sistema | `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/icon.svg`, `/apple-icon`, `/opengraph-image` | ✅ |

Pendientes de producto: datos reales en todos los módulos; AI Studio sin ruta; Marketplace, Academy y Docs como placeholders.

## 4. Deuda técnica

| # | Deuda | Impacto |
|---|-------|---------|
| D1 | Node.js fuera del PATH de la sesión del editor hasta reiniciarlo | Los hooks no encuentran `node` |
| D4 | Scripts de `.claude/hooks/` sin probar en una sesión con Node en el PATH | Guardas automáticas no verificadas |
| D5 | Sin tests end-to-end escritos (Playwright instalado) | Regresiones de UI sin red de seguridad automatizada |
| D6 | Producción sin desplegar | ADR-0002, fases 4–5 |
| D7 | Sin autenticación, tenancy ni capa de datos | Bloquea datos reales en módulos |
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
| D29 | El check externo "Workers Builds: kynova-os" (app de Cloudflare conectada al repositorio) falla en el PR #1 con "Preview creation failed: This Worker does not exist on your account"; apunta al Worker `kynova-os` en producción, que no figura en la cuenta, y `wrangler.jsonc` usa `kynova-os-local` como nombre raíz (los entornos son `kynova-os-preview` y `kynova-os`). Causa exacta sin confirmar: requiere el panel de Cloudflare | No es un fallo del código: GitHub Actions pasa. Se resuelve solo en la cuenta (desactivar *Enable Preview Builds* en Settings › Build › Branch control, o reconectar el repositorio a un Worker existente). Antes de fusionar a `main` con la integración activa, revisar su comando de deploy (AGENTS.md §7.11) |

Resuelto: **D26** (rendimiento) con `LazyMotion` estricto, entradas y partículas en CSS y LCP sin depender de JS; confirmado por PageSpeed Insights el 2026-10-24 (ver §1).

Hallazgos aceptados de `/code-review` (`ed96ca0`), no son deuda:
- Etiqueta de datos de demostración repetida en `DashboardView`, `ModuleView` y `NexChat`: aceptada para no refactorizar otros componentes; extraer un componente común es una mejora opcional.
- Aviso en cada respuesta de NEX además del aviso del pie: requisito explícito.
- Atributo `data-simulated-notice`: punto de anclaje para verificaciones y futuros tests E2E (D5).

## 5. Trabajo en curso

**ADR-0002 — OpenNext + Cloudflare Workers**
- **Hecho:** fases 0–3; preview desplegado y verificado; proyecto de Pages `kynova-os` eliminado.
- **Pendiente:** fase 4 (dominio y producción) y fase 5 (CI, README, limpieza).
- **Bloqueos:** D23 y D21.
- **Siguiente paso:** confirmar la titularidad de `kynova.ai`.

## 6. Próximos pasos

1. Confirmar `kynova.ai` (D23), decidir la caché del HTML (D21) y ejecutar la fase 4 de ADR-0002 con aprobación.
2. Revisar contenido de landing y pricing con negocio y legal (D16, D25).
3. Escribir tests end-to-end de las rutas y del cambio de idioma (D5); formatear con Prettier (D15).
4. Conectar el repositorio a GitHub y ejecutar el workflow de CI del ADR-0007; el checkout actual tiene un `origin` local y todavía no se ha confirmado una ejecución de GitHub Actions (D20).
5. Registrar ADR-0006 datos y tenancy (Supabase + RLS) e implementar `lib/db/` y autenticación (D7); requisito también para guardar o reutilizar el Business Assessment y crear un perfil de empresa.
6. Corregir los seguimientos de NEX (D27, D28) y conectarlo a Workers AI vía `lib/ai/` y AI Gateway, mostrando el aviso solo en respuestas simuladas (D8).
7. Sustituir los datos simulados de los módulos por datos reales, empezando por Clients y Sales.
