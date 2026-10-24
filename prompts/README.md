# Prompts de producto de NEX

> Fuente normativa: `.claude/rules/ai.md` y `framework/standards/ai.md`. Este documento define la estructura y el formato; no repite las reglas.
> Autorizado por `docs/decisions/0003-carpeta-prompts-y-evals-de-nex.md`.

## Estructura

| Ruta | Contenido |
|------|-----------|
| `prompts/<módulo>/<capacidad>.md` | Un prompt por capacidad de NEX |
| `prompts/evals/<módulo>/<capacidad>.yaml` | Suite de evals de esa capacidad |
| `prompts/evals/fixtures/` | Datos ficticios de tenants usados por las suites |
| `prompts/_template.md` | Plantilla de prompt |
| `prompts/evals/_template.yaml` | Plantilla de suite de evals |

`<módulo>` usa el nombre del documento en `docs/modules/`; `<capacidad>` va en `kebab-case`.

## Formato de un prompt

### Cabecera obligatoria
| Campo | Contenido |
|-------|-----------|
| `id` | `nex.<módulo>.<capacidad>`; estable durante toda la vida del prompt |
| `version` | SemVer según `framework/standards/ai.md` |
| `status` | `draft` · `active` · `deprecated` |
| `module` | Módulo propietario |
| `autonomy` | `informar` · `sugerir` · `ejecutar-con-confirmacion` |
| `model` | Clave del registro de modelos de `lib/ai/`, nunca un identificador de proveedor |
| `input_contract` | Contrato de entrada en `lib/contracts/` |
| `output_contract` | Contrato de salida en `lib/contracts/` |
| `evals` | Ruta de su suite de evals |
| `owner` | Responsable del prompt |

### Secciones obligatorias
1. **Propósito:** qué resuelve la capacidad y para quién.
2. **Instrucciones del sistema:** comportamiento, tono y límites.
3. **Variables:** cada variable con su origen y si es confiable o no confiable.
4. **Formato de salida:** cómo cumple el contrato de salida.
5. **Restricciones:** lo que la capacidad nunca debe hacer.
6. **Historial:** versión, fecha y cambio, de la más reciente a la más antigua.

## Convenciones
1. Variables con la sintaxis `{{nombre}}`; los datos no confiables se insertan siempre dentro de delimitadores explícitos que el prompt declara como datos.
2. Un prompt no contiene datos de ningún tenant real ni secretos.
3. Un prompt en `active` no se edita sin subir su versión y actualizar su historial.
4. Cada cambio de versión ejecuta su suite de evals antes de fusionarse.
5. Un prompt `deprecated` indica su reemplazo y se elimina cuando ningún código lo referencia.
6. Los prompts se escriben en el idioma en que NEX responde por defecto; la localización se gestiona con variables, no con copias del prompt.
