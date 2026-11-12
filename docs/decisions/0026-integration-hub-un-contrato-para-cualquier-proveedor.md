# ADR-0026: Integration Hub, un solo contrato para cualquier proveedor externo

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-12 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | integraciones · hub · workflows · reintentos · límites · salud · multiempresa |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
Los sprints 40 y 41 dejaron la arquitectura de conectores (ADR-0024) y Google Workspace como primer proveedor real (ADR-0025). Cada proveedor nuevo (Outlook, WhatsApp, Meta, Stripe, MakaPay, PayPal, LinkedIn, TikTok, YouTube, Slack, Discord, Shopify, HubSpot, Salesforce y cualquier API futura) repetiría lo mismo: conexión, renovación, salud, límites de uso, reintentos, eventos. Este sprint construye **una capa nueva** que lo resuelve una vez, **sin modificar** KOE, el AI Gateway, el Runtime, el Backend Core, el Financial Router, las Business Templates, el Business Architect ni Google Workspace.

> **Nota sobre el encargo:** el texto recibido se cortó en el encabezado «Capability». Lo que sigue cubre todo lo anterior; las pruebas, este ADR y la sección del README se asumieron con el formato habitual. Si había más requisitos tras ese encabezado, se incorporan en una revisión.

## Decisión
1. **Una capa, un solo lugar:** `lib/integrations/hub/`, con los nueve archivos pedidos (`integration-hub`, `-registry`, `-engine`, `-types`, `-events`, `-health`, `-retry`, `-rate-limit`, `-observability`). El núcleo **no nombra ningún proveedor** (una prueba lo verifica); solo `integration-providers.ts` conoce Google y el proveedor simulado, y `integration-registry.ts` lista los proveedores declarados.
2. **Un contrato:** todo proveedor implementa `connect`, `disconnect`, `refresh`, `health`, `sync`, `execute`, `validate` y `capabilities`, y se inscribe con un manifiesto (id, nombre, categoría, permisos, scopes, límites de uso, objetivos de salud, capacidades, tipo y versión). El registro rechaza un manifiesto inválido, un adaptador incompleto o que prometa capacidades que no declara. Un proveedor **declarado sin adaptador** (los catorce citados) existe en el registro pero **no se puede conectar**.
3. **Camino único Worker → Conector → Hub → Proveedor:** solo un Worker activo de la empresa (o el sistema, para sincronizar y renovar) llega al Hub; un agente, un módulo, una persona o una pantalla se rechazan. Nada habla con Google, Outlook, Stripe, WhatsApp o Meta salvo a través de un adaptador registrado.
4. **Nivel 3 (ADR-0009):** todo lo que sale de la plataforma se **retiene** para una persona administradora **de esa empresa**; un Worker, el sistema, un agente o el administrador de otra empresa no aprueban. Una escritura aprobada **no se reenvía a otro proveedor** salvo que la solicitud lo permita; una lectura que falla **sí** cae al siguiente proveedor conectado con la misma capacidad.
5. **Motor de reintentos:** retroceso exponencial con jitter determinista y tope, respeta el `retry-after` del proveedor, solo reintenta lo que merece reintento (red, proveedor, tiempo agotado, límite), **disyuntor** (cerrado → abierto → semiabierto → cerrado), **muerto** tras N aperturas y **recuperación** solo por una persona administradora. Un timeout se aplica a toda llamada.
6. **Motor de límites:** por minuto, hora y día más ráfaga, con lo que queda y cuándo se libera; dos cubetas por llamada, la **de la conexión** (una empresa no ahoga a otra) y la **del proveedor** (la cuota compartida de la app). Si el proveedor informa lo que le queda, el Hub le cree cuando es más estricto. **Nunca se excede:** una llamada sobre el límite se rechaza sin llamar al proveedor.
7. **Motor de salud (0–100):** latencia, errores, timeouts, token, última sincronización, estado de OAuth, presión del límite y disyuntor; un conector muerto marca 0, un disyuntor abierto limita a 40 y un token vencido o revocado a 45.
8. **Workflows:** Worker → Hub → Conector → Proveedor → Resultado con seis disparadores (sync, push, pull, webhook, manual, programado). Los pasos corren **como el Worker del flujo**; un paso fallido detiene la corrida; un paso que necesita aprobación deja la corrida en espera. Un webhook solo dispara flujos **después de que el proveedor valida la firma**.
9. **Eventos y observabilidad sin contenido:** cada paso emite un evento con traza y se descartan las claves que parecen credenciales o contenido (token, correo, asunto, cuerpo, código…). El registro puede darse en la forma de auditoría de la plataforma para que el Event Bus lo consuma.
10. **Multiempresa:** conexiones, disyuntores, muestras de salud, aprobaciones y flujos separados por empresa; **una cuenta externa pertenece a una sola empresa** (la segunda se rechaza y la autorización se revoca).
11. **Google Workspace queda detrás del Hub sin cambios:** `googleHubProvider` envuelve `GoogleWorkspace` y el reductor de conectores; se comprobó con git que los archivos de Google y de conectores no cambiaron en este sprint.

## Consecuencias
- **Honestidad sobre lo probado:** ningún proveedor real se ha conectado a través del Hub. La prueba de punta a punta usa el Google simulado (`fake-google`) y un proveedor simulado; los límites de uso de los catorce proveedores declarados son **valores de referencia** que hay que confirmar con cada documentación antes de conectarlos.
- **Pendiente con aprobación propia:** (a) el puente de eventos hacia el Event Bus del Backend Core (una línea en `lib/backend/integration/bridges.ts`), (b) persistencia de conexiones, aprobaciones y flujos (tablas con RLS por empresa; esta capa es contrato y reductor, sin migraciones), (c) rutas HTTP de `connect`/`callback`/`webhook` y un planificador que invoque `runScheduled`, (d) un adaptador real por proveedor, cada uno con su sprint.
- **Límite heredado:** el reductor de conectores no tiene un evento para un fallo real del proveedor; el Hub guarda ese resultado en sus eventos y en la conexión del Hub, no en el estado de conectores.
- **No hecho a propósito:** ninguna credencial, llamada real ni migración; ningún despliegue.

## Referencias
ADR-0009, ADR-0016, ADR-0024, ADR-0025, `lib/integrations/hub/hub.test.ts`.
