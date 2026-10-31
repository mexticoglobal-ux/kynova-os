# Evals de NEX

> Fuente normativa: `.claude/rules/ai.md` y `framework/standards/ai.md` (dimensiones y umbrales). Este documento define el formato de las suites y el runner.

## Suites

Una suite por capacidad en `prompts/evals/<módulo>/<capacidad>.yaml`, creada desde `_template.yaml`.

### Cabecera
| Campo | Contenido |
|-------|-----------|
| `suite` | Igual al `id` del prompt |
| `prompt` | Ruta del prompt evaluado |
| `prompt_version` | Versión del prompt contra la que se validó la suite |
| `providers` | Claves del registro de modelos: principal y respaldo |
| `repetitions` | Ejecuciones por caso para absorber la variabilidad del modelo |
| `thresholds` | Umbral mínimo por dimensión, de 0 a 1 |
| `budget` | Límite de tokens y coste por ejecución completa de la suite |

### Umbrales mínimos de plataforma
| Dimensión | Mínimo |
|-----------|--------|
| `formato` | 1.0 |
| `seguridad` | 1.0 |
| `exactitud`, `fidelidad`, `coste_latencia` | Definido por cada suite, nunca inferior a 0.8 |

### Casos
Cada caso declara `id`, `category`, `dimensions`, `input` y `expect`.

**Categorías obligatorias:** toda suite tiene al menos un caso de cada una.

| `category` | Comprueba |
|------------|-----------|
| `nominal` | Uso habitual de la capacidad |
| `limite` | Entradas vacías, extremas, ambiguas o fuera de alcance |
| `inyeccion` | Instrucciones maliciosas dentro de datos no confiables |
| `mezcla_tenants` | Que nunca aparezcan datos de otro tenant |
| `fallo_proveedor` | Comportamiento con timeout o error del proveedor principal |

**Aserciones de `expect`:**

| Tipo | Supera si |
|------|-----------|
| `schema` | La salida cumple el contrato indicado |
| `contains` / `not_contains` | La salida incluye o excluye los textos indicados |
| `refuses` | La capacidad rechaza la petición de forma controlada |
| `grounded` | Toda afirmación se apoya en los datos del fixture |
| `no_foreign_tenant` | No aparece ningún marcador de otro tenant del fixture |
| `requires_confirmation` | La acción con efectos se propone y no se ejecuta |
| `fallback_used` | Responde el proveedor de respaldo cuando falla el principal |
| `max_tokens` / `max_latency_ms` | Consumo y latencia dentro del límite |
| `rubric` | Un modelo evaluador puntúa la salida con la rúbrica indicada por encima del mínimo |

## Fixtures
1. Viven en `prompts/evals/fixtures/` y contienen solo datos ficticios.
2. Cada fixture de tenant incluye marcadores únicos para detectar fugas entre tenants.
3. Las suites referencian fixtures por ruta; nunca los copian.

## Runner

Estado: especificado; se implementa junto a `lib/ai/` (ver ADR-0003).

| Aspecto | Especificación |
|---------|----------------|
| Ubicación | Dentro de la capa de IA, usando su interfaz de proveedor y AI Gateway |
| Comando | Script `evals` de `package.json`, con filtro opcional por suite |
| Ejecución | Cada caso × cada proveedor × `repetitions` |
| Puntuación | Por dimensión: proporción de aserciones superadas |
| Resultado | Informe legible y JSON con puntuaciones, fallos, tokens, latencia y coste |
| Fallo | Código de salida distinto de cero si una dimensión queda por debajo de su umbral o se supera el presupuesto |
| Evaluador | Las aserciones `rubric` usan un modelo distinto del evaluado |
| CI | Obligatorio en todo cambio de `prompts/**` o de la capa de IA |
| Datos | Solo fixtures; nunca datos de tenants reales |
