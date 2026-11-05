# KYNOVA — Traspaso técnico completo

> Fecha: **2026-11-05** · Fuente de verdad: GitHub `mexticoglobal-ux/kynova-os`, rama `main` (`6aaaeff`) · Producto `0.1.0` · Framework KAF v1.
> Complemento de `KYNOVA-MASTER-STATUS.md` (qué está terminado, parcial, solo diseñado y qué priorizar).
> Documenta el estado real; no propone arquitectura nueva. Las secciones 22–24 son recomendaciones y están marcadas como tales.
> Código e identificadores en inglés; documentación en español (`AGENTS.md`).

Leyenda: ✅ terminado y verificado · ⚠ parcial o pendiente de Go · 🎭 demostración con datos simulados · 📄 solo diseñado · ❌ no existe.

---

## 1. Estado actual del proyecto (% completado)

**≈ 32 % del alcance catalogado** (7.75 de 24 capacidades; rúbrica y tabla completas en `KYNOVA-MASTER-STATUS.md` §8). Es una estimación con método abierto, no una medida de esfuerzo restante.

| Dimensión | Estado |
|-----------|--------|
| Interfaz y experiencia | Alta: 6 rutas públicas y 10 de aplicación, 8 idiomas, rendimiento 96–100 |
| Datos reales | Muy baja: solo tenancy y perfil de empresa, en un proyecto Supabase desechable con datos ficticios |
| IA | Nula: NEX simulado |
| Plataforma | Preview ✅; producción ❌ |
| Calidad | Pruebas unitarias ✅ (234 tests en `main`); E2E ❌ |

Pruebas: `main` = 22 archivos, 234 tests (typecheck, lint y build en verde). La rama `fix/spike-revoked-session-a1` sube a 24 archivos y 244 tests.

## 2. Arquitectura completa

**Capas y reglas no negociables (`AGENTS.md` §7)**

| Capa | Tecnología | Regla |
|------|------------|-------|
| Framework | Next.js 15.5 (App Router), React 19, TypeScript 5 | — |
| UI | Tailwind CSS 3, Framer Motion 11 (`LazyMotion`), lucide-react, clsx | `.claude/rules/ui.md` |
| Plataforma | Cloudflare Workers vía OpenNext (`@opennextjs/cloudflare`), Wrangler 4.157 | ADR-0002 |
| Datos | Supabase (Postgres + RLS + Auth), solo por `lib/db/` | ADR-0006; tenancy por RLS |
| Contratos | Esquemas compartidos solo en `lib/contracts/` | Módulos no importan internals de otros |
| IA | Workers AI y otros **solo** detrás de `lib/ai/` + AI Gateway | ❌ `lib/ai/` no existe aún |
| Repositorio | GitHub: Actions, PRs, Preview | ADR-0007 |

**Flujo de una petición autenticada (hoy)**
`middleware.ts` (renueva cookies de sesión y fija `no-store`) → ruta o página → cliente Supabase de usuario (`lib/db/supabase-spike.ts`, clave publicable, nunca clave secreta) → RLS en Postgres. El tenant **nunca** viene en la petición: se deduce de la membresía del usuario.

**Patrón de módulo (ADR-0005):** una vista común (`ModuleView`) configurada por módulo con datos de `lib/modules/<módulo>/data.ts` y registro en `lib/modules/registry.ts`; los módulos con vista propia añaden componentes en su carpeta `_components/`.

**Internacionalización (ADR-0004):** diccionarios tipados en cliente (`lib/i18n/messages/*.ts`, `es.ts` define la forma), español por defecto, idioma guardado en `localStorage` (`kynova.locale`).

**Marco KAF:** `AGENTS.md` (reglas, flujo, roles) → `CLAUDE.md` → `.claude/rules` (ui, api, ai, data, security, architecture) → `.claude/skills` (`kyn-data`, `kyn-ai`, `kyn-module`, `kyn-ship`) → `.claude/commands` (`/kyn-status`, `/kyn-brief`, `/kyn-adr`, `/kyn-handoff`) → `.claude/hooks`.

**ADRs vigentes**

