# Workflow: Bugfix

> Base: `AGENTS.md` §4, workflows W1 (S) y W2 (M). Los fallos en producción siguen `incident.md`.

## Propósito
Corregir defectos desde su causa raíz, con el cambio mínimo y una prueba que impida su regreso.

## Cuándo aplica
Defectos detectados fuera de producción o en producción sin impacto activo sobre usuarios.

## Clasificación

| Caso | Tamaño | Workflow base |
|------|--------|---------------|
| Defecto localizado en 1–2 archivos, sin banderas | S | W1 |
| Defecto en varias piezas de un área | M | W2 |
| Defecto que exige cambiar diseño, datos o contratos | L | Seguir `feature.md` |
| Banderas de riesgo | Según `AGENTS.md` §5 | — |

## Pasos

### 1. Diagnóstico (fase Brain)
1. Registrar el síntoma: comportamiento esperado, comportamiento observado y entorno.
2. Reproducir el fallo de forma determinista.
3. Identificar la causa raíz; no tratar solo el síntoma.
4. Buscar otras ocurrencias del mismo patrón defectuoso.
5. Definir el alcance de la corrección y sus criterios de terminado.

### 2. Corrección
1. Crear la rama de la tarea.
2. Escribir primero una prueba que reproduzca el fallo y falle.
3. Aplicar el cambio mínimo que corrige la causa raíz.
4. Confirmar que la prueba pasa y que no aparecen regresiones.
5. Corregir las otras ocurrencias dentro del alcance o registrarlas como deuda.

### 3. Verificación y revisión
1. Verificación de `AGENTS.md` §7.9 en verde.
2. En M: revisiones según `CLAUDE.md` §7.

### 4. Cierre
- S: verificación por hooks y commit.
- M: aplicar `kyn-ship`.
- Si el defecto revela deuda técnica, registrarla en `docs/STATE.md`.

## Definición de terminado
Fallo reproducido y corregido en su causa raíz, prueba de regresión en verde, sin regresiones,
verificaciones en verde y ocurrencias relacionadas corregidas o registradas.

## Salida
Causa raíz documentada en el commit o pull request, corrección, prueba de regresión y deuda registrada si aplica.
