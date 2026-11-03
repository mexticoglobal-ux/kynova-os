# REGISTRY — KYNOVA AI Framework (KAF)

> Catálogo maestro de componentes del framework. Todo componente en uso figura aquí.
> Versión del framework: ver `framework/VERSION`. Historial: ver `framework/CHANGELOG.md`.

## Estados

| Estado | Significado |
|--------|-------------|
| `experimental` | En prueba; puede cambiar sin aviso |
| `stable` | En uso; los cambios siguen SemVer |
| `deprecated` | Se mantiene durante una versión MINOR; indica su reemplazo |
| `removed` | Eliminado; se conserva la fila como historial |

## Núcleo

| Componente | Ubicación | Versión | Estado | Propósito |
|------------|-----------|---------|--------|-----------|
| AGENTS | `AGENTS.md` | 1.0.0 | stable | Fuente única de reglas, flujo, clasificación y roles |
| CLAUDE | `CLAUDE.md` | 1.0.0 | stable | Integración con Claude Code |
| Settings | `.claude/settings.json` | 1.0.0 | stable | Permisos, hooks, modelo y MCP |

## Hooks

| Hook | Ubicación | Evento | Versión | Estado | Propósito |
|------|-----------|--------|---------|--------|-----------|
| session-context | `.claude/hooks/session-context.mjs` | SessionStart | 1.1.0 | experimental | Inyecta rama y trabajo en curso |
| guard-architecture | `.claude/hooks/guard-architecture.mjs` | PreToolUse | 1.1.0 | experimental | Bloquea SDKs de IA fuera de `lib/ai/` y migraciones sin ADR |
| verify | `.claude/hooks/verify.mjs` | PostToolUse | 1.1.0 | experimental | Typecheck y lint tras editar código |
| memory-reminder | `.claude/hooks/memory-reminder.mjs` | Stop | 1.1.0 | experimental | Recuerda actualizar `docs/STATE.md` |

## Base de calidad

| Herramienta | Configuración | Script | Versión | Estado |
|-------------|---------------|--------|---------|--------|
| TypeScript | `tsconfig.json` | `npm run typecheck` | 1.1.0 | experimental |
| ESLint | `eslint.config.mjs` | `npm run lint` | 1.1.0 | experimental |
| Prettier | `.prettierrc.json`, `.prettierignore` | `npm run format:check` | 1.1.0 | experimental |
| Vitest | `vitest.config.mts`, `vitest.setup.ts` | `npm run test` | 1.1.0 | experimental |
| Playwright | `playwright.config.ts` | `npm run test:e2e` | 1.1.0 | experimental |
| Verificación completa | `package.json` | `npm run check` | 1.1.0 | experimental |

Requisito de entorno: Node.js ≥ 22 (`engines` de `package.json`).

## Plataforma (ADR-0002)

| Herramienta | Configuración | Script | Estado |
|-------------|---------------|--------|--------|
| OpenNext para Cloudflare | `open-next.config.ts`, `next.config.ts` | `npm run build:worker` | experimental · verificado |
| Configuración de plataforma | `wrangler.jsonc` (raíz `kynova-os-local`, `preview`, `production`) | — | experimental · verificado en local |
| Preview en runtime de Workers | `wrangler.jsonc`, `public/_headers` | `npm run preview` (entorno `preview`) | experimental · verificado |
| Despliegue a preview | `wrangler.jsonc` | `npm run deploy`, `npm run upload` (entorno `preview`) | experimental · verificado (`kynova-os-preview`, 2026-10-23) |
| Despliegue a producción | `wrangler.jsonc` | `npm run deploy:production` con `KYNOVA_CONFIRM_PRODUCTION=kynova-os` | experimental · bloqueo verificado; despliegue sin probar |
| Tipos de bindings | `cloudflare-env.d.ts` | `npm run cf-typegen` | experimental · verificado |
| Variables locales | `.dev.vars.example` → `.dev.vars` (no versionado) | — | experimental |

Línea base (2026-10-22): `typecheck` ✅ · `build` ✅ (incluye el lint de Next.js) · `lint`, `format:check`, `test` y `test:e2e` sin ejecutar.

## Rules

| Regla | Ubicación | Versión | Estado | Dominio |
|-------|-----------|---------|--------|---------|
| ui | `.claude/rules/ui.md` | 1.1.0 | stable | Interfaz |
| api | `.claude/rules/api.md` | 1.1.0 | stable | API |
| ai | `.claude/rules/ai.md` | 1.1.0 | stable | IA |
| data | `.claude/rules/data.md` | 1.1.0 | stable | Datos |
| security | `.claude/rules/security.md` | 1.0.0 | stable | Seguridad |
| architecture | `.claude/rules/architecture.md` | 1.0.0 | stable | Arquitectura |

Rutas de activación: frontmatter `paths` de cada regla.

## Skills

| Skill | Ubicación | Versión | Estado | Dominio | Depende de |
|-------|-----------|---------|--------|---------|------------|
| kyn-data | `.claude/skills/kyn-data/` | 1.0.0 | stable | Esquema, migraciones, RLS, tipos | — |
| kyn-ai | `.claude/skills/kyn-ai/` | 1.0.0 | stable | NEX, prompts, proveedores, evals | — |
| kyn-module | `.claude/skills/kyn-module/` | 1.0.0 | stable | Módulos de negocio de punta a punta | kyn-data, kyn-ai |
| kyn-ship | `.claude/skills/kyn-ship/` | 1.0.0 | stable | Cierre, memoria, commit, PR, deploy | — |

