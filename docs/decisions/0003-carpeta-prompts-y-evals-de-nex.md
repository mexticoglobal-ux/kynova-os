# ADR-0003: Crear la carpeta de primer nivel `prompts/` para los prompts de producto de NEX y sus evals

| Campo | Valor |
|-------|-------|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-22 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | ia · plataforma |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
`.claude/rules/ai.md` exige que los prompts de producto vivan versionados en `prompts/` y que cada prompt tenga evals
en `prompts/evals/`; `framework/standards/ai.md` define el versionado SemVer de prompts, las dimensiones de evaluación
y los niveles de autonomía de NEX. La carpeta no existe y `AGENTS.md` §7 exige un ADR para crear una carpeta de primer nivel.
Todavía no existe `lib/ai/`, por lo que no hay código que ejecute prompts ni evals.

## Problema
¿Dónde y con qué formato viven los prompts de producto de NEX y sus evals para que sean versionables, auditables y
ejecutables por un runner futuro, sin mezclarlos con el código ni con el framework de ingeniería?

## Criterios de decisión
- Separación entre prompts de producto, código y framework de ingeniería.
- Versionado y revisión de prompts como código.
- Formato de evals legible por personas y ejecutable por máquina.
- Independencia del proveedor de IA.

## Opciones consideradas

### Opción A: Carpeta `prompts/` en la raíz con `evals/` dentro
- **Ventajas:** ubicación única ya referenciada por RULES y Skills; prompts y evals evolucionan juntos; fuera del código ejecutable.
- **Inconvenientes:** una carpeta de primer nivel más.
- **Coste y esfuerzo:** bajo.

### Opción B: Prompts dentro de `lib/ai/`
- **Ventajas:** junto al código que los usa.
- **Inconvenientes:** mezcla contenido revisable por negocio con código; contradice `.claude/rules/ai.md`.
- **Coste y esfuerzo:** bajo, con mayor coste de gobierno.

## Decisión
Opción A. Se crea `prompts/` con un prompt por capacidad y `prompts/evals/` con una suite por capacidad, según los
formatos definidos en `prompts/README.md` y `prompts/evals/README.md`. El runner de evals se especifica ahora y se
implementa junto a `lib/ai/`.

## Consecuencias
- **Positivas:** prompts versionados y auditables; evals como puerta de calidad desde el primer prompt.
- **Negativas:** hasta que exista el runner, las suites no se ejecutan automáticamente.
- **Riesgos y mitigaciones:** riesgo de formatos que el runner no pueda consumir, mitigado definiendo los formatos antes de escribir el runner y revisándolos al implementarlo.

## Impacto en el framework
- **Reglas no negociables (`AGENTS.md` §7) afectadas:** ninguna; este ADR cumple la regla 7.
- **RULES afectadas:** ninguna; materializa `.claude/rules/ai.md`.
- **Skills afectados:** `kyn-ai` (usa estos formatos).
- **Módulos afectados:** NEX y AI Studio.

## Plan de implementación
1. Crear `prompts/README.md`, `prompts/_template.md`, `prompts/evals/README.md` y `prompts/evals/_template.yaml`.
2. Registrar los componentes en `framework/REGISTRY.md` y `framework/CHANGELOG.md`.
3. Implementar el runner y el script `evals` de `package.json` junto con `lib/ai/`, en el ADR de la capa de IA.

## Plan de reversión
Eliminar `prompts/` y sus referencias. Reversible sin coste mientras no existan prompts de producto en uso.

## Verificación
- `prompts/` contiene las convenciones y plantillas de prompts y evals.
- La primera capacidad de NEX se entrega con prompt y suite de evals en estos formatos.

## Revisión
Al implementar el runner de evals o al añadir un segundo proveedor de IA.

## Referencias
- `.claude/rules/ai.md`
- `framework/standards/ai.md`
- `.claude/skills/kyn-ai/SKILL.md`
