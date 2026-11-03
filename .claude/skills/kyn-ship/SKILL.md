---
name: kyn-ship
description: Cierra cualquier tarea M o L de KYNOVA OS — verifica (typecheck, lint, tests, evals, build), revisa el diff, actualiza la memoria del proyecto (STATE, ADRs, dominio, módulos), crea commit y pull request, y despliega solo con aprobación explícita. Úsalo al terminar una implementación o cuando el usuario diga "cierra", "termina", "commit", "PR", "sube los cambios", "publica" o "despliega".
---

# kyn-ship

## Propósito
Convertir trabajo terminado en un cambio verificado, revisado, documentado y entregado de forma segura.

## Cuándo usarlo
- Al finalizar cualquier tarea M o L.
- Al cerrar `kyn-data`, `kyn-ai` o `kyn-module`.
- Cuando se solicita commit, pull request o despliegue.
- Al interrumpir una tarea que debe quedar registrada para retomarla.

## Cuándo NO usarlo
- Tareas S: basta con la verificación de los hooks.
- Investigación o análisis sin cambios (workflow W5).
- Mientras haya verificaciones en rojo que no se han corregido.

## Entradas
- Brief aprobado de la tarea: objetivo, alcance y criterios de terminado.
- Cambios pendientes en el repositorio.
- Resúmenes de cierre de los Skills aplicados.
- Banderas de riesgo de la tarea.
- Destino solicitado: solo commit, pull request o despliegue (preview o producción).

## Procedimiento
1. Revisar el estado de git y el diff completo.
2. Confirmar que el diff se ajusta al alcance aprobado; revertir o separar lo que esté fuera de alcance.
3. Confirmar que el diff no contiene secretos, archivos locales de entorno, artefactos de build ni archivos comprimidos.
4. Ejecutar typecheck, lint, tests y build; ejecutar evals si cambiaron prompts o capacidades de IA.
5. Si una verificación no existe todavía en el proyecto, registrarla como omitida en la salida y como deuda en `docs/STATE.md`.
6. Si alguna verificación falla, detener el cierre, corregir dentro del alcance y repetir desde el paso 4.
7. Ejecutar `/code-review` y resolver los hallazgos dentro del alcance.
8. Ejecutar `/security-review` si la tarea tiene banderas de seguridad, datos, auth, secretos o API pública.
9. Verificar los criterios de terminado del brief uno por uno.
10. Actualizar la memoria solo donde cambió algo:
    `docs/STATE.md` para foco, estado de módulos, trabajo en curso y deuda;
    `docs/decisions/` para ADRs nuevos o sustituidos;
    `docs/DOMAIN.md` para conceptos de dominio;
    `docs/modules/<módulo>.md` para alcance o contratos de módulos.
11. Si la tarea queda interrumpida, registrar en "En curso" de `docs/STATE.md` objetivo, hecho, pendiente y siguiente paso, y terminar aquí.
12. Trabajar en una rama de la tarea, nunca directamente en la rama principal.
13. Crear commits atómicos con mensajes en formato Conventional Commits, en inglés y en modo imperativo.
14. Crear el pull request con la plantilla del repositorio: objetivo, alcance, verificación, riesgos, ADRs y pendientes.
15. Desplegar solo con aprobación explícita y en este orden:
    migraciones de expansión aprobadas, despliegue de la aplicación, verificación posterior y, en una entrega posterior, migraciones de contracción.
16. Tras desplegar, verificar el entorno de destino y reportar el resultado.

## Checklist
- [ ] Diff dentro del alcance aprobado.
- [ ] Sin secretos ni artefactos en el diff.
- [ ] Typecheck, lint, tests y build en verde.
- [ ] Evals en verde si cambió la IA.
- [ ] Verificaciones inexistentes reportadas y registradas como deuda.
- [ ] `/code-review` ejecutado y hallazgos resueltos.
- [ ] `/security-review` ejecutado cuando aplica.
- [ ] Criterios de terminado del brief cumplidos.
- [ ] Memoria actualizada solo donde cambió algo.
- [ ] Rama de tarea, commits atómicos y mensajes conformes.
- [ ] Pull request completo.
- [ ] Despliegue solo con aprobación y en el orden establecido.

## Definición de terminado
Verificaciones en verde o explícitamente reportadas como inexistentes, revisiones ejecutadas sin
hallazgos altos o críticos abiertos, criterios del brief cumplidos, memoria del proyecto coherente con
el código, cambios entregados en commit o pull request, y despliegue realizado y verificado solo
cuando fue aprobado.

## Salida
Informe de cierre con:
- Objetivo y alcance entregado.
- Resultado de cada verificación: verde, rojo u omitida con motivo.
- Hallazgos de revisión resueltos y aceptados.
- Archivos de memoria actualizados.
- Commits y enlace del pull request.
- Estado del despliegue y verificación posterior, si hubo.
- Pendientes, riesgos aceptados y siguiente paso recomendado.
