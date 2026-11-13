# ADR-0031: Autonomous Execution Engine, planes de ejecución completos sin ejecutar nada

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-12 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | nex · ejecución · planes · dag · aprobación humana · rollback · multiempresa · determinismo |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
El Copilot (ADR-0030) ya recomienda y sugiere acciones, pero cada acción es una pieza suelta. Para que una persona pueda aprobar con criterio, y para que más adelante un runtime pueda actuar con barreras, hace falta convertir cada recomendación en un **plan de ejecución** completo: pasos ordenados, quién los haría, qué autorización pide cada uno, qué conector usarían, cómo se deshacen, cuánto cuestan y cuánto tardan. Este sprint construye **una capa nueva**, `lib/nex/execution/`, sin modificar el Backend Core, el Runtime, KOE, Workers, Connectors, el Copilot, el RAG, la Memoria, el Knowledge Graph, el Integration Hub ni el AI Gateway. **No ejecuta nada**: no llama al Runtime, a un Worker ni a un Conector.

## Decisión
1. **Pipeline:** Copilot → RAG → Memoria → Knowledge → KOE → Execution Engine → Execution Plan. El motor recibe lo que el Copilot ya produjo (sus recomendaciones y las acciones sugeridas) y lee, como datos planos, el roster de workers de la empresa, los conectores conectados y las autorizaciones permanentes. No llama a ninguno de ellos.
2. **Un plan por recomendación**, con id determinista `xp:<hallazgo>` (y `#n` en revisiones posteriores), objetivo, prioridad (de la severidad), severidad, impacto esperado, riesgo, beneficio esperado, módulos, workers requeridos, conectores requeridos, autorizaciones requeridas, dependencias entre planes, pasos, rollback, costo de IA y de API estimados, tiempo estimado (el camino crítico del DAG), estado, `createdAt`, `expiresAt` e historial de cambios de estado.
3. **Pasos y DAG:** cada acción del catálogo de la plataforma es un paso con `action`, módulo, worker, nivel de autorización, timeout, reintentos, política de rollback, acción de compensación y estado. Los pasos se ordenan por nivel (preparar antes que actuar): un paso depende de los del nivel inferior más cercano y de sus prerrequisitos conocidos, así que **no puede salir un ciclo**; cualquier arista añadida después se verifica (`addDependency` rechaza ciclos, bucles y ids desconocidos). Los planes también se esperan entre sí (por ejemplo, retención espera a soporte) con un mapa estático y acíclico.
4. **Niveles existentes, a prueba de mentiras:** el nivel de cada paso sale del catálogo de la plataforma (`workers.ts`, decidido en código, lo desconocido es nivel 3), **no** del nivel que traiga la acción de entrada. El rol que aprueba el plan es el del nivel más alto: nivel 1 un miembro, 2 un gestor, 3 un administrador. Los límites dependen del nivel: más riesgo, más tiempo y menos reintentos (nivel 3 no se reintenta).
5. **Rollback preparado, nunca ejecutado:** nivel 1 no tiene nada que deshacer; nivel 2 se compensa; nivel 3 pide revisión manual. Al cancelar un plan en marcha se devuelve, en orden inverso y solo para los pasos ya completados, la lista de compensaciones pedidas.
6. **Nueve estados y nada más:** Draft, WaitingApproval, Approved, Rejected, Running, Paused, Completed, Cancelled y Expired, con una tabla cerrada de cambios permitidos y cada cambio escrito en el historial del propio plan. **Running, Paused y Completed son solo lo que un runtime futuro reporta:** solo el sistema puede iniciar un plan y reportar el resultado de un paso, y este motor únicamente lo registra. Un paso que falla se reintenta según su política y, agotada, pausa el plan para que una persona decida; reanudar le da intentos nuevos. Un plan Running nunca caduca; los demás caducan.
7. **Runtime Adapter** con solo cuatro funciones que devuelven estructuras: `prepareExecution`, `validateExecution` (errores que impiden enviar a aprobación y advertencias para quien aprueba), `assignWorkers` (el worker activo con menos carga cuya especialidad encaje; desempate por id) y `scheduleExecution` (desplazamientos en el tiempo respetando el DAG, un paso a la vez por worker y la espera entre planes).
8. **Permisos antes de construir:** lo que quien prepara no puede ver **no existe** dentro del plan. Una acción de otra empresa, una acción oculta (dinero para quien no es gestor, cifras operativas para un viewer), una recomendación basada en dinero oculto, una acción rechazada, caducada o desconocida se descartan **antes** de construir y se cuentan. Preparar lo puede hacer cualquier persona que no sea viewer, un worker activo o el sistema; aprobar o rechazar, solo una persona con el rol que pide el plan; cancelar, pausar y reasignar, un gestor o el sistema.
9. **Idempotencia:** volver a preparar lo mismo no duplica ni cambia nada; una recomendación con un plan en curso se deja en paz y, si su plan terminó, se crea una nueva revisión.
10. **Datos para un dashboard futuro (sin pantallas):** planes activos, pendientes, completados, cancelados, rechazados y expirados; workers requeridos y disponibles; utilización; carga por worker; tiempo promedio planeado y real; costo de IA y de API; cuellos de botella (worker sobrecargado, paso del que dependen varios, aprobación lenta, plan bloqueado, pasos sin worker) y dependencias.
11. **Multiempresa:** todo se aísla por empresa: planes, workers, estadísticas, métricas e historial. Un tablero solo cuenta planes de su empresa aunque se le entregue uno ajeno por error.
12. **Observabilidad solo con ids y métricas:** los eventos nunca llevan prompts, respuestas, contexto, correos, teléfonos, tokens, secretos ni contenido; el texto libre se descarta antes de guardarse y un plan se nombra por su id.

## Consecuencias
- **Honestidad sobre lo probado:** todo se probó con el Copilot real generando las recomendaciones y acciones de entrada, y con rosters, conectores y autorizaciones de ejemplo. Los costos, tiempos, límites de tiempo y reintentos por nivel, y las dependencias entre planes son **valores de partida míos**.
- **«Running» y «Completed» son bookkeeping:** hoy nada los produce salvo un llamador con rol de sistema. El día que exista un runtime, deberá reportar por este motor, y conectarlo (KOE decide, con autorización vigente y límites, si actúa) es un paso posterior con aprobación propia.
- **Las compensaciones no están en el catálogo:** `<acción>.undo` y `<acción>.manual-review` son nombres propios de esta capa y, si algún día se ejecutan, serán nivel 3 por fallar cerrado.
- **Un plan por recomendación:** no hay fusión de planes ni priorización entre empresas; el orden entre planes sale del planificador.
- **Archivo de un sprint anterior tocado:** únicamente un test: el guard de importadores del Copilot ahora permite `lib/nex/execution` como consumidor; ninguna fuente de esa capa cambió.
- **Pendiente con aprobación propia:** (a) conectar el Copilot y este motor con NEX y el Runtime, (b) conectar un runtime que reporte resultados, (c) puente de eventos al Event Bus, (d) persistencia de planes con RLS, (e) pantallas, (f) catalogar las acciones de compensación.
- **No hecho a propósito:** ninguna ejecución de acciones, llamada a Runtime, Workers o Connectors, base de datos, red, IA, pantalla, migración ni despliegue.

## Referencias
ADR-0006, ADR-0009, ADR-0027, ADR-0028, ADR-0029, ADR-0030, `lib/nex/execution/execution.test.ts`.