| ADR | Decisión | Estado |
|-----|----------|--------|
| 0001 | Carpeta `framework/` | Aceptado |
| 0002 | OpenNext + Cloudflare Workers | Aceptado (fases 0–3 hechas) |
| 0003 | Carpeta `prompts/` y evals de NEX | Aceptado |
| 0004 | i18n en cliente, español por defecto | Aceptado |
| 0005 | Patrón de módulo (vista común) | Aceptado |
| 0006 | Supabase + RLS + Auth, aislamiento por empresa | **Aceptado, condicionado al Go del spike** |
| 0007 | CI: build del Worker en GitHub Actions | Aceptado para el spike |
| 0008 | Enlace mágico PKCE y OTP en el spike de Auth | Aceptado |

## 3. Estructura de carpetas y archivos

```
.claude/            reglas, skills, comandos y hooks de KAF
.github/workflows/  worker-build.yml · rls-isolation.yml · deploy-preview.yml
app/
  (public)/         landing, pricing; "Próximamente": docs, academy, marketplace, contact
  (app)/            dashboard, nex, sales, marketing, clients, properties, automation, finance, analytics, settings
  api/profile/      GET, PUT — perfil de empresa
  api/spike/        auth/{request,verify,callback,sign-out}, items
  spike/            pantalla de login y panel de prueba del spike
components/         charts · i18n · module · providers · public · shell · ui
config/site.ts      navegación y claves de módulo (fuente única)
docs/               STATE.md · DOMAIN.md · decisions/ · modules/ · supabase-spike/ · handoff/
framework/          catálogo, versión, workflows, estándares y plantillas de KAF
lib/
  contracts/        assessment · creator · dashboard · module · supabase-spike · tenancy
  db/               cliente Supabase, config de orígenes permitidos, HTTP, tenancy
  i18n/             config, formato y 8 diccionarios
  modules/          datos de demostración y registro por módulo
  assessment.ts · creator.ts · nex.ts · seo/metadata.ts
prompts/            plantilla y evals de NEX (sin prompts de producto aún)
scripts/            check-spike-canary.mjs · spike-session-checks.mjs (+ tests)
supabase/           migrations/ · seed.sql (ficticio) · tests/ (SQL de aislamiento)
types/              tipos comunes
middleware.ts · next.config.ts · open-next.config.ts · wrangler.jsonc · vitest/playwright config
```

## 4. Lista de todos los módulos existentes

Catálogo de 13 módulos (`docs/modules/`); en el código hay **8 rutas de módulo** + Dashboard + NEX.

| Módulo | Ruta | Área | Estado real |
|--------|------|------|-------------|
| Dashboard | `/dashboard` | Núcleo | 🎭 |
| NEX | `/nex` | Núcleo | 🎭 chat simulado + ⚠ Assessment v0 |
| Sales | `/sales` | CRM | 🎭 |
| Clients | `/clients` | CRM | 🎭 |
| Marketing | `/marketing` | Crecimiento | 🎭 + ⚠ estudio de creadores local |
| Properties | `/properties` | Vertical inmobiliaria | 🎭 |
| Automation | `/automation` | Operaciones | 🎭 |
| Finance | `/finance` | Operaciones | 🎭 |
| Analytics | `/analytics` | Inteligencia | 🎭 |
| Settings | `/settings` | Plataforma | 🎭 + ⚠ perfil de empresa real |
| AI Studio | — | Inteligencia | 📄 sin ruta |
| Marketplace | `/marketplace` | Plataforma | 📄 "Próximamente" |
| Academy | `/academy` | Plataforma | 📄 "Próximamente" |

Además: `/docs` y `/contact` ("Próximamente").

## 5. Funcionalidades terminadas

Ver `KYNOVA-MASTER-STATUS.md` §2. Resumen: marco KAF, interfaz base, i18n de 8 idiomas, SEO y rendimiento, plataforma Workers y CI, esquema de tenancy con RLS (13/13 controles SQL), lectura aislada por empresa en el Preview, Worker de 6.84 MiB (límite 64 MiB).

## 6. Funcionalidades en desarrollo

