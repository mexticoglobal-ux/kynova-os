# ADR-0033: Worker Runtime Engine, el ciclo de vida de los Workers sin ejecutar nada

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-13 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | nex · workers · ciclo de vida · heartbeat · salud · capacidad · nivel 3 · multiempresa · determinismo |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
El Runtime Orchestrator (ADR-0032) decide **qué** se ejecuta; nada decide **cómo vive** cada Worker: cuándo está listo, ocupado, caído o en mantenimiento, cuándo se le puede dar trabajo y quién puede cambiarlo. Este sprint construye **una capa nueva**, `lib/nex/worker-runtime/`, sin modificar KOE, el AI Gateway, el Runtime, el Backend Core, el Integration Hub, los Connectors, el Copilot, el RAG, el Knowledge Graph, la Memoria, el Execution Engine ni el Runtime Orchestrator. **No ejecuta nada**: no hay Workers reales, ni Runtime, ni APIs, ni IA, ni base de datos, ni Event Bus real.

## Decisión
1. **Catorce estados y nada más:** Created, Starting, Idle, Reserved, Busy, Paused, WaitingApproval, Retrying, Recovering, Stopping, Stopped, Failed, Offline y Maintenance, con una tabla **cerrada** de transiciones. Se rechazan, entre otras, Busy → Created, Offline → Busy, Stopped → Busy, Failed → Busy, Maintenance → Busy e Idle → Busy (siempre se pasa por Reserved). Toda transición válida se escribe en el registro de auditoría de la empresa.
2. **Nivel 3, solo personas:** registrar, iniciar, detener, pausar, reanudar, poner en mantenimiento, sacar de mantenimiento, recuperar, aprobar y rechazar lo hace únicamente una persona con rol de administrador o dueño. Los Workers, el sistema y NEX nunca. Los workers solo reportan (heartbeat, inicio y fin de sus tareas); el sistema o un gestor planifican y ejecutan el tick de tiempo.
3. **Heartbeat:** cada Worker reporta id, empresa, timestamp, cpu, memoria, cola, tareas en ejecución y versión. **Nunca** se lee un reloj: el timestamp llega con el reporte. Se rechaza el de otra empresa, de otro worker, con fecha inválida, futura, vencida, anterior al último o con números imposibles; y solo el propio worker puede enviarlo.
4. **Timeout sin saltos peligrosos:** Idle sin heartbeat → Offline. **Busy nunca pasa a Offline directamente**: sus tareas vuelven al pool (se reintentan si pueden) y el worker pasa a Recovering; Reserved y WaitingApproval devuelven lo que tenían y pasan a Idle; un worker que no responde al arrancar pasa a Failed.
5. **Recuperación:** Offline o Failed → Recovering lo ordena una persona (Nivel 3) y Recovering → Idle ocurre **solo con un heartbeat válido** posterior. Un heartbeat suelto nunca revive un worker caído.
6. **Reintentos:** solo los errores `retryable`, con backoff exponencial acotado y un máximo de intentos. Un error `fatal` nunca se reintenta: la tarea falla, el worker pasa a Failed y lo que sostenía vuelve al pool.
7. **Planificador:** una tarea solo va a un worker de **su empresa**, en un estado que acepta trabajo (Idle, Reserved, WaitingApproval o Busy; nunca Offline, Failed, Maintenance, Paused, Stopped ni los demás), que no esté drenando una pausa o un mantenimiento, con la especialidad, el **permiso** de la acción, una versión compatible y las capacidades que la tarea pide. Se atiende por prioridad, antigüedad e id; gana el de menor carga relativa. Nunca se excede `maxConcurrent` ni `queueLimit`; lo que cabe en la cola sube solo cuando se libera un lugar.
8. **Versionado:** cada worker tiene `version`, `build` y `capabilities`; el planificador valida la versión mínima del runtime, la mínima de la tarea y las capacidades antes de asignar.
9. **Pausa, mantenimiento y parada:** pausar o poner en mantenimiento un worker ocupado termina **solo la tarea en curso** y no inicia ninguna nueva (lo que tenía reservado o en cola se devuelve al pool). Detener lo pasa a Stopping, no recibe trabajo nuevo, y llega a Stopped **solo con la cola vacía**.
10. **WaitingApproval:** una tarea que pide aprobación espera a una persona de Nivel 3 antes de poder iniciarse.
11. **Salud 0–100:** heartbeat reciente (30), errores (20), reintentos (10), tareas activas (10), tiempo activo (10), capacidad libre (10) y recuperaciones (10). Un worker que no puede trabajar (Created, Stopped, Failed, Offline) vale 0.
12. **Dashboard sin pantallas, solo datos:** workers totales y por estado (Idle, Busy, Offline, Failed, Maintenance), salud promedio, capacidad utilizada, colas y versiones, siempre de una sola empresa.
13. **Observabilidad por empresa, solo ids y métricas:** el texto libre se descarta antes de guardarse; nunca prompts, contexto, memoria ni respuestas.
14. **Event Bus y RLS preparados, no construidos:** `toBusMessage` da la forma de los mensajes (un tópico por familia, por empresa) sin publicar nada ni tocar el Backend Core; `FUTURE_TABLES` declara las tablas futuras (`worker_runtime_workers`, `_heartbeats`, `_tasks`, `_audit`) con alcance por empresa y política RLS. **No se crea ninguna migración.**
15. **Determinismo:** sin reloj, sin azar, sin red, sin base de datos y sin IA; el mismo guion da el mismo estado, registro y métricas.

## Consecuencias
- **Honestidad sobre lo probado:** todo se probó con workers y tareas de ejemplo. Los tiempos (heartbeat 30 s, timeout 90 s, arranque 120 s), los pesos de la salud, el backoff y los máximos son **valores de partida míos**.
- **Interpretación a confirmar:** «Solo personas pueden Recover» y «Recovering → Idle solo mediante heartbeat válido» se resolvieron así: la persona ordena la recuperación y el heartbeat la completa. Si se quiere que un heartbeat reviva solo a un worker Offline, es un cambio pequeño, pero afloja el Nivel 3.
- **Un error fatal baja al worker entero** (pasa a Failed): es una decisión mía, conservadora; se puede relajar más adelante.
- **El tick lo da el sistema o un gestor:** sin un cron real nada detecta el silencio solo; conectar ese temporizador es un sprint posterior.
- **Archivos de sprints anteriores tocados:** ninguno.
- **Pendiente con aprobación propia:** (a) conectar el Orchestrator con este motor, (b) Runtime y Workers reales, (c) puente al Event Bus, (d) persistencia con RLS (las tablas ya están declaradas), (e) pantallas.
- **No hecho a propósito:** ninguna ejecución de acciones, Docker, Kubernetes, APIs, base de datos, Event Bus real, WebSockets, IA, conectores externos, pantallas, migración ni despliegue.

## Referencias
ADR-0009, ADR-0031, ADR-0032, `lib/nex/worker-runtime/worker-runtime.test.ts`.
