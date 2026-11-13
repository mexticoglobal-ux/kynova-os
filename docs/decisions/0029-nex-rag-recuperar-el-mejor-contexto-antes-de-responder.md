# ADR-0029: NEX RAG Engine, recuperar el mejor contexto antes de responder

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-12 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | nex · rag · recuperación · memoria · grafo · caché · multiempresa · seguridad |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
NEX ya tiene memoria (ADR-0027) y un grafo de conocimiento (ADR-0028), pero nada decide **qué parte** de todo eso entra en el contexto antes de responder. Consultar toda la memoria sería caro y arriesgado. Este sprint construye **una capa nueva**, `lib/nex/rag/`, que reutiliza únicamente el Memory Engine y el Knowledge Graph, sin modificar KOE, el AI Gateway, el Runtime, el Backend Core, el Integration Hub, Google Workspace, el Financial Router, las Business Templates, el Business Architect, el Memory Engine ni el Knowledge Graph. No hay pantallas, IA, embeddings ni base de datos.

## Decisión
1. **Pipeline fijo:** pregunta → analizador → recuperación en memoria → recuperación en el grafo → ranking → constructor de contexto → contexto. Nunca se consulta toda la memoria: solo lo relevante (una palabra coincide, el tipo de conocimiento encaja con lo que se pregunta, o el grafo lo relaciona con lo que coincidió).
2. **Solo lectura.** El motor recibe los estados de memoria y grafo como valores y llama a sus funciones puras de búsqueda; no llama a ninguno de sus escritores y una prueba lo verifica. Lo que usó (ids de memorias y nodos) se devuelve al llamador, que decide si lo marca como usado. Las demás fuentes (organización, workers, plantillas, arquitecto, insights, CRM, facturación, marketplace, academia, automatizaciones) llegan **a través del grafo**, que ya las lee; el RAG no las toca.
3. **Reutilización real.** La capa importa de `@/lib/nex/memory` y `@/lib/nex/knowledge` (nada más de la plataforma). Para que los guards de los Sprints 43 y 44 («nadie más importa esta capa todavía») sigan siendo ciertos, se añadió `lib/nex/rag` a su lista de importadores permitidos: **es el único cambio en esos archivos y es solo de tests**.
4. **Analizador de consultas** por reglas (mismas palabras, mismo análisis, sin importar mayúsculas, acentos ni orden): once clases (información, cliente, empresa, documento, workflow, finanzas, ventas, marketing, operaciones, preferencias, histórico). Una pregunta puede ser de varias; la primera es la principal. Una pregunta de histórico deja que lo antiguo y lo archivado cuenten.
5. **Recuperación:** por palabras clave, por tipo de memoria, por grafo, relacionada (hasta dos saltos desde los mejores aciertos directos) e híbrida (todo junto, por defecto), con Top K (8 por defecto, máximo 25). Una memoria que además es nodo del grafo es **un solo** elemento.
6. **Ranking 0–100:** relevancia 30, confianza 10, importancia 12, recencia 10 (vida media de 30 días; 365 si se pregunta por el pasado), frecuencia 8, centralidad 10, distancia en el grafo 10 y feedback 10 (suavizado). El feedback suma los votos de la propia memoria y los que da este motor; solo una persona (miembro o superior) o el sistema vota, y solo lo que puede leer. Orden: puntaje, importancia, clave.
7. **Contexto compacto:** líneas numeradas por prioridad, sin duplicados (el mismo conocimiento, o dos memorias que dicen lo mismo), dentro de un presupuesto de caracteres. **Nunca** entra un secreto, token, credencial, OAuth, clave, cookie, contraseña, dato restringido ni una instrucción disfrazada de conocimiento: se filtra aunque algo así estuviera guardado. Los datos de contacto se enmascaran. Una pregunta que trae una credencial se rechaza y no se guarda, cachea ni registra.
8. **Caché determinista.** La clave contiene la empresa, quien pregunta (tipo, rol e id), los términos en orden fijo, los filtros, Top K y una **huella** del conocimiento de la empresa; se compara la clave completa, nunca un hash. Caduca por TTL configurable, cada empresa guarda un número acotado, y calificar un elemento descarta las respuestas que lo usaron. La huella incluye contenido y **permisos**, no solo la fecha: un cambio de permiso en el mismo milisegundo que otro cambio ya no puede servir una respuesta obsoleta (se encontró y corrigió durante las pruebas).
9. **Seguridad multiempresa.** Los permisos se aplican **antes** de recuperar (lo que quien pregunta no puede ver no existe para él); un último guardia descarta y cuenta cualquier elemento de otra empresa; ni la caché, ni las estadísticas, ni el feedback, ni la huella mezclan empresas. Un worker inactivo se rechaza; un worker solo pregunta.
10. **Observabilidad por empresa, sin la pregunta ni el conocimiento:** consultas, aciertos y fallos, caché (aciertos y fallos), latencia (total, con caché y calculada), memorias y nodos usados, ranking, Top K e intenciones. Los eventos y la auditoría solo llevan cifras e identificadores cortos.

## Consecuencias
- **Honestidad sobre lo probado:** todo se probó con los motores reales de memoria y grafo sobre estado en memoria y reloj inyectado. No hay búsqueda semántica: la relevancia es léxica (BM25 de la memoria y palabras del grafo). Un límite heredado: el plegado de plurales del índice de memoria trata distinto «cliente» y «clientes», así que una pregunta en singular puede no coincidir con un texto en plural; la recuperación por tipo existe en parte para cubrir eso.
- **Sesgo hacia lo conectado:** la centralidad y la distancia favorecen lo que está en el grafo; una memoria sin nodo no suma esos puntos. Los pesos son valores de partida que conviene ajustar con uso real.
- **Costo:** la huella y las búsquedas recorren listas completas de la empresa en cada pregunta; la caché ahorra el ranking, no la huella. Con persistencia real habrá que indexar y versionar en la base de datos.
- **El grafo puede estar desactualizado:** un nodo cuya memoria ya no existe se ignora, pero reconstruir el grafo sigue siendo tarea del Knowledge Builder.
- **Pendiente con aprobación propia:** (a) conectar el contexto con NEX y el Runtime (hoy nadie lo consume), (b) marcar como usadas las memorias devueltas, (c) puente de eventos al Event Bus, (d) persistencia de la caché y las estadísticas, (e) embeddings reales detrás de `lib/ai/`, (f) pantallas.
- **No hecho a propósito:** ninguna base de datos, llamada de IA, embedding, pantalla, migración ni despliegue.

## Referencias
ADR-0006, ADR-0009, ADR-0027, ADR-0028, `lib/nex/rag/rag.test.ts`.
