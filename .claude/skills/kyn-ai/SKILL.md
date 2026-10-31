---
name: kyn-ai
description: Diseña y ejecuta cambios en la capa de IA de KYNOVA OS — capacidades y herramientas de NEX, prompts de producto, evals, registro de modelos, proveedores (Workers AI y otros) y AI Gateway. Úsalo siempre que una tarea cree o cambie lo que NEX dice o hace, un prompt, un modelo, un proveedor o una llamada a un LLM, aunque el usuario solo diga "NEX", "asistente", "IA", "prompt", "modelo" o "que responda mejor".
---

# kyn-ai

## Propósito
Construir capacidades de IA seguras, intercambiables entre proveedores, medibles con evals y controladas en coste.

## Cuándo usarlo
- Crear o cambiar una capacidad o herramienta de NEX.
- Crear o modificar un prompt de producto o sus evals.
- Añadir o cambiar un modelo, un proveedor o la configuración de AI Gateway.
- Crear o modificar la API de NEX.
- Como paso de `kyn-module` cuando el módulo incorpora IA.

## Cuándo NO usarlo
- Cambios de UI del chat de NEX que no alteran su comportamiento.
- Persistencia de datos de IA: el esquema corresponde a `kyn-data`.
- Preguntas generales sobre modelos sin cambio en el producto (workflow W5).

## Entradas
- Capacidad requerida: qué debe lograr el usuario y qué no debe ocurrir nunca.
- Datos que la capacidad necesita y su sensibilidad.
- Acciones con efectos que podría ejecutar NEX.
- Requisitos de latencia, calidad y coste.
- Estado actual: `docs/STATE.md`, ADRs de IA vigentes, registro de modelos, prompts y evals existentes.

## Procedimiento
1. Clasificar como mínimo **M**; elevar a **L** si añade herramientas con efectos, proveedores nuevos o datos sensibles.
2. Leer `docs/STATE.md`, los ADRs de IA relevantes, el registro de modelos y los prompts y evals existentes de la capacidad.
3. Buscar capacidades, prompts o herramientas existentes reutilizables.
4. Definir el contrato de la capacidad en `lib/contracts/`: entrada, salida estructurada y errores.
5. Seleccionar el modelo y el proveedor de respaldo desde el registro; añadir una entrada solo si ninguna sirve.
6. Diseñar o modificar el prompt en `prompts/` con nueva versión, separando instrucciones de datos.
7. Definir o actualizar los evals: casos nominales, límite, inyección de instrucciones, mezcla entre tenants y fallo de proveedor.
8. Definir herramientas de NEX con mínimo privilegio, alcance de tenant y confirmación obligatoria para acciones con efectos.
9. Presentar el brief con contrato, modelo, prompt, evals, herramientas y límites; esperar aprobación si hay banderas o el tamaño es L.
10. Implementar la capacidad exclusivamente a través de la interfaz de proveedor de `lib/ai/` y de AI Gateway.
11. Validar y sanear la salida del modelo contra el contrato antes de devolverla o usarla.
12. Configurar timeouts, reintentos acotados, respaldo, límites de tokens y presupuesto por tenant.
13. Registrar modelo, tokens, latencia, coste y tenant sin contenido sensible.
14. Exponer la capacidad por la API de NEX con streaming cuando la respuesta sea larga.
15. Ejecutar los evals con el proveedor principal y con el de respaldo.
16. Ejecutar typecheck, lint, tests y build.
17. Ejecutar `/security-review` si hay herramientas, acciones con efectos o datos sensibles.
18. Entregar el cierre a `kyn-ship`.

## Checklist
- [ ] Clasificación correcta y aprobación obtenida cuando aplica.
- [ ] Reutilización evaluada.
- [ ] Contrato de entrada, salida y errores en `lib/contracts/`.
- [ ] Modelo y respaldo tomados del registro.
- [ ] Prompt versionado en `prompts/` con instrucciones separadas de datos.
- [ ] Evals con casos nominales, límite, inyección, mezcla entre tenants y fallo de proveedor.
- [ ] Llamadas solo por `lib/ai/` y AI Gateway.
- [ ] Salida validada y saneada.
- [ ] Herramientas con mínimo privilegio y confirmación para acciones con efectos.
- [ ] Timeouts, respaldo, límites y registro de uso configurados.
- [ ] Evals en verde con ambos proveedores.

## Definición de terminado
Evals en verde con el proveedor principal y el de respaldo, typecheck, lint, tests y build en verde,
`/security-review` sin hallazgos altos o críticos cuando aplica, y ninguna llamada a modelos fuera de
`lib/ai/` ni de AI Gateway.

## Salida
- Contrato de la capacidad en `lib/contracts/`.
- Prompt versionado en `prompts/` y evals en `prompts/evals/`.
- Implementación en `lib/ai/` y, si aplica, en la API de NEX.
- Entrada nueva o actualizada en el registro de modelos si aplica.
- Resumen para `kyn-ship`: capacidad, versión de prompt, resultados de evals por proveedor, límites configurados y riesgos aceptados.
