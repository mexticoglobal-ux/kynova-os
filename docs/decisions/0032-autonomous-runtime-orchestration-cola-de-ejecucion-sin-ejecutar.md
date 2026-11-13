# ADR-0032: Autonomous Runtime Orchestration, la cola de ejecución sin ejecutar nada

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-13 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | nex · runtime · orquestación · cola · dag · workers · reintentos · multiempresa · determinismo |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
El Execution Engine (ADR-0031) produce planes de ejecución que una persona aprueba, pero nada los convierte en trabajo ordenable. Para que un runtime futuro pueda actuar sin decidir nada por su cuenta, hace falta una capa que tome un plan **aprobado**, arme la cola de ejecución respetando prioridades, dependencias y autorizaciones, asigne el worker adecuado y deje todo listo. Este sprint construye **una capa nueva**, `lib/nex/runtime-orchestrator/`, sin modificar el Backend Core, KOE, el Copilot, la Memoria, el Knowledge Graph, el RAG, los Connectors, el Integration Hub, Google Workspace ni el AI Gateway. **No ejecuta nada**: no llama a APIs, a un Worker ni a un Conector, y no los modifica.

## Decisión
1. **Pipeline:** Execution Plan (aprobado) → Runtime Orchestrator → Runtime → Execution Queue → Worker Assignment. La capa solo consume datos planos del plan y los workers de la empresa; produce estructuras y listas, nunca acciones.
2. **Cola de ejecución:** un elemento por paso del plan (su id es el del paso), con once estados y nada más: Pending, Assigned, WaitingDependencies, WaitingApproval, Ready, Running, Paused, Completed, Failed, Cancelled y Expired, con una tabla cerrada de cambios. El estado de un elemento sale de **hechos** (autorización, dependencias, espera de reintento), no de una corazonada.
3. **Autorización primero:** un paso solo es autorizable si el plan fue aprobado por una persona cuyo rol alcanza el nivel de la acción (1 miembro, 2 gestor, 3 administrador). Un aprobador con rol desconocido no autoriza nada (falla cerrado). Un paso sin autorización queda en WaitingApproval, **no recibe worker** y no puede iniciarse.
4. **Dependencias en un DAG:** ningún paso inicia hasta que todas sus dependencias (de pasos y de planes) estén Completed; se rechazan ciclos de pasos y de planes al encolar. Una dependencia fallida, cancelada o expirada se reporta como bloqueo, no como espera silenciosa.
5. **Asignación de workers:** solo un worker de la misma empresa, activo (en el roster y para la empresa), con la especialidad del paso, con **permiso** para la acción y con capacidad libre. Gana el de menor carga relativa; desempate por id. Si un worker deja de ser elegible suelta lo que tenía. Los workers de otra empresa nunca se consideran.
6. **Planificador:** ordena por prioridad, impacto, antigüedad e id (los empates nunca cambian); controla reintentos con backoff exponencial acotado (el nivel 3 no se reintenta), controla timeouts (un timeout es un intento fallido) y detecta bloqueos: dependencia fallida, dependencia no encolada, ningún worker podría tomarlo, aprobación que no llega, ciclo. Esperar a un worker ocupado no es un bloqueo.
7. **Runtime Adapter:** `prepareExecution`, `assignWorker`, `startExecution`, `pauseExecution`, `resumeExecution`, `cancelExecution` y `finishExecution`, todas puras y solo sobre estructuras. **Running, Completed y Failed son lo que un runtime futuro reporta:** solo el sistema puede decir que algo inició o terminó; el tick únicamente devuelve la lista de lo que se le pediría iniciar, salvo que se active `autoStart`, que solo cambia el estado a Running.
8. **Pausar, reanudar y cancelar** (gestor o sistema) actúan sobre toda la corrida; al reanudar, lo que estaba corriendo conserva el tiempo que le quedaba. Una corrida cuyo plan caduca sin haber empezado expira.
9. **Permisos antes de construir:** lo que quien opera no puede ver no existe (un plan de finanzas es invisible para quien no ve finanzas); encolar lo hace un gestor o el sistema; el reductor solo toca las filas de la empresa del actor.
10. **Idempotencia y determinismo:** encolar dos veces el mismo plan no cambia nada; un tick sin novedades tampoco. Sin reloj interno (cada evento trae `at`), sin azar, sin red, sin base de datos y sin IA: el mismo guion da el mismo estado, registro y métricas.
11. **Auditoría y observabilidad solo con ids y métricas:** asignación, inicio, pausa, reanudación, timeout, reintento, cancelación, fin y fallo; el texto libre se descarta antes de guardarse. Nunca prompts, respuestas, contexto, secretos, OAuth, tokens ni contenido.
12. **Datos para un dashboard futuro (sin pantallas):** planes activos y completados, workers activos y libres, cola por estado, throughput, utilización, tiempos promedio, reintentos, fallos, cuellos de botella y dependencias, siempre de una sola empresa.

## Consecuencias
- **Honestidad sobre lo probado:** todo se probó con planes construidos a mano como datos planos y con rosters de ejemplo. Los límites de reintento, los tiempos de backoff, las ventanas de bloqueo y de throughput y el máximo de corridas son **valores de partida míos**.
- **«Running» y «Completed» son bookkeeping:** hoy nada los produce salvo un llamador con rol de sistema. Conectar un runtime real que reporte resultados es un paso posterior con aprobación propia.
- **Archivo de un sprint anterior tocado:** únicamente un test: el guard de importadores del Execution Engine ahora permite `lib/nex/runtime-orchestrator` como consumidor; ninguna fuente de esa capa cambió.
- **Pendiente con aprobación propia:** (a) un runtime que consuma la lista y reporte resultados, (b) conectarlo con KOE y los workers reales, (c) puente de eventos al Event Bus, (d) persistencia de la cola con RLS, (e) pantallas.
- **No hecho a propósito:** ninguna ejecución de acciones, llamada a APIs, Workers o Connectors, base de datos, red, IA, pantalla, migración ni despliegue.

## Referencias
ADR-0006, ADR-0009, ADR-0030, ADR-0031, `lib/nex/runtime-orchestrator/runtime-orchestrator.test.ts`.
