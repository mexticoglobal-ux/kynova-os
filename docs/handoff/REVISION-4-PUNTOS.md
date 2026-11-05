# Revisión del handoff: cuatro puntos de validación

> Fecha: **2026-11-05** · Base revisada: `main` en `6aaaeff` + este PR.
> Responde a la petición de validar `KYNOVA-MASTER-STATUS.md` y `KYNOVA-HANDOFF.md` antes de convertirlos en referencia oficial.
> Lo comprobado está separado de lo supuesto. Las propuestas están marcadas y no cambian nada hasta que se decidan.

## Resumen

| Punto | Veredicto |
|-------|-----------|
| 1. ¿El código coincide con el handoff? | **Sí, con dos correcciones aplicadas en este PR** (un exceso sobre Auth y un "terminado" que era parcial) |
| 2. ¿El roadmap refleja la visión actual? | **No del todo.** El roadmap viene de `STATE.md` (orientado a módulos y datos); la visión actual coloca a NEX como el producto. Propuesta de resecuenciación abajo |
| 3. ¿La arquitectura soporta un Agente de IA 24/7? | **Hoy no. La plataforma lo permite, pero no hay nada construido del lado del agente**, y una regla vigente lo contradice |
| 4. ¿Hay funcionalidades "terminadas" que son solo Blueprint? | **No hay ninguna del Blueprint declarada como terminada.** Sí había una pieza parcial contada como terminada (corregida) |

---

## 1. Código frente al handoff

**Comprobado contra el árbol de `main`** (sin ejecutar el producto):
- Rutas: 6 públicas y 10 de aplicación; `config/site.ts` define 8 módulos y la navegación.
- Módulos de demostración: cada uno tiene `lib/modules/<módulo>/data.ts` y se muestra con `ModuleView`.
- NEX: `lib/nex.ts` responde por palabras clave con retardo de 900 ms; no existen `lib/ai/`, `prompts/` de producto ni `app/api/nex/`.
- Datos: `tenants`, `memberships`, `business_profiles` y `spike_items`; funciones `private.is_member`, `is_owner`, `touch_updated_at`; RLS por operación.
- APIs: `GET`/`PUT /api/profile`, `GET /api/spike/items`, `POST` `request`/`verify`/`sign-out` y `GET` `callback` bajo `/api/spike/auth/`.
- Dependencias, scripts y variables de entorno: copiados de `package.json` y `.dev.vars.example`.
- Cifras: 22 archivos y 234 tests en `main`; Worker de 7,006.79 KiB sin comprimir (medido en CI en una compilación anterior; una compilación posterior en local dio 7,233.01 KiB, sigue muy por debajo de 64 MiB).

**Correcciones aplicadas en este PR**

| # | Había escrito | Realidad | Corrección |
|---|---------------|----------|------------|
| 1 | "Auth funciona con código OTP y enlace mágico en el Preview" | El OTP se verificó en el Preview con A, B y C. El enlace mágico (callback PKCE) está implementado y probado **solo con un cliente de Supabase simulado**; no hay evidencia de un enlace real en el Preview | Master Status §1 y §3 ajustados |
| 2 | "Marco KAF v1" listado como completamente terminado | Los hooks de `.claude/hooks/` no están verificados (D4; en esta sesión `verify.mjs` falla con `MODULE_NOT_FOUND`) y `.mcp.json` no existe | Movido de "terminado" a "parcial" |

**Supuestos que sigo sin poder verificar:** que el Preview desplegado hoy sea el mismo que el último que pasó el despliegue (no tengo acceso a Cloudflare); que el aislamiento A/B/C observado en capturas se repita (evidencia manual del usuario); el contenido de la copia del escritorio más allá de lo comparado.

## 2. Roadmap frente a la visión

**Qué dice la visión actual:** KYNOVA es un Agente de IA Empresarial que trabaja 24/7; CRM, Marketing, SEO, YouTube, documentos, automatizaciones, Academy y Marketplace son herramientas que usa NEX.

**Qué dice el roadmap del handoff (§24):** cierra el spike (5), decisiones y endurecimiento (6), perfil completo (7), piloto Creator (8), **NEX real (9)**, datos de CRM (10), piloto con Nova (11), producción (12).

**El desajuste:** el roadmap trata a NEX como un sprint intermedio y a los módulos como el producto. Con la visión actual, ese orden entrega al piloto de Nova un conjunto de herramientas sin el agente que debería usarlas. Viene de `STATE.md` §6, escrito antes de esta visión.

**Resecuenciación aprobada por Jeffrey Hernandez (2026-11-05) y aplicada en `KYNOVA-HANDOFF.md` §24 y `KYNOVA-MASTER-STATUS.md` §9.** La tabla siguiente es la propuesta original; el detalle final está en esos documentos (el endurecimiento y el turno de noche quedaron en sprints propios):

| Orden | Cambio | Razón |
|-------|--------|-------|
| 5 | Sin cambios: cerrar el spike | Identidad, sesión y tenancy son la base de cualquier agente |
| 6 | **Nuevo: fundamentos del agente** — ADRs de identidad del agente, autonomía, memoria, ejecución en segundo plano y registro de acciones | Sin ellos no se puede construir NEX real ni cumplir la regla 12 de `.claude/rules/ai.md` |
| 7 | **NEX real mínimo** (`lib/ai/`, AI Gateway, lectura del perfil y del Assessment, informe matutino), solo lectura | Primera prueba de "alguien trabaja en mi negocio" sin riesgo de acciones |
| 8 | Perfil completo, exportación y borrado (sin cambios, pero ya necesarios para datos reales) | Condiciones de ADR-0006 |
| 9 | Herramientas del agente, una a una: primero el estudio de creadores (ya existe) persistido por tenant y expuesto a NEX por contrato | Es el caso de uso del piloto |
| 10+ | CRM, producción y el resto como herramientas de NEX | Siguen igual |

