# ADR-0035: Execution Gateway, la última capa antes de la ejecución real

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-13 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | nex · gateway · solicitud de ejecución · validación · aprobación · dependencias · nivel 3 · multiempresa · determinismo |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
El Runtime Orchestrator (ADR-0032) decide qué se ejecuta, el Worker Runtime (ADR-0033) cómo vive cada Worker y el Worker OS (ADR-0034) qué es capaz de hacer. Falta la pieza que, justo antes de ejecutar, **valida todo junto** y deja una solicitud de ejecución clara. Este sprint construye **una capa nueva**, `lib/nex/execution-gateway/`, sin modificar KOE, el AI Gateway, el Runtime, el Backend Core, el Integration Hub, los Connectors, el Worker Runtime, el Worker OS, el Copilot, el RAG, el Knowledge Graph, la Memoria, el Runtime Orchestrator ni el Execution Engine. **No ejecuta nada**: no llama a APIs, Connectors, Runtime, Workers ni IA, no aprueba y no cambia ninguna autorización.

## Decisión
1. **Flujo y parada:** plan aprobado → Runtime Orchestrator → Worker Runtime → Worker OS → Execution Gateway → **Execution Request** → **STOP**. No existe ningún estado «enviado» o «ejecutando»: una solicitud Ready es la descripción de un trabajo, y `dispatch` solo **lista** las solicitudes Ready en orden, sin cambiar nada.
2. **Hechos planos, sin importar otras capas:** el Gateway recibe como datos estructurales lo que dicen las otras capas (el plan y sus pasos, el estado y la versión del worker en el Worker Runtime, y el estado, las capacidades, herramientas, permisos y límites del worker en el Worker OS). Un sprint posterior decide cómo alimentarlo.
3. **Ocho estados y nada más:** Pending, Validated, WaitingApproval, Ready, Blocked, Rejected, Cancelled y Expired, con una tabla cerrada. Una solicitud solo llega a Ready pasando por Validated; Rejected, Cancelled y Expired son finales.
4. **Execution Request:** `requestId` (determinista, `er:<plan>:<paso>`), `companyId`, `workerId`, `planId`, `stepId`, `actionId`, `priority`, `requestedAt`, `approvedBy`, `timeout`, `retryPolicy`, `executionPolicy`, `toolRequirements` y `capabilityRequirements`. Nunca prompts, contexto, memoria ni respuestas. `executionPolicy.mode` es siempre `request-only`.
5. **Validaciones, y una sola fallida bloquea:** empresa, worker (estado y capacidad en el Worker Runtime; estado y especialidad en el Worker OS), versión (el Worker Runtime y el Worker OS deben coincidir y cumplir el mínimo), permisos, capacidades, herramientas, compatibilidad, aprobación, prioridad, dependencias, timeout, reintentos y política. Se reportan **todas** las fallas por código, no solo la primera.
6. **Bloquear o rechazar:** una falla que se arregla esperando (worker ocupado o caído, dependencia pendiente, plan en pausa, un permiso faltante) **bloquea** y la solicitud se puede revalidar; una falla que nunca se arreglará (dependencia fallida, plan cerrado, política de reintento que incluye errores fatales, empresa que no coincide) **rechaza**. La aprobación pendiente no es falla: es una espera (WaitingApproval).
7. **Aprobación leída, nunca concedida:** el Gateway no aprueba y no cambia autorizaciones. Lee quién aprobó el plan y qué rol tiene esa persona: debe ser una **persona** (el sistema, un worker o NEX no tienen rol y no cuentan) cuyo rol alcance el nivel del paso (1 miembro, 2 gestor, 3 administrador; un paso nunca puede pedir menos que su nivel y un nivel desconocido es 3). `approvedBy` solo se copia del plan, y solo cuando está aprobado.
8. **Prioridades deterministas:** critical, high, normal, low y background; una solicitud puede bajar su prioridad respecto al plan pero nunca subirla; el orden es prioridad, luego quién pidió primero, luego id.
9. **Dependencias:** un paso solo puede ejecutarse cuando todas sus dependencias **terminaron correctamente**; pendientes bloquean y fallidas u omitidas rechazan. Los planes de los que depende el plan se tratan igual, dentro de la misma empresa.
10. **Timeout y reintentos:** el timeout se valida contra el mínimo, el máximo, el límite de la empresa, el del plan y el del worker. La política de reintento es solo `retryable`; nunca se reintenta un error fatal y un paso de Nivel 3 no se reintenta.
11. **Motor de políticas:** evalúa siete dimensiones (empresa, worker, plan, acción, herramienta, capacidad y rol) y reúne todas las violaciones; solo evalúa, nunca ejecuta.
12. **Quién opera:** el sistema o un gestor pueden crear, validar, cancelar y expirar solicitudes; los workers y NEX nunca. Aprobar solo lo hacen personas, **fuera** de esta capa.
13. **Auditoría:** creación, validación, rechazo, cancelación y expiración, además de cada transición y cada rechazo de una orden, siempre con ids y números.
14. **Dashboard sin pantallas, solo datos:** solicitudes por estado, Ready, Blocked, Rejected, pendientes, tiempo promedio (hasta validar y antigüedad de las abiertas), prioridades, errores por código y versiones, siempre de una sola empresa.
15. **Observabilidad, Event Bus y RLS:** contadores por empresa con ids y números, nunca prompts, contexto, memoria ni respuestas; `toBusMessage` prepara los mensajes sin publicar nada ni tocar el Backend Core; `FUTURE_TABLES` declara `gateway_requests`, `gateway_validations` y `gateway_audit` con alcance por empresa y RLS. **No se crea ninguna migración.**
16. **Multiempresa y determinismo:** los hechos, las solicitudes y las métricas están aislados por empresa (un plan o un worker de otra empresa no existe para esta); sin reloj, azar, red, base de datos ni IA, y el mismo guion da el mismo estado, registro y métricas.

