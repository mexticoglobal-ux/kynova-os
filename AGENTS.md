# AGENTS.md — KYNOVA AI Framework (KAF) v1

> Fuente única de reglas para cualquier agente de IA que trabaje en este repositorio.
> Código e identificadores en inglés. Documentación y comunicación en español.

## 1. Identidad

**KAF** es el framework de ingeniería de **KYNOVA OS**, el sistema operativo de negocio con IA (asistente: **NEX**).
KAF convierte a la IA en un equipo de ingeniería disciplinado: piensa antes de actuar, reutiliza antes de crear
y protege la arquitectura en cada cambio.

## 2. Misión

Entregar cambios correctos, verificados y coherentes con la arquitectura, con el mínimo contexto y coste posibles,
dejando el proyecto en un estado más claro que el que se encontró.

## 3. Principios

1. **Pensar antes de editar.** Toda tarea M o L tiene una decisión aprobada antes del primer cambio.
2. **Reutilizar > extender > crear.** Crear exige justificar por qué lo existente no sirve.
3. **Una fuente de verdad.** Cada regla, decisión o esquema vive en un solo lugar; el resto lo referencia.
4. **Determinista antes que generativo.** Lo que puede verificar una herramienta no lo juzga el modelo.
5. **Proporcionalidad.** El proceso escala con el tamaño y el riesgo de la tarea, nunca al revés.
6. **El código es la verdad.** Precedencia ante conflicto: código > ADR vigente > STATE.md > memoria personal.
7. **Contexto mínimo.** Cargar solo lo que la tarea necesita; buscar antes de leer archivos completos.

## 4. Flujo de trabajo

Cada tarea pasa por dos fases. La **fase Brain** analiza y decide; no edita archivos.

| # | Paso | Fase | Resultado |
|---|------|------|-----------|
| 1 | Comprender | Brain | Intención clara; supuestos declarados; preguntas solo si cambian el resultado |
| 2 | Clasificar | Brain | Tipo · tamaño (S/M/L) · banderas de riesgo |
| 3 | Contextualizar | Brain | Solo el contexto necesario (STATE, ADRs, código relevante) |
| 4 | Proteger | Brain | Chequeo de duplicación y de reglas no negociables |
| 5 | Decidir | Brain | Brief: alcance, workflow, Skills, agentes, criterios de terminado |
| 6 | Aprobar | Brain | Gate humano según la tabla de workflows |
| 7 | Ejecutar | Ejecución | Cambios mínimos dentro del alcance aprobado |
| 8 | Verificar | Brain | Typecheck, lint, tests y build en verde + criterios cumplidos |
| 9 | Memorizar | Brain | Actualizar MEMORY si cambió estado, decisiones o dominio |

**Workflows**

| Workflow | Cuándo | Secuencia | Gate |
|----------|--------|-----------|------|
| W1 Rápido | S sin banderas | Ejecutar → verificar | No |
| W2 Estándar | M | Brief → ejecutar → verificar → revisión → cierre | Solo con banderas |
| W3 Arquitectónico | L o bandera de datos/auth/infra | Explorar → plan + ADR → aprobar → fases → revisión + seguridad → cierre | Siempre |
| W4 Incidente | Fallo en producción | Reproducir → causa raíz → fix mínimo → test de regresión → cierre | Antes de desplegar |
| W5 Investigación | Preguntas, análisis, comparativas | Analizar → responder con recomendación; sin editar | No |

## 5. Clasificación de tareas

| Tamaño | Criterio | Workflow |
|--------|----------|----------|
| **S** | 1–2 archivos, sin decisiones, reversible en minutos | W1 |
| **M** | Varios archivos de un área, patrón ya conocido | W2 |
| **L** | Varias áreas, patrón nuevo o decisión estructural | W3 |

**Banderas de riesgo** (elevan el tamaño automáticamente):

| Bandera | Mínimo |
|---------|--------|
| Datos, migraciones, RLS o aislamiento por tenant | L + ADR |
| Autenticación o permisos | L + revisión de seguridad |
| Secretos, entornos o producción | M + aprobación |
| Nueva dependencia o carpeta de primer nivel | M + justificación (ADR si es estructural) |
| Prompts de NEX | M + evals |
| Contrato público (`lib/contracts/`, API) | M |

## 6. Roles de los agentes

| Rol | Responsabilidad | Cuándo interviene |
|-----|-----------------|-------------------|
| **Brain** (sesión principal) | Analiza, decide, orquesta, verifica y mantiene la memoria | Siempre |
| **Explorer** | Localiza código en áreas amplias o desconocidas; devuelve conclusiones, no archivos | Búsquedas que llenarían el contexto principal |
| **Planner** | Evalúa alternativas y propone el plan por fases | Tareas L con varias opciones reales |
| **Reviewer** | Revisa el diff contra RULES y criterios de terminado | Cierre de toda tarea M y L |
| **Security** | Revisa riesgos de auth, datos, secretos y superficies públicas | Tareas con banderas de seguridad o datos |

Los agentes no se comunican entre sí: el Brain delega con una misión autocontenida y valida cada resultado.
Delegar solo cuando el ruido evitado en el contexto principal supera el coste de arrancar el agente.

## 7. Reglas no negociables

1. **Tenancy:** todo dato de cliente está aislado por tenant mediante RLS; ninguna consulta sin contexto de tenant.
2. **IA:** toda llamada a modelos pasa por `lib/ai/` y AI Gateway; nunca se invoca un proveedor directamente.
3. **Datos:** todo acceso a datos pasa por `lib/db/`; los tipos de base de datos se generan, no se escriben a mano.
4. **Contratos:** los esquemas compartidos viven solo en `lib/contracts/`.
5. **Módulos:** un módulo no importa internals de otro; se comunican mediante contratos.
6. **Secretos:** nunca en el repositorio, en logs ni en prompts; solo en Wrangler o GitHub secrets.
7. **Estructura:** ninguna carpeta de primer nivel ni dependencia relevante sin ADR.
8. **Decisiones:** un ADR vigente se respeta o se sustituye con un nuevo ADR; nunca se ignora.
9. **Verificación:** nada se da por terminado sin typecheck, lint, tests y build en verde.
10. **Honestidad:** reportar fallos, pasos omitidos y supuestos tal como son.
11. **Producción:** ningún despliegue, migración o escritura externa sin aprobación explícita.

## 8. Referencias

| Recurso | Ubicación | Contenido |
|---------|-----------|-----------|
| **CLAUDE.md** | `CLAUDE.md` | Integración específica de Claude Code: modo plan, agentes nativos, hooks |
| **RULES** | `.claude/rules/` | Estándares por área (`ui`, `api`, `ai`, `data`); se aplican según la ruta tocada |
| **MEMORY · Estado** | `docs/STATE.md` | Foco actual, trabajo en curso y deuda técnica |
| **MEMORY · Decisiones** | `docs/decisions/` | ADRs numerados; leer los relevantes antes de cambios estructurales |
| **MEMORY · Dominio** | `docs/DOMAIN.md` | Glosario, tenants, módulos y NEX |
| **MEMORY · Módulos** | `docs/modules/` | Una página por módulo de negocio |
| **FRAMEWORK** | `framework/` | Catálogo, versión, workflows detallados, estándares complementarios y plantillas; RULES prevalece |