## 3. Arquitectura frente a un Agente de IA 24/7

**Qué necesita un agente continuo y qué hay hoy**

| Capacidad | Hoy | Primitivas disponibles (documentación oficial) |
|-----------|-----|-----------------------------------------------|
| Ejecutar trabajo sin que el usuario esté conectado | ❌ Nada: el Worker solo atiende peticiones; `wrangler.jsonc` no tiene `triggers` ni colas | [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [alarmas de Durable Objects](https://developers.cloudflare.com/durable-objects/api/alarms/) y Workflows (no revisé sus límites actuales) |
| Punto de entrada compatible | ⚠ El worker que genera OpenNext solo expone `fetch` | OpenNext documenta un [worker personalizado](https://opennext.js.org/cloudflare/howtos/custom-worker) que reutiliza `fetch` y añade `scheduled` |
| **Identidad del agente dentro de un tenant** | ❌ Todo acceso a datos usa el JWT de un usuario; sin usuario no hay JWT. La migración revoca **todos** los privilegios a `service_role` a propósito | Requiere decisión: una identidad de servicio por tenant con mínimo privilegio (ADR) |
| Capa de IA | ❌ `lib/ai/`, AI Gateway y registro de modelos no existen | Reglas ya escritas en `.claude/rules/ai.md` |
| Memoria del negocio | ⚠ Solo el perfil v1 (seis respuestas cerradas); sin memoria persistente ni historial de decisiones | ADR-0006 prevé `assessment_runs`; el resto no está diseñado |
| Herramientas del agente (contratos) | ❌ No hay registro de herramientas; los módulos son vistas con datos de ejemplo | Diseñable sobre `lib/contracts/` (regla: módulos solo se comunican por contratos) |
| Cola de decisiones pendientes del usuario | ❌ | — |
| Registro auditable de acciones del agente | ❌ | Exigido por `framework/standards/ai.md` ("Preparación Enterprise") |
| Canal de aviso al usuario (informe matutino, urgencias) | ❌ Sin SMTP propio ni notificaciones | — |
| Presupuesto, límites y corte por tenant | ❌ | Exigido por la regla de IA (puntos 13–14) |
| Parada de emergencia del agente | ❌ | — |

**Conclusión.** La arquitectura actual soporta un **asistente reactivo** (petición → respuesta). No soporta aún un **agente continuo**. Nada de lo elegido (Workers, Supabase, OpenNext) lo impide, y Cloudflare documenta las primitivas de ejecución en segundo plano; pero ninguna está construida, ninguna tiene ADR y no he probado su combinación con OpenNext, que la propia documentación presenta como un patrón aparte (worker personalizado).

**Una contradicción normativa que hay que resolver antes de construir.** La visión del agente 24/7 implica que NEX decida y actúe sin estar el usuario delante. Las reglas vigentes dicen lo contrario:
- `.claude/rules/ai.md`, regla 12: "Toda acción de NEX con efectos requiere confirmación explícita del usuario."
- `framework/standards/ai.md`: el nivel más alto es "Ejecutar con confirmación **por acción**"; "ningún nivel permite ejecutar acciones con efectos sin confirmación".
- `docs/DOMAIN.md` §3: igual.

No es un detalle: o se mantiene la confirmación por acción (y el agente 24/7 solo prepara y propone), o se introduce un mecanismo explícito de autorización permanente (el dueño aprueba por adelantado una política acotada). Lo segundo exige un ADR que modifique esas tres fuentes. La Constitución propuesta marca esta decisión como **abierta**; no la da por tomada.

## 4. ¿Hay "terminados" que sean Blueprint?

Revisé cada afirmación de "terminado" y "funciona" de los dos documentos contra el código y `RESULTADO.md`.

- Nada de lo que solo existe en los Blueprints (Business DNA, KYNOVA Score, verticales, capacidades, agentes, Marketplace de agentes, aprendizaje por industria) aparece como terminado ni como funcionando: está en "solo diseñado".
- Las afirmaciones de los Blueprints sobre el Core ("ya cuenta con autenticación, roles, CRM, Marketplace, Academy, AI Studio") están marcadas como **no fiables**, con lo que hay en el código.
- Se detectaron y corrigieron dos excesos (sección 1): el enlace mágico y el marco KAF.
- Sigue siendo evidencia manual, no automática, y está así rotulada: el aislamiento A/B/C en el Preview y las cookies `sb-*` seguras (B1) y `no-store` autenticado (B5), observados por el usuario.

## Decisiones que esta revisión deja abiertas

1. ~~Aprobar o ajustar la resecuenciación del roadmap (§2).~~ **Aprobada (2026-11-05).**
2. ~~Elegir entre confirmación por acción y autorización permanente acotada (§3).~~ **Decidido: autonomía por niveles** (Constitución, Artículo 7). Falta el ADR que modifica la regla 12 de `.claude/rules/ai.md`, `framework/standards/ai.md` y `DOMAIN.md` §3; hasta entonces sigue vigente la confirmación por acción.
3. Decidir el diseño de la identidad del agente dentro de un tenant (§3), con su ADR.
4. Decidir dónde vive `docs/blueprints/` (hoy solo en la copia del escritorio).
