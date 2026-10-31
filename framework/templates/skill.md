---
name: {{kyn-dominio}}
description: {{Qué hace el Skill, sobre qué dominio de KYNOVA OS y cuándo usarlo, incluyendo las frases con las que el usuario lo pediría aunque no lo nombre. Máximo dos frases.}}
---

# {{kyn-dominio}}

## Propósito
{{Resultado que garantiza el Skill, en una frase.}}

## Cuándo usarlo
- {{Situación 1}}
- {{Situación 2}}

## Cuándo NO usarlo
- {{Situación excluida y Skill o workflow que corresponde}}

## Entradas
- {{Información necesaria antes de empezar}}
- Estado actual: `docs/STATE.md` y ADRs relevantes.

## Procedimiento
1. Confirmar la clasificación mínima del tamaño y el workflow aplicable.
2. Leer el contexto necesario.
3. Buscar componentes existentes reutilizables.
4. {{Pasos específicos del dominio}}
5. Presentar el brief y esperar aprobación cuando aplica.
6. {{Pasos de ejecución}}
7. Ejecutar typecheck, lint, tests y build.
8. Entregar el cierre a `kyn-ship`.

## Checklist
- [ ] Clasificación correcta y aprobación obtenida cuando aplica.
- [ ] Reutilización evaluada.
- [ ] {{Comprobación específica del dominio}}

## Definición de terminado
{{Condiciones verificables que deben cumplirse para considerar terminado el trabajo del Skill.}}

## Salida
- {{Artefactos producidos y su ubicación}}
- Resumen para `kyn-ship`: {{contenido del resumen}}

<!--
Requisitos de alta:
- Nombre con prefijo kyn- y un único dominio.
- Sin solapamiento de disparadores con Skills existentes en framework/REGISTRY.md.
- Máximo 300 líneas; el detalle adicional va en references/ dentro de la carpeta del Skill.
- Referencia RULES y estándares por ruta; no copia su contenido.
- Alta registrada en framework/REGISTRY.md y framework/CHANGELOG.md.
-->
