# KYNOVA MASTER STATUS

> Estado real de KYNOVA OS al **2026-11-05**, para continuar sin perder nada entre Jeffrey, Claude y ChatGPT.
> Consolida `docs/STATE.md`, los ADR 0001–0008, `docs/DOMAIN.md`, `docs/modules/`, `docs/supabase-spike/RESULTADO.md` y los dos Blueprints (`.docx`).
> No propone ideas nuevas ni cambia la arquitectura: separa lo que existe de lo que solo está escrito.
> Complemento: `KYNOVA-HANDOFF.md` (las 24 secciones técnicas).

**Regla de lectura.** Precedencia ante conflicto: código > ADR vigente > `STATE.md` > memoria personal (`AGENTS.md` §3). Los Blueprints son visión objetivo, **no** estado.

---

## 0. Lo que ChatGPT debe saber antes de tocar nada

1. **Los Blueprints describen un Core que no existe tal cual.** Dicen que KYNOVA "ya cuenta con" autenticación, roles, CRM base, Marketplace, Academy, AI Studio, administración y API. En el código: no hay roles (solo `owner`/`member` por empresa), el CRM son pantallas con datos de demostración, Marketplace y Academy son páginas "Próximamente" y AI Studio ni siquiera tiene ruta. El propio `docs/blueprints/README.md` lo advierte. **Úsalos como dirección, nunca como inventario.**
2. **NEX está simulado.** Responde por palabras clave con textos fijos (`lib/nex.ts`). No hay proveedor de IA, ni `lib/ai/`, ni AI Gateway. Cada respuesta lleva el aviso "Respuesta simulada".
3. **El producto sigue siendo una demo con una capa real muy pequeña.** Lo real hoy: autenticación por correo (en el Preview), aislamiento por empresa con RLS, el perfil de empresa y el cuestionario del Assessment en memoria. Todo lo demás son datos de ejemplo.
4. **No hay datos reales de Nova Marketing Studio en ningún sistema.** Nova existe solo como "empresa A de prueba" en un proyecto Supabase desechable, con respuestas sintéticas. ADR-0006 prohíbe datos reales hasta cumplir cuatro condiciones (ver §6).
5. **Hay dos copias locales del proyecto con historiales distintos** (ver §7). La fuente de verdad recomendada es el repositorio de GitHub `mexticoglobal-ux/kynova-os`, rama `main`.
6. **Dos nombres de planes en conflicto:** el código y `DOMAIN.md` usan Starter / Professional / Business / Enterprise; el Blueprint usa Foundation / Growth / Scale / Enterprise. No se ha decidido cuál vale (ver §5).

---

## 1. Estado en una página

| Área | Estado | Evidencia |
|------|--------|-----------|
| Producto visible | Demo navegable en 8 idiomas | Preview `kynova-os-preview` |
| Plataforma | Preview desplegado en Cloudflare Workers; **producción sin desplegar** | ADR-0002 fases 0–3 hechas; 4–5 pendientes |
| Datos y tenancy | Implementado, **pendiente de Go** | 13/13 controles SQL en el proyecto desechable; aislamiento A/B/C verificado en el Preview |
| Auth | Funciona con código OTP y enlace mágico en el Preview; **SMTP propio pendiente** | `docs/supabase-spike/RESULTADO.md` |
| IA | Simulada | `lib/nex.ts` |
| Calidad | Typecheck, lint, 234 tests (22 archivos) y build en verde en `main`; sin tests E2E | CI de GitHub Actions |
| Seguridad | Un hallazgo abierto de sesión (A1/B4) con corrección en una rama sin fusionar; cabeceras de seguridad ausentes | §4 |

**Avance (estimación, método abierto en §8): ≈ 32 % del alcance catalogado de 24 capacidades; todos los módulos de negocio siguen en fase de demostración excepto dos piezas locales y el perfil de empresa.**

---

## 2. Qué está completamente terminado

"Terminado" = implementado, probado y verificado en el Preview o en CI. Sin datos reales y sin asteriscos pendientes.

