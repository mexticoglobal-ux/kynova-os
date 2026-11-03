---
description: Crea un ADR nuevo en estado Propuesto a partir de la plantilla oficial.
argument-hint: <decisión a registrar>
---

Decisión: $ARGUMENTS

1. Sigue el procedimiento de `framework/templates/adr.md`.
2. Antes de redactar, busca en `docs/decisions/` ADRs vigentes sobre el mismo tema; si existe uno, propón sustituirlo en lugar de crear uno paralelo.
3. Toma el contexto del código real, `docs/STATE.md` y la conversación; no inventes datos: marca lo desconocido como pregunta abierta en Contexto o Riesgos.
4. Crea el archivo con estado **Propuesto**; solo puedes editar `docs/decisions/`.
5. Si `docs/STATE.md` cita el número de ADR para otro tema, avisa de la colisión en tu respuesta sin modificar `STATE.md`.
6. Responde con la ruta del ADR, la decisión propuesta en una frase y lo que falta para aprobarlo.
