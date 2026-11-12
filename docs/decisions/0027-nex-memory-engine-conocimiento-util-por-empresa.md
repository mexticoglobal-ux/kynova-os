# ADR-0027: NEX Memory Engine, conocimiento útil organizado por empresa

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-12 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | nex · memoria · conocimiento · multiempresa · retención · seguridad · aprendizaje |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
NEX responde con el contexto inmediato. Para trabajar como parte de la empresa necesita una memoria organizada **por empresa**: lo que se decidió, lo que prefiere un cliente, cómo trabaja el equipo. Guardar conversaciones completas sería caro, riesgoso (secretos, datos personales) y poco útil. Este sprint construye **una capa nueva**, `lib/nex/memory/`, sin modificar KOE, el AI Gateway, el Runtime, el Backend Core, el Integration Hub, Google Workspace, el Financial Router, el Business Architect ni las Business Templates. No hay pantallas, IA real ni base de datos: solo reductores puros y arquitectura determinista.

## Decisión
1. **Conocimiento, no conversaciones.** Una memoria es un resumen corto (máximo 280 caracteres). El texto largo se resume y **se descarta**; una transcripción se rechaza. Los correos y teléfonos del resumen se enmascaran.
2. **Nueve tipos:** conversación, negocio, cliente, documento, flujo de trabajo, decisión, preferencia, aprendizaje y sistema. Cada memoria lleva id, empresa, worker, fechas, fuente, importancia, confianza, categoría, etiquetas, TTL, permisos, resumen y una referencia opaca a su embedding (esta capa nunca guarda vectores).
3. **Lo que nunca se guarda** se rechaza entero, antes de tocar el estado: prompts, tokens, secretos, credenciales, OAuth, claves de API, cookies, contraseñas, referencias a la bóveda, tarjetas, identificadores personales y datos restringidos. Se revisan también etiquetas, categoría y fuente. Ni el rechazo deja el texto en el registro ni en la auditoría.
4. **Reductor puro:** `reduceMemory(estado, evento, entorno)` no lee reloj, azar, red, entorno ni base de datos; cada evento trae su fecha. `MemoryEngine` solo envuelve estado, registro y observabilidad.
5. **Multiempresa por construcción.** La empresa se verifica primero y no es opcional: toda búsqueda filtra por empresa antes que por permisos; los ids son por empresa y toda operación los busca junto con ella; el índice se construye con una sola empresa; lo que el solicitante no puede leer «no existe» para él (`notFound`). Un evento cuya empresa no es la del actor se rechaza.
6. **Permisos** por empresa, usuario, worker y rol: visibilidad `tenant`, `restricted` o `private`; rol mínimo; listas de roles, usuarios y workers; las memorias de un worker son de ese worker y de las personas hasta que la empresa las abre. La memoria del sistema solo la escribe el sistema y solo la leen administradores.
7. **Nivel 3 (ADR-0009):** un worker prepara; solo una persona archiva, borra, fija, confirma, vota o abre permisos. Un worker no vota ni decide. Su registro de una decisión es una propuesta (confianza máxima 70).
8. **Ranking 0–100:** importancia 25, uso 15, recencia 20 (vida media de 30 días), frecuencia 10, feedback 15 (suavizado; un voto por votante) y confiabilidad 15 (confianza ponderada por la fuente). Una memoria archivada vale la mitad.
9. **Búsqueda** por texto (BM25 sin acentos ni plurales), etiquetas (cualquiera o todas), categoría, empresa, worker, tipo, fecha y ranking; con texto, la relevancia pesa 65 % y el ranking 35 %. Desempates por id: mismo estado y misma consulta, mismo orden.
10. **Retención:** TTL por tipo (se extiende al usarla), expiración (oculta de la búsqueda; se elimina tras 30 días de gracia), archivo (de lo viejo, sin uso y poco importante), compresión (resumen más corto a los 60 días) y resumen extractivo determinista. **Nunca se borra una memoria importante** (fijada o de importancia 80 o más): al llegar su TTL se archiva y se conserva; `forget` la rechaza y sugiere archivar.
11. **Aprendizaje:** NEX aprende preferencias, decisiones, procesos y formas de trabajar como memorias **consultivas** (`advisory`): confianza inicial 50, +10 por cada observación repetida hasta 85 (95 si una persona la confirmó), importancia máxima 70 para que nunca sea intocable. Se rechaza todo texto que intente cambiar reglas, aprobaciones, permisos o seguridad, y el aprendizaje no puede producir memoria de sistema. No modifica ninguna regla.
12. **Observabilidad por empresa, sin conocimiento:** memorias creadas y usadas, búsquedas, aciertos y fallos, latencia, ranking, TTL y expiraciones, rechazos por motivo. Los eventos solo llevan ids, cifras e identificadores cortos y pueden darse en la forma de auditoría de la plataforma.

## Consecuencias
- **Honestidad sobre lo probado:** todo se probó con estado en memoria y reloj inyectado. La búsqueda es léxica; `embeddingRef` es una referencia que aún nada resuelve, así que no hay búsqueda semántica.
- **Detección de secretos por patrones:** reduce el riesgo, no lo elimina; un secreto con formato desconocido podría pasar. Algunos textos legítimos pueden rechazarse (por ejemplo, una frase de aprendizaje con «siempre envía»).
- **Pendiente con aprobación propia:** (a) persistencia con RLS por empresa (tablas y migración), (b) puente de eventos al Event Bus del Backend Core, (c) integración con NEX y el Runtime para que consulte y escriba memoria, (d) un planificador que invoque la limpieza de retención, (e) embeddings reales detrás de `lib/ai/`, (f) pantallas para ver, confirmar y borrar memoria.
- **No hecho a propósito:** ninguna base de datos, llamada de IA, pantalla, migración ni despliegue; ningún sprint anterior se modificó.

## Referencias
ADR-0006, ADR-0009, ADR-0016, ADR-0026, `lib/nex/memory/memory.test.ts`.