| # | Pieza | Detalle |
|---|-------|---------|
| 1 | Marco de ingeniería KAF v1 | `AGENTS.md`, `CLAUDE.md`, `.claude/` (reglas, skills, comandos, hooks), `framework/`; ver deuda D4 (hooks sin verificar) |
| 2 | Interfaz base | Shell de la app, navegación única (`config/site.ts`), tema oscuro, componentes comunes |
| 3 | Internacionalización | 8 idiomas con diccionarios tipados y carga bajo demanda (ADR-0004); español por defecto |
| 4 | SEO y rendimiento | Metadatos por ruta, sitemap, robots, schema.org, manifest; PageSpeed (2026-10-24): `/` 96, resto 99–100 |
| 5 | Plataforma Cloudflare | OpenNext + Workers, Preview desplegable por GitHub Actions (ADR-0002, 0007) |
| 6 | CI | Build del Worker (con dry-run, tamaño y escaneo de canario), tests, lint y aislamiento RLS en Postgres efímero |
| 7 | Tamaño del Worker | 7,006.79 KiB sin comprimir (≈ 6.84 MiB) frente al límite de 64 MiB de Cloudflare |
| 8 | Esquema de tenancy | `tenants`, `memberships`, `business_profiles` con RLS y permisos mínimos; 13/13 controles SQL reales |
| 9 | Lectura aislada por empresa en el Preview | A solo ve lo de A, B lo de B, C (sin membresía) no ve nada |

## 3. Qué funciona actualmente (con matices)

| Pieza | Qué hace | Límite |
|-------|----------|--------|
| Landing y precios | Páginas públicas completas | Testimonios y comparativa ilustrativos (D25); precios y planes sin validar (D16) |
| Dashboard | KPIs, tendencia de ingresos, Business Health Score, canales, acciones recomendadas | **Datos simulados**, etiquetados como demostración |
| 8 módulos de negocio | Vista común (`ModuleView`) con KPIs, tarjetas y tabla por módulo | **Datos simulados**; sin persistencia |
| NEX chat | Conversación, historial en el navegador, 8 idiomas | **Respuestas simuladas** por intención; historial solo en `localStorage` |
| Business Assessment v0 | 6 preguntas cerradas y 2–3 módulos recomendados por reglas | Solo en memoria; **no guarda nada** |
| Inicio de sesión | OTP numérico y enlace mágico PKCE en `/spike/login` | Cuentas de prueba (alta desactivada); correo a cuentas externas bloqueado por SMTP |
| Perfil de empresa (`/settings`) | Carga, edición y guardado del perfil vía `/api/profile` | Solo datos ficticios; sin probar con la sesión real de un usuario de Nova |
| Estudio de creadores (`/marketing`) | Canal de YouTube sin mostrar la cara: brief, ideas, guiones, producción | **Solo en el navegador**: sin tenant, sin copia, sin NEX, sin exportar, sin YouTube |

## 4. Qué está parcialmente construido

