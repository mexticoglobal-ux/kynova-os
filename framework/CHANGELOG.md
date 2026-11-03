# CHANGELOG — KYNOVA AI Framework (KAF)

Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) · Versionado: [SemVer](https://semver.org/lang/es/).
Cada versión publicada se etiqueta en git como `kaf-vX.Y.Z`.

| Tipo de cambio | Versión |
|----------------|---------|
| Cambia la estructura, elimina un componente o rompe un contrato entre componentes | MAJOR |
| Añade un componente (regla, Skill, agente, workflow, estándar, plantilla) | MINOR |
| Corrige o aclara el contenido sin cambiar su comportamiento | PATCH |

## [Unreleased]

### Sprint 4 (producto)
- ADR-0004 (i18n en cliente, 8 idiomas) y ADR-0005 (patrón de módulo) aceptados.
- Rutas nuevas: 8 módulos con vista común, `/docs`, `/academy`, `/marketplace`, `/contact` ("Próximamente"); grupos de rutas `(public)` y `(app)`.
- Dashboard, NEX (historial, sugerencias, acciones rápidas, ejemplos), landing y pricing rediseñados; navegación móvil; botón Volver en páginas públicas.
- SEO: metadatos por ruta, canonical, Open Graph, Twitter, schema.org, favicon, apple-icon, manifest.
- Tests: paridad de diccionarios, enrutado de NEX y registro de módulos (36 tests).
- Imágenes Open Graph y Apple como PNG estáticos (sin `next/og` en el Worker: 1 836 → 1 327 KiB gzip); token `danger.soft` para contraste AA.
- Rendimiento: `framer-motion` con `LazyMotion` estricto (`m.*`), animaciones de entrada y partículas en CSS, LCP sin depender de la hidratación (JS inicial −35 KB por ruta); token `primary.soft` para contraste AA.

### Added
- `.claude/hooks/`: `session-context`, `guard-architecture`, `verify`, `memory-reminder`.
- Base de calidad: `eslint.config.mjs` (incluye la restricción de SDKs de IA de `AGENTS.md` §7.2), `.prettierrc.json`, `.prettierignore`, `vitest.config.mts`, `vitest.setup.ts`, `playwright.config.ts`.
- Scripts de `package.json`: `start`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test`, `test:watch`, `test:coverage`, `test:e2e`, `test:e2e:install`, `check`.

- `.claude/commands/`: `/kyn-status`, `/kyn-brief`, `/kyn-adr`, `/kyn-handoff`.
- `prompts/`: convenciones y plantilla de prompts de NEX; `prompts/evals/`: formato de suites, especificación del runner y plantilla (ADR-0003).
- `docs/decisions/0003-carpeta-prompts-y-evals-de-nex.md`.
- `docs/modules/`: índice y referencia de negocio de Dashboard, NEX, Sales, Clients, Marketing, Properties, Finance, Automation, Analytics, Settings, AI Studio, Marketplace y Academy.

### Changed
- ADR-0002, fase 3 completada: proyecto de Pages `kynova-os` eliminado (riesgo D22); Worker `kynova-os-preview` desplegado en `kynova-os-preview.novamarketingstudiocr.workers.dev` (4 584 KiB / 940 KiB gzip, arranque 12 ms); verificación remota de rutas, assets, cabeceras y logs sin errores.
- ADR-0002, fase 3 (parcial): `build:worker`, `preview`, `deploy` y `upload` fijan `--env preview`; nuevo `deploy:production` con confirmación obligatoria `KYNOVA_CONFIRM_PRODUCTION=kynova-os`; configuración raíz de `wrangler.jsonc` renombrada a `kynova-os-local`; `cloudflare-env.d.ts` regenerado. Despliegue remoto pendiente de `wrangler login`.
- ADR-0002, fase 2 completada: `wrangler.jsonc` con entornos `preview` y `production`, `nodejs_compat` y `observability`; `public/_headers` con caché inmutable para `/_next/static/*`; `.dev.vars.example`; `cloudflare-env.d.ts` generado con `npm run cf-typegen`. `npm run preview` verificado en el runtime local de Workers.
- ADR-0002, fase 1 completada: `@opennextjs/cloudflare` (dependencia) y `wrangler` (desarrollo); `next.config.js` migrado a `next.config.ts` con `initOpenNextCloudflareForDev`; `open-next.config.ts` mínimo sin caché incremental; scripts `build:worker`, `preview`, `deploy`, `upload` y `cf-typegen`. Build de OpenNext en verde; Worker de 0,92 MiB gzip.
- ADR-0002 aceptado; fase 0 completada con typecheck y build en verde. Corregidos los errores de lint que bloqueaban el build: apóstrofos escapados en `app/dashboard/page.tsx` y `app/not-found.tsx`, parámetro `_history` en `lib/nex.ts`.
- ADR-0002, fase 0: `kynova-os.zip` eliminado del repositorio; `package-lock.json` generado (546 paquetes, sin conflictos); `tsconfig.json` normalizado por Next.js (`allowJs`, `resolveJsonModule`, `isolatedModules`).
- `package.json` (ADR-0002, fase 0): retirados `@cloudflare/next-on-pages` y el script `pages:build`; `next` y `eslint-config-next` a `^15.5.28`; `engines.node` a `>=22`.
- `CLAUDE.md` §10: referencia a `.claude/commands/`.
- `docs/DOMAIN.md`: delimita los conceptos transversales frente a las entidades propias de cada módulo.
- `.claude/rules/` `ui`, `api`, `ai`, `data`: eliminado el contenido que repetía `AGENTS.md` y `CLAUDE.md`; añadidas referencias.
- `framework/workflows/`: los pasos de la fase Brain, los gates, la verificación y la aprobación en producción se referencian en `AGENTS.md` y `CLAUDE.md` en lugar de repetirse.
- `framework/standards/` `architecture`, `ai`, `ui`, `documentation`: eliminado el contenido que repetía RULES o `AGENTS.md`; se conserva solo lo complementario.
- `framework/REGISTRY.md`: la tabla de RULES muestra el dominio en lugar de copiar las rutas de activación; `ui`, `api`, `ai` y `data` pasan a 1.1.0.

## [1.0.0] — 2026-10-22

### Added
- `AGENTS.md`: identidad, misión, principios, flujo Brain, clasificación S/M/L, roles y reglas no negociables.
- `CLAUDE.md`: integración con Claude Code, orden de lectura y mapa de roles a herramientas.
- `.claude/settings.json`: permisos, exclusiones de lectura, hooks, modelo y servidores MCP habilitados.
- `.claude/rules/`: `ui`, `api`, `ai`, `data`, `security`, `architecture`.
- `.claude/skills/`: `kyn-data`, `kyn-ai`, `kyn-module`, `kyn-ship`.
- `docs/`: `STATE.md`, `DOMAIN.md`, `decisions/0000-template.md`.
- `framework/`: `VERSION`, `CHANGELOG.md`, `REGISTRY.md`.
- `framework/workflows/`: `feature`, `bugfix`, `release`, `incident`.
- `framework/standards/`: `coding`, `ui`, `architecture`, `ai`, `security`, `data`, `performance`, `documentation`.
- `framework/templates/`: `adr`, `pr`, `module`, `page`, `handoff`, `skill`, `agent`.
