# ADR-0034: Worker Operating System, qué es capaz de hacer un Worker

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-13 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | nex · workers · capacidades · skills · herramientas · permisos · versiones · upgrade · nivel 3 · multiempresa · determinismo |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
El Worker Runtime Engine (ADR-0033) administra cómo **vive** un Worker; nada define **qué es capaz de hacer**: sus capacidades, sus habilidades, las herramientas que puede usar, sus permisos, sus versiones y si es compatible con la plataforma. Este sprint construye **una capa nueva**, `lib/nex/worker-os/`, sin modificar KOE, el AI Gateway, el Runtime, el Backend Core, el Integration Hub, los Connectors, el Copilot, el RAG, el Knowledge Graph, la Memoria, el Execution Engine, el Runtime Orchestrator ni el Worker Runtime. **No ejecuta nada**: ni tareas, ni herramientas, ni APIs, ni IA, ni base de datos, ni Runtime, ni instalaciones.

## Decisión
1. **Un esquema cerrado:** un Worker se define con exactamente `workerId`, `companyId`, `version`, `build`, `runtimeVersion`, `platformVersion`, `status`, `specialty`, `capabilities`, `skills`, `tools`, `permissions`, `limits` y `health`. Un campo fuera del esquema, una cadena con espacios, una especialidad desconocida o un número fuera de rango se rechazan; no hay texto libre en ningún campo.
2. **Un solo catálogo global**, definido una vez en `worker-os-types.ts` y sin repetir datos: las quince especialidades (General, Sales, Marketing, Support, Finance, CRM, SEO, Content, Video, Automation, Developer, Operations, Analytics, Research, Administration), las catorce capacidades con la versión de su contrato, las doce herramientas (AI Studio se identifica como `AIStudio`), los skills (que se nombran como las especialidades) y las versiones de la plataforma, el runtime y el mínimo de worker. La configuración por defecto se lee de ese catálogo.
3. **Tres cosas distintas, nunca mezcladas:** *capacidades* (palabras del catálogo como `read`), *herramientas* (nombres del catálogo como `CRM`) y *permisos* (ids de acción como `crm.read`, familias `crm.*` o `*`). Cada lista se valida aparte; un permiso no puede escribirse como una capacidad o una herramienta (`read` o `CRM` se rechazan como permiso) y cambiar una lista no toca las demás. Las capacidades nunca se asumen: solo existe lo que el Worker declara.
4. **Skills de 0 a 100,** enteros, sin duplicados y con ids del catálogo. Un skill no declarado está ausente, no vale 0, y un skill por sí solo no concede nada.
5. **Herramientas solo registradas:** el sistema registra qué herramientas puede usar un Worker; nunca las ejecuta ni las conecta.
6. **Compatibilidad que bloquea:** se validan la versión del Worker (mínimo de la plataforma), la del runtime que necesita, la de la plataforma que necesita y la de cada capacidad. Una versión es compatible si tiene el mismo major y no pide más de lo que la plataforma ofrece. **Una incompatibilidad bloquea el Worker** (estado `Blocked`) y corregirla lo desbloquea; el dashboard y la política la reevalúan con la configuración vigente.
7. **Upgrade en tres pasos de personas, nunca automático:** `upgradeRequested` (con versión más nueva y destino compatible), `upgradeApproved` y `upgradeInstalled`. Aprobar no instala; instalar solo registra la decisión de una persona de Nivel 3; esperar, leer o consultar el dashboard no cambia ninguna versión. Cada paso vuelve a comprobar la compatibilidad.
8. **Rollback exacto:** al instalar, el release anterior (versión, build, versión de runtime y de plataforma) se guarda; el rollback vuelve **exactamente** a ese release, uno por uno, y se rechaza si hay un upgrade pendiente o ningún release anterior. Un release que ya no es compatible deja al Worker `Blocked`. Se guardan como máximo diez.
9. **Nivel 3, solo personas administradoras:** crear, actualizar, cambiar capacidades, permisos o herramientas, pedir, aprobar e instalar un upgrade y hacer rollback lo hace únicamente una persona con rol de administrador o dueño. Los Workers, el sistema y NEX nunca. Lo único que el propio Worker o el sistema pueden escribir es el reporte de **salud** (0–100), que nunca se inventa: no existe hasta el primer reporte.
10. **Políticas:** `evaluateRequest` contesta si a un Worker se le puede dar algo y reúne **todas** las violaciones (empresa, estado, versión, capacidad, skill, herramienta, permiso); solo se permite si no hay ninguna. Solo responde: no ejecuta nada. Es la pieza que un sprint posterior consultará antes de ejecutar.
11. **Auditoría de cada cambio:** creación, actualización, cambio de capacidades, de permisos y de herramientas, solicitud, aprobación e instalación de upgrade, rollback y reporte de salud, además de cada rechazo. El detalle lleva solo ids y números (cuántas capacidades o permisos se añadieron o quitaron, nunca su contenido).
12. **Dashboard sin pantallas, solo datos:** workers, versiones, especialidades, capacidades, skills (cuántos y promedio), herramientas, compatibilidad (con las razones), upgrades pendientes, rollbacks disponibles y salud, siempre de una sola empresa.
13. **Multiempresa:** ningún Worker se comparte; un mismo `workerId` puede existir en dos empresas sin tocarse, una definición con otra `companyId` se rechaza y un evento solo toca las filas de su empresa.
14. **Observabilidad y Event Bus:** contadores por empresa con ids y números, nunca prompts, contexto ni memoria; `toBusMessage` da la forma de los mensajes (un tópico por familia) sin publicar nada ni tocar el Backend Core. `FUTURE_TABLES` declara las tablas futuras (`worker_os_workers`, `_releases`, `_upgrades`, `_audit`) con alcance por empresa y RLS. **No se crea ninguna migración.**
15. **Determinismo:** sin reloj, sin azar, sin red, sin base de datos y sin IA; las listas se normalizan (el mismo conjunto en otro orden es el mismo Worker) y el mismo guion da el mismo estado, registro y métricas.