## Consecuencias
- **Honestidad sobre lo probado:** todo se probó con hechos de ejemplo escritos a mano; **no** se probó con las estructuras reales de las otras capas (importarlas habría roto sus propias pruebas de aislamiento). El sprint que conecte tendrá que escribir el adaptador y probar que encaja. Los límites de timeout, el máximo de reintentos (5), la vigencia de una solicitud (1 hora) y la regla de versión son **valores de partida míos**.
- **Interpretaciones a confirmar:** (a) «el Gateway nunca aprueba» y «solo personas pueden aprobar» se resolvieron leyendo la aprobación del plan como un hecho y exigiendo que quien la dio sea una persona con el rol del nivel; por eso no hay un evento de aprobar aquí; (b) un worker en Busy con capacidad libre se acepta; (c) Background se agregó como quinta prioridad y el plan puede traerla; (d) un Worker Runtime y un Worker OS con versiones distintas bloquean.
- **Una solicitud por paso:** el id es `er:<plan>:<paso>`; una solicitud terminada (rechazada, cancelada o expirada) impide crear otra igual. Reintentar un paso con una solicitud nueva requerirá un número de revisión: queda pendiente.
- **Archivos de sprints anteriores tocados:** ninguno.
- **Pendiente con aprobación propia (Sprint 52):** conectar el Gateway con el Runtime real y los Connectors, el adaptador de hechos desde las otras capas, el Event Bus, persistencia con RLS (las tablas ya están declaradas) y pantallas.
- **No hecho a propósito:** ninguna ejecución, Runtime o Workers reales, APIs, IA, Docker, Kubernetes, Event Bus real, base de datos, persistencia, WebSockets, pantallas, migración ni despliegue.

## Referencias
ADR-0009, ADR-0031, ADR-0032, ADR-0033, ADR-0034, `lib/nex/execution-gateway/execution-gateway.test.ts`.