Dirección permitida: `kyn-module` → `kyn-data` / `kyn-ai`; todos → `kyn-ship`. Sin ciclos.

## Comandos

| Comando | Ubicación | Versión | Estado | Propósito | Edita |
|---------|-----------|---------|--------|-----------|-------|
| `/kyn-status` | `.claude/commands/kyn-status.md` | 1.1.0 | experimental | Estado, trabajo en curso y siguiente paso | Nada |
| `/kyn-brief` | `.claude/commands/kyn-brief.md` | 1.1.0 | experimental | Fase Brain y brief de una tarea | Nada |
| `/kyn-adr` | `.claude/commands/kyn-adr.md` | 1.1.0 | experimental | ADR nuevo en estado Propuesto | `docs/decisions/` |
| `/kyn-handoff` | `.claude/commands/kyn-handoff.md` | 1.1.0 | experimental | Registro de una tarea interrumpida | `docs/STATE.md` |

Los Skills se invocan además como `/kyn-data`, `/kyn-ai`, `/kyn-module` y `/kyn-ship`; ningún comando duplica un Skill.

## Prompts y evals de NEX

| Componente | Ubicación | Versión | Estado |
|------------|-----------|---------|--------|
| Convenciones de prompts | `prompts/README.md` | 1.1.0 | experimental |
| Plantilla de prompt | `prompts/_template.md` | 1.1.0 | experimental |
| Formato de evals y runner | `prompts/evals/README.md` | 1.1.0 | experimental |
| Plantilla de suite | `prompts/evals/_template.yaml` | 1.1.0 | experimental |
| Runner de evals | Capa de IA (pendiente de `lib/ai/`) | — | experimental |

Autorizado por ADR-0003. Son infraestructura de producto que usa `kyn-ai`; no forman parte de `framework/`.

## Agentes

| Rol | Implementación | Tipo | Estado |
|-----|----------------|------|--------|
| Brain | Sesión principal | Nativo | stable |
| Explorer | Agente Explore | Nativo | stable |
| Planner | Modo plan + agente Plan | Nativo | stable |
| Reviewer | `/code-review` | Nativo | stable |
| Security | `/security-review` | Nativo | stable |

Agentes propios en `.claude/agents/`: ninguno. Alta solo con evidencia de necesidad registrada en este catálogo.

## Workflows

| Workflow | Ubicación | Workflow base (`AGENTS.md` §4) | Versión | Estado |
|----------|-----------|--------------------------------|---------|--------|
| feature | `framework/workflows/feature.md` | W2 · W3 | 1.0.0 | stable |
| bugfix | `framework/workflows/bugfix.md` | W1 · W2 | 1.0.0 | stable |
| incident | `framework/workflows/incident.md` | W4 | 1.0.0 | stable |
| release | `framework/workflows/release.md` | Cierre de `kyn-ship` | 1.0.0 | stable |

## Standards

| Estándar | Ubicación | Fuente normativa | Versión | Estado |
|----------|-----------|------------------|---------|--------|
| coding | `framework/standards/coding.md` | Propia | 1.0.0 | stable |
| ui | `framework/standards/ui.md` | `.claude/rules/ui.md` | 1.0.0 | stable |
| architecture | `framework/standards/architecture.md` | `.claude/rules/architecture.md` | 1.0.0 | stable |
| ai | `framework/standards/ai.md` | `.claude/rules/ai.md` | 1.0.0 | stable |
| security | `framework/standards/security.md` | `.claude/rules/security.md` | 1.0.0 | stable |
| data | `framework/standards/data.md` | `.claude/rules/data.md` | 1.0.0 | stable |
| performance | `framework/standards/performance.md` | Propia | 1.0.0 | stable |
| documentation | `framework/standards/documentation.md` | Propia | 1.0.0 | stable |

## Templates

| Plantilla | Ubicación | Produce | Versión | Estado |
|-----------|-----------|---------|---------|--------|
| adr | `framework/templates/adr.md` | Guía de uso de `docs/decisions/0000-template.md` | 1.0.0 | stable |
| pr | `framework/templates/pr.md` | Descripción de pull request | 1.0.0 | stable |
| module | `framework/templates/module.md` | `docs/modules/<módulo>.md` | 1.0.0 | stable |
| page | `framework/templates/page.md` | Especificación de página | 1.0.0 | stable |
| handoff | `framework/templates/handoff.md` | Sección "En curso" de `docs/STATE.md` | 1.0.0 | stable |
| skill | `framework/templates/skill.md` | `.claude/skills/<skill>/SKILL.md` | 1.0.0 | stable |
| agent | `framework/templates/agent.md` | `.claude/agents/<agente>.md` | 1.0.0 | stable |

## Memoria

| Componente | Ubicación | Estado |
|------------|-----------|--------|
| Estado | `docs/STATE.md` | stable |
| Dominio | `docs/DOMAIN.md` | stable |
| Decisiones | `docs/decisions/` | stable |
| Módulos | `docs/modules/` (índice en `README.md`, 13 módulos) | experimental |
| Decisiones | ADR-0001 a ADR-0005 aceptados | stable |

## Alta, cambio y baja de componentes

1. Buscar en este catálogo un componente que ya cubra la necesidad; extenderlo antes que crear otro.
2. Un componente nuevo no puede solapar el disparador ni el alcance de otro existente.
3. Toda alta, cambio de estado o baja actualiza este catálogo, `framework/CHANGELOG.md` y `framework/VERSION` en el mismo cambio.
4. Una baja pasa por `deprecated` durante una versión MINOR completa e indica su reemplazo.
