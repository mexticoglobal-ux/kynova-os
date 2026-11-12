# ADR-0028: NEX Knowledge Graph, relacionar el conocimiento de la empresa sin duplicarlo

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-12 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | nex · grafo · conocimiento · multiempresa · determinismo · seguridad |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
El NEX Memory Engine (ADR-0027) guarda conocimiento útil por empresa, pero cada memoria vive sola. Para que NEX entienda cómo se conectan las cosas (quién creó qué, qué depende de qué, qué decisión afectó a qué cliente) hace falta una red de relaciones. Este sprint construye **una capa nueva**, `lib/nex/knowledge/`, sin modificar KOE, el AI Gateway, el Runtime, el Backend Core, el Integration Hub, Google Workspace, el Financial Router, las Business Templates, el Business Architect ni el NEX Memory Engine. No hay pantallas, IA ni base de datos: solo reductores puros y arquitectura determinista.

## Decisión
1. **El grafo referencia, nunca copia.** Un nodo lleva `referenceId` (el id de la cosa en el módulo que la posee), tipo, confianza, importancia, permisos, fechas y etiquetas de archivo; **no** lleva texto, nombre, dirección ni el resumen de una memoria. Una referencia, categoría o etiqueta que parezca una credencial o una dirección de contacto se rechaza.
2. **Sin duplicados por construcción.** El id de un nodo es `n:<tipo>:<referencia>` y el de una relación `e:<desde>|<relación>|<hasta>`: lo mismo es siempre lo mismo. Ver una relación otra vez la refuerza (`observations`), no la repite.
3. **Veinte tipos de nodo y dieciséis relaciones**, con una tabla que dice qué tipo puede estar en cada extremo de cada relación. La empresa es la raíz: no pertenece a nada y nada la contiene.
4. **Sin ciclos inválidos.** La jerarquía (`belongsTo` y `contains`, que son inversas) y las dependencias (`dependsOn`) deben ser acíclicas; un nodo nunca se relaciona consigo mismo. Las demás relaciones pueden formar bucles (dos personas que trabajan juntas, documentos que se referencian).
5. **Multiempresa por construcción.** La empresa se verifica primero; una relación solo puede unir dos nodos de la misma empresa (un nodo de otra no se encuentra); la vista de quien pregunta, el índice y el ranking se construyen con una sola empresa; un evento cuya empresa no es la del actor se rechaza.
6. **Permisos por empresa, usuario, worker y rol.** Una relación es visible solo si **sus dos extremos** lo son, y los recorridos no atraviesan lo oculto: un nodo restringido tampoco se filtra por sus vecinos. Lo que el solicitante no puede leer «no existe» para él.
7. **Nivel 3 (ADR-0009).** Solo una persona aprueba o rechaza (`approved`, `rejected` solo salen de una persona y solo una persona puede crearlas); un worker prepara y no borra; solo un gestor quita nodos o relaciones; solo el sistema o un administrador construye.
8. **Recorridos deterministas:** primero en anchura, primero en profundidad, camino más corto, vecindad y conocimiento relacionado, con dirección y relaciones opcionales y profundidad máxima 10. Las listas de vecinos están ordenadas, así que el mismo grafo siempre da el mismo recorrido.
9. **Ranking 0–100:** importancia 25, confianza 20, uso 15, frecuencia 10 (relaciones vistas de nuevo), profundidad 10 (cercanía a la empresa o al nodo ancla) y centralidad 20 (grado ponderado por la fuerza de cada relación).
10. **Búsqueda** por nodo, referencia, relación, tipo, empresa, worker, categoría, etiquetas, texto (sobre las palabras con las que se archiva el nodo), profundidad desde un nodo o desde la empresa, confianza mínima y ranking.
11. **Knowledge Builder.** Construye nodos y relaciones desde registros planos que otros módulos ya tienen y **solo lee**: memoria, organización, CRM, plantillas, arquitecto, workers, automatizaciones, insights, facturación, marketplace y academia. Cada fuente solo puede hablar de los tipos de nodo que le corresponden; un registro de otra empresa se descarta y se cuenta; una relación inválida, un ciclo o un dato sensible se saltan y se cuentan, y el resto se construye. Aplicar lo mismo dos veces no cambia nada. Con `replace`, lo que la fuente ya no dice sale del grafo (una memoria borrada deja de estar), sin tocar las demás fuentes ni la empresa.
12. **Memoria sin importarla.** La capa lee memorias mediante la forma estructural `MemoryRow` y no importa nada de `lib/nex/memory`; una prueba temporal comprobó que las memorias reales del Memory Engine encajan. Los permisos de la memoria viajan al nodo, de modo que una memoria restringida sigue oculta en el grafo; las memorias expiradas y la memoria de sistema se dejan fuera.
13. **Observabilidad por empresa, sin conocimiento:** nodos, relaciones, construcciones, búsquedas, recorridos por tipo, ranking, latencia, aciertos, fallos y rechazos por motivo; los eventos solo llevan cifras e identificadores cortos y pueden darse en la forma de auditoría de la plataforma.

## Consecuencias
- **Honestidad sobre lo probado:** todo se probó con estado en memoria y reloj inyectado. Salvo la memoria (verificada contra el motor real), las demás fuentes del constructor se probaron con **registros de ejemplo**: no existe todavía un adaptador que lea cada módulo real (CRM, facturación, etc.) y los entregue como registros.
- **Búsqueda léxica:** el texto se compara con la referencia, la categoría y las etiquetas, no con el contenido de las memorias (el grafo no lo tiene). Para encontrar por significado hace falta consultar el Memory Engine con los ids que el grafo devuelva.
- **Un hecho de aprobación viene de una fuente:** el constructor puede registrar que una persona aprobó algo porque la fuente así lo dice (por ejemplo, quien confirmó una memoria); la operación directa `edge.link` sigue siendo solo de personas.
- **Escala:** consultas y vistas recorren listas completas; los límites (10 000 nodos y 50 000 relaciones por empresa) son un freno, no una promesa de rendimiento. Con persistencia real habrá que indexar en la base de datos.
- **Pendiente con aprobación propia:** (a) persistencia con RLS por empresa (tablas y migración), (b) puente de eventos al Event Bus del Backend Core, (c) adaptadores de lectura para cada módulo fuente, (d) integración con NEX y el Runtime, (e) un planificador que reconstruya el grafo cuando cambian las fuentes, (f) pantallas.
- **No hecho a propósito:** ninguna base de datos, llamada de IA, pantalla, migración ni despliegue; ningún sprint anterior se modificó.

## Referencias
ADR-0006, ADR-0009, ADR-0026, ADR-0027, `lib/nex/knowledge/knowledge.test.ts`.