| Trabajo | Dónde está | Siguiente paso |
|---------|------------|----------------|
| Spike de Supabase / ADR-0006 fase 1b | `docs/supabase-spike/RESULTADO.md`: **Go parcial** | Go o No-Go con evidencia |
| Corrección A1/B4 (sesiones revocadas) | Rama `fix/spike-revoked-session-a1` (publicada, sin fusionar) | Abrir el PR, fusionar, desplegar al Preview y probar `revoke` |
| Reconciliación B1 y B5 como PASS en `RESULTADO.md` | Misma rama | Llega a `main` con el PR anterior |
| Estabilizar el despliegue del Preview | `main`: Wrangler 4.157.0 (#4) y `keep_vars` (`6aaaeff`) | Relanzar "Deploy Preview" y confirmar |
| Prueba de Creator Economy con Nova | Estudio local en `/marketing` | Que Nova lo pruebe con contenido ficticio y diga qué falta |
| Este traspaso | Rama local `docs/handoff-master-status` | Revisar y fusionar si se quiere versionar |

## 7. Funcionalidades pendientes

Detalle y bloqueos en `KYNOVA-MASTER-STATUS.md` §6. Lista corta: Go del spike, SMTP, tipos de BD (D31), exportación y borrado del perfil, alta de empresas e invitaciones, guardar el Assessment, NEX real, datos reales en los módulos, persistencia del estudio de creadores, cabeceras de seguridad, E2E, producción (dominio D23, caché D21, legal D25), AI Studio, Marketplace y Academy.

## 8. Componentes reutilizables

| Componente | Ruta | Uso |
|------------|------|-----|
| `AppShell`, `AppNavLinks`, `nav-icons` | `components/shell/` | Marco de la app y navegación |
| `ModuleView` (con ranura `children`) | `components/module/` | Vista común de módulo (ADR-0005) |
| `KpiCard`, `StatusBadge`, `Skeleton`, `BackButton` | `components/ui/` | Piezas de interfaz |
| `AreaChart`, `BarList`, `Sparkline` | `components/charts/` | Gráficos propios sin librería |
| `I18nProvider`, `LanguageSwitcher` | `components/i18n/` | Idioma y diccionarios |
| `Providers` | `components/providers/` | Proveedores de la app |
| `PublicHeader`, `PublicFooter`, `ComingSoon` | `components/public/` | Páginas públicas |
| `LandingHero`, `LandingSections`, `Particles` | `app/(public)/_components/` | Landing |
| `PricingView` | `app/(public)/pricing/_components/` | Tabla de planes y comparativa |
| `DashboardView` | `app/(app)/dashboard/_components/` | Dashboard |
| `NexChat`, `AssessmentFlow`, `useConversations` | `app/(app)/nex/_components/` | Chat y autodiagnóstico |
| `CreatorStudio`, `BriefTab`, `IdeasTab`, `ScriptsTab`, `ProductionTab`, `useCreatorStudio`, `styles` | `app/(app)/marketing/_components/` | Estudio de creadores |
| `CompanyProfile` | `app/(app)/settings/_components/` | Perfil de empresa |

Reglas de reutilización (`AGENTS.md` §3): reutilizar > extender > crear; buscar antes de crear un componente nuevo.

## 9. Base de datos (tablas y relaciones)

Proyecto Supabase **desechable** (no producción). Migración `supabase/migrations/20261031000000_tenancy_core.sql`; `20261102000000_upgrade_disposable_tenancy.sql` actualiza el proyecto desechable sin perder datos. Los tipos de BD **no están generados** (D31, `lib/db/database.types.ts` no existe).

| Tabla | Columnas clave | Relaciones |
|-------|----------------|------------|
| `tenants` | `id`, `name` (1–120), `status` (`active`/`suspended`), fechas | Unidad de aislamiento |
| `memberships` | PK `(user_id, tenant_id)`, `role` (`owner`/`member`), fechas | `user_id → auth.users` (cascade); `tenant_id → tenants` (cascade); índice por tenant |
| `business_profiles` | `tenant_id` **único**, `trade_name`, `country`, `locale`, `sector`, `team_size`, `channel`, `crm`, `problem`, `goal`, `questionnaire_version`, `created_by`/`updated_by`, fechas | `tenant_id → tenants` (cascade); `created_by`/`updated_by → auth.users`; CHECK con los valores cerrados del Assessment |
| `spike_items` | `id`, `tenant_id`, `label` | `tenant_id → tenants`; solo del spike (`docs/supabase-spike/schema.sql`) |
| `assessment_runs` | — | 📄 prevista (ADR-0006), no existe |

**Esquema `private` (no expuesto):** `is_member(tenant)` e `is_owner(tenant)` (`security definer`, `search_path = ''`, ambas exigen empresa activa) y `touch_updated_at()`.

**Políticas RLS:** `tenants` y `memberships` solo lectura (propias); `business_profiles`: lectura para miembros; insertar y actualizar solo propietarios, con `WITH CHECK`; sin `DELETE` desde la API. Permisos mínimos explícitos por tabla; `anon` sin acceso.

**Pruebas:** `supabase/tests/isolation.sql` (CI, Postgres efímero con `auth` simulado), `supabase/tests/verify_project.sql` (13/13 en el proyecto real). Seed ficticio: dos empresas de prueba (A = "Nova Marketing Studio" de prueba, B) y C sin membresía.

## 10. APIs existentes

| Método y ruta | Función | Estado |
|---------------|---------|--------|
| `GET /api/profile` | Empresa y perfil del usuario con sesión; 401 sin sesión, 404 sin membresía | ⚠ Pendiente de Go |
| `PUT /api/profile` | Guarda el perfil (solo propietario); comprobación de mismo origen, límite de cuerpo, JSON validado; 403 si RLS niega, 415, 413, 400 | ⚠ |
| `GET /api/spike/items` | Filas de `spike_items` visibles por RLS | ⚠ Solo prueba |
| `POST /api/spike/auth/request` | Pide el correo con código/enlace (`shouldCreateUser: false`) | ⚠ |
| `POST /api/spike/auth/verify` | Verifica el código OTP | ⚠ |
| `GET /api/spike/auth/callback` | Intercambia el `code` PKCE del enlace mágico | ⚠ |
| `POST /api/spike/auth/sign-out` | Cierra sesión (`scope: "local"`) | ⚠ |

Todas responden con `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`, `Expires: 0`; errores genéricos (sin detalles internos). Nota: los nombres "spike" son deuda D30 (renombrar cuando haya Go).

**Pendiente de fusionar:** autorizar con `getUser()` en lugar de `getClaims()` (`lib/db/supabase-spike-auth.ts`) para que el JWT de una sesión cerrada deje de valer en estas rutas.

## 11. Integraciones implementadas

| Integración | Estado |
|-------------|--------|
| Cloudflare Workers (OpenNext, assets, auto-referencia del Worker) | ✅ Preview `kynova-os-preview`; producción ❌ |
| GitHub Actions (build, tests, RLS, deploy del Preview con confirmación manual o `[deploy-preview]`) | ✅ |
| Supabase Auth + Postgres (proyecto desechable) | ⚠ |
| Cloudflare Observability | ✅ activa; 18 éxitos y 0 errores en la ventana revisada (2026-11-03) |
| Workers AI, AI Gateway, KV, R2, Hyperdrive | ❌ (cada uno requerirá su ADR) |
| YouTube, redes sociales, pagos, correo propio (SMTP), MCP (`.mcp.json`) | ❌ |

## 12. Variables de entorno necesarias

Solo nombres; los valores viven en Wrangler/GitHub secrets o en `.dev.vars` (nunca en el repositorio).

| Variable | Dónde | Para qué |
|----------|-------|----------|
| `NEXTJS_ENV` | `.dev.vars` | Archivos `.env` que carga OpenNext en local (`development`) |
| `SUPABASE_URL` | Worker / `.dev.vars` | URL del proyecto Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Worker / `.dev.vars` | Clave publicable (la clave secreta **no** se usa ni debe llegar al cliente) |
| `SPIKE_SECRET_CANARY` | `.dev.vars` / CI | Valor señuelo para comprobar que ningún secreto llega al bundle |
| `CLOUDFLARE_API_TOKEN` | GitHub secret | Despliegue del Preview (token limitado a ese Worker) |
| `CLOUDFLARE_ACCOUNT_ID` | Workflow | Cuenta de Cloudflare |
| `KYNOVA_CONFIRM_PRODUCTION` | Local | Guarda que bloquea `npm run deploy:production` sin aprobación |
| `SPIKE_COOKIE_<A\|B\|C\|MEMBER>`, `SPIKE_BASE_URL` | Solo en tu shell | Entradas de `scripts/spike-session-checks.mjs` (solo cuentas ficticias) |

`wrangler.jsonc` fija `keep_vars: true`, para que un deploy no borre las variables definidas en el dashboard.

## 13. Dependencias del proyecto

**Producción:** `next` ^15.5.28 · `react` y `react-dom` ^19 · `@supabase/supabase-js` ^2.118 · `@supabase/ssr` ^0.12.7 · `@opennextjs/cloudflare` ^1.20.13 · `framer-motion` ^11.11 · `lucide-react` ^0.453 · `clsx` ^2.1.1.
**Desarrollo:** `typescript` ^5.6 · `tailwindcss` ^3.4 · `eslint` ^9 (+ `eslint-config-next`, `eslint-config-prettier`) · `prettier` ^3.4 · `vitest` ^3.2 (+ cobertura v8) · `@testing-library/*` · `jsdom` · `@playwright/test` ^1.49 · `wrangler` ^4.157 · `postcss`, `autoprefixer`.
**Entorno:** Node ≥ 22 (local: v24.22.1), npm 11.19.1.
**Auditoría:** `npm ci` reporta 29 vulnerabilidades (21 moderadas, 6 altas, 2 críticas; D17); 26 con Wrangler 4.157. Sin revisar a fondo.

## 14. Diseño del Dashboard

Estado: 🎭 completo en interfaz, con **datos simulados** y etiqueta visible de demostración.
- **Cabecera** con saludo al usuario (`userName`).
- **4 KPIs** (`KpiCard`): ingresos de hoy, leads nuevos, conversión, clientes activos; cada uno con valor y variación (`ModuleKpi`).
- **Tendencia de ingresos**: `AreaChart` de 12 meses.
- **Business Health Score**: nota global = media de 6 áreas (ventas, marketing, finanzas, automatización, experiencia del cliente, crecimiento), con su desglose.
- **Leads por canal**: `BarList` (web, social, referidos, anuncios).
- **Acciones recomendadas** por NEX.
- Reglas de negocio de `docs/modules/dashboard.md`: cada área muestra de qué datos procede; las acciones se ordenan por impacto; un área sin datos se muestra como "no evaluada", **nunca con una puntuación inventada** (hoy la puntuación sí es inventada, por ser demo; la fórmula está sin definir).
Contrato: `lib/contracts/dashboard.ts`. Datos: `lib/modules/dashboard/data.ts`.

## 15. Diseño del CRM

El CRM no es un módulo: es una capacidad (`DOMAIN.md` §6) que se materializa en **Sales** y **Clients**. Estado: 🎭 vistas de demostración; el diseño de negocio está en `docs/modules/`.

| Módulo | Núcleo previsto | Entidades |
|--------|-----------------|-----------|
| Sales | Registrar y calificar leads · pipeline de oportunidades por etapas · actividades comerciales · seguimientos y avisos de leads sin contactar · convertir oportunidad ganada en cliente | Lead, Oportunidad, Pipeline, Actividad comercial |
| Clients | Ficha completa e historial · contactos de un cliente organización · interacciones y notas · segmentación | Cliente, Contacto, Interacción, Segmento |

Ampliaciones previstas: previsión de ventas, detección de clientes en riesgo. Preguntas abiertas (sin decidir): etapas por defecto del pipeline, plazo para "lead desatendido", criterios de duplicados, señales de abandono. Relaciones: Marketing → Sales (leads) → Clients (conversiones) → Finance (ventas cerradas). Sin tablas en base de datos todavía.

## 16. Diseño de NEX AI

Estado: 🎭 chat simulado + ⚠ Business Assessment v0.
- **Chat** (`NexChat`): conversación, historial de hasta `MAX_CONVERSATIONS` guardado en el navegador (`kynova.nex.conversations`), aviso "Respuesta simulada" en cada respuesta de NEX (`data-simulated-notice`). Detección de intención por palabras clave en 8 idiomas (`lib/nex.ts`: correo, campaña, propiedades, clientes, caja, marketing, ingresos, leads, o respuesta genérica); retardo artificial de 900 ms.
- **Business Assessment v0** (`AssessmentFlow`, `lib/assessment.ts`): 6 preguntas cerradas (sector, tamaño del equipo, canal principal, gestión de clientes, principal problema, objetivo), reglas de puntuación por opción, recomienda 2–3 módulos con su evidencia; vive en memoria y **no guarda nada**.
- **Capacidades diseñadas** (`docs/modules/nex.md`): preguntar sobre los datos, resúmenes periódicos, recomendaciones con justificación; ampliaciones: ejecutar acciones tras confirmar, retomar conversaciones. Regla: toda acción con efectos requiere confirmación explícita.
- **Pendiente:** conectar un proveedor vía `lib/ai/` y AI Gateway; marcar cada mensaje como simulado o real (D8); corregir D27 (scroll al abrir otra conversación) y D28 (`send()` sin `try/finally`).
- **Honestidad de NEX** (Blueprint README): las recomendaciones deben basarse en datos disponibles; no presentar reglas o ejemplos como análisis real.
- **Visión de los Blueprints (📄):** NEX como puerta de entrada: Landing → NEX → Assessment dinámico → Business DNA → KYNOVA Score → plan recomendado → compra. Nada de esto existe aún.

## 17. Diseño de Marketing

Estado: 🎭 vista de módulo con KPIs, tarjetas y tabla de campañas de demostración + ⚠ estudio de creadores.
- **Diseño de negocio** (`docs/modules/marketing.md`): campañas por canal y presupuesto, origen de cada lead, rendimiento y retorno; ampliaciones: audiencias desde segmentos, calendario de contenidos. Entidades: Campaña, Canal, Audiencia, Contenido. Abierto: modelo de atribución, canales de la primera versión.
- **Estudio de creadores v0** → sección 20.

## 18. Diseño de Academy

Estado: 📄 página pública "Próximamente" (`/academy`); sin ruta de aplicación.
- Objetivo (`docs/modules/academy.md`): acelerar la adopción de KYNOVA OS y de NEX.
- Núcleo previsto: consultar cursos y guías por módulo y nivel; seguir el propio progreso. Ampliaciones: formación contextual, asignar formación a usuarios, certificaciones.
- Entidades: Curso, Lección, Progreso, Certificación. El progreso pertenece al usuario dentro de su tenant.
- Abierto: idiomas del contenido y certificaciones por plan. Los planes de `/pricing` mencionan Academy como característica (esencial/completa según plan).

## 19. Diseño de Marketplace

Estado: 📄 página pública "Próximamente" (`/marketplace`); sin ruta de aplicación.
- Objetivo (`docs/modules/marketplace.md`): ampliar KYNOVA OS con integraciones, plantillas y capacidades instalables por tenant.
- Núcleo previsto: explorar el catálogo; instalar una extensión revisando y aprobando sus permisos; desinstalar y revocar acceso. Ampliaciones: valorar extensiones, publicar como proveedor.
- Entidades: Extensión, Instalación, Permiso de extensión, Proveedor. Cada extensión declara los datos y permisos que necesita.
- Abierto: extensiones de terceros o solo propias en la primera versión; modelo económico para proveedores.
- Blueprints: la Fase 5 ("Marketplace de agentes IA") lo extiende a agentes; sin código. En `/pricing` el Marketplace no está incluido en Starter.

## 20. Diseño del nuevo módulo de YouTube

No es un módulo nuevo: es el **estudio de creadores dentro de Marketing** (decisión del usuario: no se crea un módulo de Academy ni uno aparte). Prueba de Creator Economy con Nova, canal de YouTube **sin mostrar la cara**.

Estado: ⚠ v0 funcional **solo en el navegador** (no usa red, no se conecta a YouTube ni a redes, no publica, no usa credenciales). Contenido de muestra ficticio, solo en español; interfaz en 8 idiomas.

| Pestaña | Contenido | Contrato (`lib/contracts/creator.ts`) |
|---------|-----------|---------------------------------------|
| Brief | Nombre del canal, tema, audiencia, tono, formato sin cara (`narratedStock`, `screenRecording`, `slidesAnimation`, `ttsCompilation`), vídeos por semana | `ChannelBrief` |
| Ideas | Banco de ideas con prioridad (alta/media/baja) y estado (pendiente/seleccionada/descartada); promover una idea a guion | `Idea` |
| Guiones | Gancho, desarrollo y cierre; recuento de palabras y duración estimada (150 palabras/min); etapa y fecha planificada | `Video` |
| Producción | 6 etapas (`scripting`, `voiceover`, `visuals`, `editing`, `review`, `ready`) y plan semanal | `ProductionStage`, `ProductionPlan` |

Lógica pura en `lib/creator.ts`; estado en `localStorage` mediante `useCreatorStudio`; límites en `CREATOR_LIMITS`; confirmación antes de reiniciar. Pruebas automáticas de lógica e interfaz.

**Límites conocidos (D33):** sin tenant ni copia ni sincronización; recuento de palabras por espacios (no sirve para japonés/chino); sin exportación ni ayuda de NEX. **Sin decidir:** persistencia por tenant (tras el Go), ayuda de NEX, exportación, métricas del canal, conexión con YouTube por Marketplace.
**Blueprint:** "Creator Economy" aparece como uno de los 15 verticales previstos; sin diseño propio.

## 21. Roadmap técnico

**ADR-0002 (plataforma):** fases 0–3 ✅ · 4 dominio y producción ❌ (bloqueos D21, D23, D25) · 5 CI/README ✅ parcial.

**ADR-0006 (datos), ruta gradual**

| Fase | Alcance | Estado |
|------|---------|--------|
| 0 | Aprobar ADR y decisiones | ✅ aceptado, condicionado |
| 1a | Spike de autenticación (criterios A y B) | ⚠ Go parcial |
| 1b | Núcleo: migraciones, contratos, `lib/db/`, tipos generados, login en Preview | ⚠ implementado, tipos pendientes |
| 2 | Guardar el Assessment, precarga, exportación y borrado, 8 idiomas | ❌ (pantalla mínima de perfil ya existe) |
| 3 | Piloto con datos reales (Nova, 1–3 usuarios por invitación) | ❌ requiere las cuatro condiciones |
| 4 | Producción, copias PITR, más empresas | ❌ |

**Blueprints (visión, 📄):** 1 NEX Business Assessment (el v0 es un primer paso) → 2 Business DNA → 3 KYNOVA Score → 4 Vertical Intelligence → 5 Marketplace de agentes IA → 6 Aprendizaje continuo por industria.

## 22. Lista de bugs conocidos

| Ref. | Problema | Gravedad |
|------|----------|----------|
| A1/B4 | El JWT de una sesión cerrada sigue autorizando hasta caducar (`getClaims()` con claves asimétricas). Corrección en rama, sin fusionar. Límite residual: PostgREST acepta el token hasta que caduque (solo se acota acortando la vigencia del JWT en Supabase) | Media |
| A8 | Faltan HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` en las respuestas del Preview | Media (antes de datos reales) |
| D4 | Los hooks de `.claude/hooks/` no se han probado en una sesión con Node en el PATH; en esta sesión `verify.mjs` falla siempre con `MODULE_NOT_FOUND` (`npm-prefix.js`) | Baja (se verifica con los scripts de npm) |
| D8 | El aviso "Respuesta simulada" sale en todo mensaje de NEX, incluidos los guardados | Baja |
| D21 | Next envía `s-maxage=31536000` en el HTML estático | Media (antes del dominio) |
| D24 | i18n en cliente: solo el español es indexable; un idioma guardado distinto muestra español hasta hidratar | Baja (aceptada, ADR-0004) |
| D27 | NEX: al abrir otra conversación no se desplaza a su último mensaje | Baja |
| D28 | NEX: `send()` sin `try/finally`; si `askNex` falla, el chat queda bloqueado | Media al conectar un proveedor |
| D29 | Check histórico rojo de "Workers Builds: kynova-os" en el head `d858741` del PR #1; ya no se generan | Informativa |
| D32 | Hallazgos aceptados: foco de teclado tras responder en el Assessment, barra de progreso sin marcar el paso actual, `aria-live` anidado, doble clic puede contestar dos preguntas; país e idioma validados por forma; límite de cuerpo por `Content-Length` | Baja |
| — | `RESULTADO.md` en `main` aún marca B1 y B5 como pendientes (ya son PASS por observación; reconciliado en la rama del fix) | Documental |
| — | El Preview falló al desplegar con Wrangler 4.152 y un token limitado a un Worker (error de Wrangler, no del token); mitigado en `main` con 4.157.0, **sin reverificar** | Media |

## 23. Lista de mejoras sugeridas

Solo las ya registradas en los documentos del proyecto; ninguna es una idea nueva.

- Extraer un componente común para la etiqueta de datos de demostración (hoy repetida en `DashboardView`, `ModuleView` y `NexChat`) — `STATE.md`.
- Marcar cada mensaje de NEX como simulado o real y mostrar el aviso solo en los simulados (D8).
- Renombrar los módulos "spike" a nombres de producto cuando haya Go (D30).
- Generar `lib/db/database.types.ts` y tipar `lib/db/tenancy.ts` (D31).
- Listas cerradas de país e idioma y límite de cuerpo real (D32).
- Persistir el estudio de creadores por tenant y soportar recuento de palabras en japonés y chino (D33).
- Tests E2E con Playwright (D5), formato Prettier (D15), revisión de dependencias (D17).
- Acortar la vigencia del JWT en Supabase para reducir la ventana residual de A1 (README del spike; ajuste del proyecto, no hecho).
- Cabeceras de seguridad y límite de tasa propios (A8).
- Actualizar la tabla de reglas de `CLAUDE.md` §5 (D14).

## 24. Próximos sprints

> **Orden aprobado por Jeffrey Hernandez (2026-11-05):** primero el núcleo de NEX, después las herramientas que utilizará. Sustituye al orden anterior, que seguía `STATE.md` (orientado a módulos). Los nombres de sprint y su contenido siguen siendo una propuesta de planificación. Sprint 4 (Preview, i18n, Dashboard, NEX simulado) está cerrado.
> Modelo de autonomía: tres niveles (Constitución, Artículo 7). El Nivel 2 requiere su ADR antes de construirse.

| Sprint | Objetivo | Contenido | Puerta de salida |
|--------|----------|-----------|------------------|
| 5 — Cerrar el spike | Go o No-Go con evidencia | Fusionar el fix A1/B4; relanzar el Preview; `revoke` y renovación (B3); SMTP; tipos (D31); B6; pruebas de escritura con tenant dedicado | `RESULTADO.md` con Go/No-Go y `/security-review` sin hallazgos altos |
| 6 — Fundamentos del agente | Decidir lo que NEX necesita para existir | ADRs: autonomía por niveles y autorización permanente (C1, modifica la regla 12 de `.claude/rules/ai.md`, `framework/standards/ai.md` y `DOMAIN.md` §3); identidad del agente dentro de una empresa (C2); ejecución en segundo plano (C3); memoria del negocio (C4); registro de acciones y autorizaciones; canal de aviso (C6). Más las decisiones de datos reales de ADR-0006: región, retención, eliminación, entorno y análisis legal | ADRs aprobados; Constitución aprobada |
| 7 — NEX real mínimo (Nivel 1) | Sustituir la simulación | `lib/ai/`, AI Gateway, registro de modelos, prompts y evals en `prompts/`; lectura del perfil y del Assessment; resumen bajo demanda; aviso solo en respuestas simuladas (D8); corregir D27 y D28 | Evals en verde; solo lectura; sin acciones con efectos |
| 8 — Perfil completo y endurecimiento | Condiciones para datos reales | Guardar el Assessment en el perfil; exportación y borrado verificados; alta de empresas y membresías; cabeceras de seguridad (A8); límite de tasa; tests E2E (D5); dependencias (D17) | Flujo probado en escritorio y móvil; `/security-review` sin hallazgos altos |
| 9 — Turno de noche | NEX trabaja sin el usuario | Ejecución programada (C3), bandeja de decisiones, informe de la mañana, registro de actividad (qué, por qué, bajo qué autorización) | Una empresa de prueba recibe su informe sin intervención; todo queda en el registro |
| 10 — Primeras herramientas | NEX usa herramientas, con autorización | Estudio de creadores persistido por tenant y expuesto a NEX por contrato; primeras autorizaciones permanentes (Nivel 2) de bajo riesgo, por ejemplo enviar informes | Pruebas de aislamiento; cada acción cita su autorización |
| 11 — CRM como herramienta | Datos reales de negocio | Clients y Sales con persistencia por tenant, usados por NEX | Pruebas de aislamiento por tabla |
| 12 — Piloto con Nova | ADR-0006 fase 3 | Alta de Nova por invitación (1–3 usuarios); datos reales solo si se cumplen las cuatro condiciones de `KYNOVA-MASTER-STATUS.md` §6 | Opinión de usuarios; sin hallazgos de seguridad abiertos |
| 13 — Producción | ADR-0002 fase 4 | Dominio (D23), caché (D21), revisión legal (D25), despliegue con aprobación explícita | Aprobación explícita (`AGENTS.md` §7.11) |

Marketplace, Academy, AI Studio y verticales quedan fuera hasta la 1.0, según los documentos actuales.

---

### Anexo: archivos de referencia

`AGENTS.md` · `CLAUDE.md` · `docs/STATE.md` · `docs/DOMAIN.md` · `docs/decisions/0001–0008` · `docs/modules/*.md` · `docs/supabase-spike/{README,RESULTADO,schema}.md` · `docs/blueprints/*.docx` (solo en la copia del escritorio; ver `KYNOVA-MASTER-STATUS.md` §7) · `framework/REGISTRY.md`.