## Consecuencias
- **Honestidad sobre lo probado:** todo se probó con Workers de ejemplo. Las versiones del catálogo (todas 1.0.0), los rangos de los límites y la regla «mismo major, no más nuevo» son **valores de partida míos**; el catálogo de skills reutiliza los nombres de las especialidades porque el ejemplo del encargo (SEO, Marketing, CRM) los usa.
- **Interpretaciones a confirmar:** (a) el `status` del Worker OS tiene solo dos valores, `Active` y `Blocked`, porque el encargo no define más; (b) el rollback restaura el release (las cuatro versiones), no la configuración: cambios de permisos o herramientas hechos después no se deshacen; (c) un Worker incompatible se **crea** como `Blocked` en vez de rechazarse, para que quede visible; (d) quien pide un upgrade puede aprobarlo (no se exige separación de funciones).
- **Sin cancelar upgrades:** el encargo no lista cancelar una solicitud; un upgrade pedido se aprueba e instala, y hoy no hay forma de descartarlo. Queda como pendiente.
- **Archivos de sprints anteriores tocados:** ninguno.
- **Pendiente con aprobación propia (Sprint 51 y siguientes):** conectar este sistema con la ejecución real y los conectores externos, el Worker Runtime y el Orchestrator, el Event Bus, persistencia con RLS (las tablas ya están declaradas), cancelar un upgrade y pantallas.
- **No hecho a propósito:** ninguna ejecución de tareas o herramientas, instalaciones, Docker, Kubernetes, APIs, base de datos, IA, Event Bus real, WebSockets, persistencia, pantallas, migración ni despliegue.

## Referencias
ADR-0009, ADR-0032, ADR-0033, `lib/nex/worker-os/worker-os.test.ts`.