| Pieza | Hecho | Falta |
|-------|-------|-------|
| Spike de Supabase / ADR-0006 fase 1b | Esquema, RLS, API, Auth, aislamiento A/B/C, cookies `sb-*` seguras (B1), `no-store` autenticado (B5) | **Go o No-Go**; renovación de sesión (B3); validar en el Preview la corrección de A1/B4; SMTP propio; tipos generados (D31); comparación con `npm run preview` (B6); pruebas adversariales de escritura entre tenants |
| Corrección de sesiones revocadas (A1/B4) | Código y 244 tests en la rama `fix/spike-revoked-session-a1` (commit `90989e5`) | Abrir y fusionar el PR, desplegar al Preview y repetir `revoke` con una cuenta ficticia |
| Despliegue del Preview | Subida de Wrangler a 4.157.0 (#4) y `keep_vars: true` (`6aaaeff`) en `main` | Volver a lanzar "Deploy Preview" y confirmar que ya no falla con "Unable to fetch bindings, routes, or services metadata" |
| Perfil de empresa | API y pantalla mínima | Guardar el Assessment en el perfil; exportar y borrar; alta de empresas y membresías (hoy manual por SQL); invitaciones |
| Marketing (creadores) | Estudio local v0 | Persistencia por tenant; ayuda de NEX; exportación; conexión con YouTube (nada decidido) |
| Seguridad de aplicación | `no-store` en las rutas de API; límite de cuerpo; comprobación de mismo origen | Cabeceras HSTS/CSP/`X-Content-Type-Options`/`Referrer-Policy`/`X-Frame-Options` (A8); límite de tasa propio; revisión de CSRF en Workers |

## 5. Qué solamente está diseñado (documentado, sin código)

| Pieza | Dónde está diseñado | Estado en código |
|-------|---------------------|------------------|
| Business DNA | Blueprints; ADR-0006 (`business_profiles` v1 es su base) | No existe más allá del perfil v1 |
| KYNOVA Score | Blueprints (Fase 3) | No existe; el Business Health Score del Dashboard es un valor simulado |
| Vertical Intelligence (15 verticales) | Blueprints | No existe |
| Capability Model (CRM, OCR, firma, pagos…) | Blueprints | No existe |
| Marketplace de agentes IA | Blueprints (Fase 5); `docs/modules/marketplace.md` | Página "Próximamente" |
| Aprendizaje continuo por industria | Blueprints (Fase 6) | No existe |
| Assessment dinámico por sector | Blueprints | El v0 es de 6 preguntas fijas |
| Recomendación de plan tras el diagnóstico | Blueprints | No existe; los planes se muestran en `/pricing` |
| Módulos de negocio con lógica real | `docs/modules/*.md` (estado "Planificado") | Solo vistas de demostración |
| `assessment_runs` (instantáneas del Assessment) | ADR-0006 | No existe |
| AI Studio | `docs/modules/ai-studio.md` | Sin ruta |
| Academy y Docs | `docs/modules/academy.md` | Páginas "Próximamente" |

## 6. Qué falta desarrollar

Agrupado por bloqueo, no por deseo:

**Bloquea datos reales de Nova (ADR-0006 fase 3) — las cuatro condiciones:**
1. Autenticación verificada en el entorno real. *(Preview sí; entorno de datos reales sin decidir.)*
2. Aislamiento entre dos empresas verificado. *(Hecho en el proyecto desechable.)*
3. **Exportación del perfil implementada y verificada.** *(No existe.)*
4. **Borrado del perfil implementado y verificado.** *(No existe.)*

**Decisiones de negocio y legales sin tomar (ADR-0006):** región de Supabase, retención, eliminación, entorno donde viven los datos reales y análisis legal aparte.

**Bloquea producción (ADR-0002 fase 4):** titularidad de `kynova.ai` (D23; el DNS está en GoDaddy), caché del HTML estático (D21), revisión de marketing y legal de la landing (D25).

**Bloquea una versión útil para un cliente:** conexión real de NEX (`lib/ai/`, Workers AI, AI Gateway), datos reales en Clients y Sales, tests E2E (D5), formato de código (D15) y las 29 vulnerabilidades de dependencias reportadas por `npm ci` (D17; 26 tras subir Wrangler en la rama de la actualización).

## 7. Mapa de copias del proyecto (importante)

| Copia | Ruta / remoto | Contenido real |
|-------|---------------|----------------|
| **GitHub `main`** (fuente de verdad recomendada) | `github.com/mexticoglobal-ux/kynova-os`, copia de trabajo en `Documents\Codex\…\KYNOVA-Supabase-Spike` | Todo lo descrito en este documento. Historial: `Initial commit` + PR #1, #2 y #4 + `6aaaeff` |
| `KYNOVA OS` en el escritorio | `Desktop\Maketing digital\Kynova\KYNOVA OS`, rama `sprint-4` (5 commits propios; **historial con raíz distinta al de GitHub**, sin commits en común) | Versión anterior: Sprint 4, sin tenancy, sin perfil de empresa, sin estudio de creadores. Con cambios sin confirmar del Assessment (ya presente confirmado en GitHub) y los dos Blueprints `.docx` en `docs/blueprints/` |

Consecuencias:
- `docs/blueprints/` **solo existe** en la copia del escritorio y no está versionado en GitHub. Hay que decidir dónde vive; hasta entonces, el escritorio es su única copia.
- Cualquier trabajo nuevo debe partir de GitHub `main` para no reabrir lo ya hecho.
- Ramas abiertas en GitHub al 2026-11-05: `fix/spike-revoked-session-a1` (corrección A1/B4, sin PR abierto por Claude) y `docs/handoff-master-status` (este documento, local). Hay además ramas históricas (`ci/linux-validation*`, `master`).

## 8. Cómo se calculó el porcentaje

Escala por capacidad: **1** terminada y verificada · **0.75** terminada con contenido o validación pendiente · **0.5** funciona con límites reales · **0.25** solo demostración con datos simulados · **0** no existe.

| # | Capacidad | Valor |
|---|-----------|------:|
| 1 | Plataforma Workers y CI (Preview sí, producción no) | 0.75 |
| 2 | Interfaz base, navegación, 8 idiomas y SEO | 1 |
| 3 | Landing y Pricing | 0.75 |
| 4 | Dashboard | 0.25 |
| 5 | NEX chat | 0.25 |
| 6 | Business Assessment v0 (sin guardar) | 0.5 |
| 7 | Autenticación | 0.5 |
| 8 | Tenancy, RLS y API de perfil | 0.5 |
| 9 | Pantalla de perfil de empresa | 0.5 |
| 10 | Estudio de creadores (YouTube) | 0.5 |
| 11–17 | Sales, Clients, Properties, Automation, Finance, Analytics, Settings (resto) | 0.25 × 7 |
| 18 | AI Studio | 0 |
| 19 | Marketplace | 0 |
| 20 | Academy | 0 |
| 21 | Conexión real de IA | 0 |
| 22 | Exportación, borrado, onboarding e invitaciones | 0 |
| 23 | Producción (dominio, caché, legal) | 0 |
| 24 | Calidad: pruebas unitarias sí, E2E no | 0.5 |
| | **Total** | **7.75 / 24 ≈ 32 %** |

Es una estimación mía con una rúbrica abierta: cada fila se puede discutir. Mide **cuánto del catálogo existe de verdad**, no el esfuerzo restante; los módulos de demostración pesan poco porque su parte difícil (datos reales) está sin hacer.

## 9. Qué priorizar para lanzar la versión 1.0 (MVP con Nova)

Tomado de `STATE.md` §6 y de la ruta gradual de ADR-0006; el orden es una recomendación, no una decisión tomada.

1. **Cerrar el spike con Go o No-Go con evidencia** (`RESULTADO.md`): fusionar la corrección A1/B4, desplegar al Preview, probar `revoke` y renovación (B3), configurar SMTP, recuperar los tipos (D31). Nada de lo siguiente es fiable sin esto.
2. **Decisiones bloqueantes de datos reales:** región, retención, eliminación y entorno (ADR-0006) más el análisis legal. Son de negocio, no de código, y gobiernan el calendario.
3. **Fase 2 de ADR-0006:** guardar el Assessment en el perfil (opt-in), **exportación y borrado del perfil**, alta de empresas y membresías sin SQL manual.
4. **Persistir por tenant el estudio de creadores** y decidir con Nova qué falta (campos, etapas, formato de guion) — es el caso de uso del piloto.
5. **Conectar NEX de verdad** (`lib/ai/`, Workers AI, AI Gateway), mostrando el aviso solo en respuestas simuladas (D8) y corrigiendo D27 y D28 antes.
6. **Datos reales en Clients y Sales** (empezando por ellos, según `STATE.md`).
7. **Endurecimiento previo al piloto:** cabeceras de seguridad (A8), límite de tasa, tests E2E (D5), dependencias (D17), formato (D15).
8. **Fase 3: piloto con Nova** como empresa normal, por invitación (1–3 usuarios), cuando se cumplan las cuatro condiciones de §6.
9. **Producción** (D21, D23, D25) solo después, con aprobación explícita (`AGENTS.md` §7.11).

**Fuera del camino a la 1.0 según los documentos actuales:** Marketplace, Academy, AI Studio, verticales y agentes IA (Blueprints, Fases 4–6). Siguen diseñados, sin fecha.

## 10. Cosas que no sé

- Si la última versión del Worker `kynova-os-preview` figura como desplegada desde el dashboard o desde Wrangler (explicaría el fallo del deploy); no tengo acceso a la cuenta de Cloudflare.
- Si el "Deploy Preview" vuelve a pasar tras la subida de Wrangler y `keep_vars`; no se ha vuelto a ejecutar.
- Si `RESULTADO.md` en `main` ya refleja B1 y B5 como PASS: no, todavía no; esa reconciliación vive en la rama de la corrección A1/B4.
- Qué contiene exactamente la copia de `KYNOVA OS` del escritorio frente a GitHub más allá de lo comprobado (historiales sin relación; no se comparó archivo por archivo).
- Cuál de los dos conjuntos de nombres de plan es el definitivo.
